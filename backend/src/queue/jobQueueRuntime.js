import os from 'node:os';
import { Worker, JOB_STATUSES } from '@champds/cds-job-queue';
import { processIngestionJob, JobScopes } from '../services/transcriptIngestion.js';
import { getConfig } from '../config/appConfig.js';
import {
  buildProviderConcurrencyLimits,
  createProviderConcurrencyGate,
  ProviderConcurrencyWaitCancelledError,
  resolveProviderKeyForJob
} from './providerConcurrency.js';

const supportedScopes = Object.freeze(Object.values(JobScopes));
const activeJobIDs = new Set();
const cancelRequestedJobIDs = new Set();

const state = {
  isReady: false,
  startedAt: null,
  workerID: '',
  supportedScopes,
  processedJobCount: 0,
  completedJobCount: 0,
  failedJobCount: 0,
  cancelledJobCount: 0,
  reconciledScanCount: 0,
  reconciledClaimAttemptCount: 0,
  lastReconciledAt: null,
  lastError: null
};

let workerInstance = null;
let idleReconciliationInterval = null;
let isReconciliationInProgress = false;
let providerConcurrencyGate = null;

function buildRuntimeID(prefix) {
  const hostname = process.env.HOST_HOSTNAME || `UNKNOWN_HOST_HOSTNAME:PID:${process.pid}`;
  const host = String(hostname || 'localhost').replace(/[^a-zA-Z0-9_-]/g, '-');
  return `${prefix}-${host}`;
}

function buildFailureData(errorOrResult, fallbackMessage) {
  const details = errorOrResult?.details || {};
  const stage = details?.stage ? ` | stage=${details.stage}` : '';
  const operation = details?.coreAPIError?.operation || details?.operation;
  const operationPart = operation ? ` | operation=${operation}` : '';
  const coreAPIPath = details?.coreAPIError?.path ? ` | coreAPIPath=${details.coreAPIError.path}` : '';
  const coreAPIBodySource = details?.coreAPIError?.body ?? details?.body ?? errorOrResult?.body;
  const coreAPIBody = formatErrorBodyForMessage(coreAPIBodySource);
  const coreAPIBodyPart = coreAPIBody ? ` | coreAPIBody=${coreAPIBody}` : '';
  const message = `${errorOrResult?.error || errorOrResult?.message || fallbackMessage}${stage}${operationPart}${coreAPIPath}${coreAPIBodyPart}`;
  return {
    message,
    error: JSON.stringify({
      message,
      details
    })
  };
}

function formatErrorBodyForMessage(body) {
  if (body === undefined || body === null || body === '') {
    return '';
  }
  const serialized = typeof body === 'string'
    ? body
    : safeJSONStringify(body);
  const compact = String(serialized).replace(/\s+/g, ' ').trim();
  if (!compact) {
    return '';
  }
  const MAX_ERROR_BODY_CHARS = 1000;
  return compact.length > MAX_ERROR_BODY_CHARS
    ? `${compact.slice(0, MAX_ERROR_BODY_CHARS)}...`
    : compact;
}

function safeJSONStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function reconcilePendingJobsWhenIdle() {
  if (!workerInstance || activeJobIDs.size > 0 || isReconciliationInProgress) {
    return;
  }
  if (typeof workerInstance.scanAndClaimPendingJobs !== 'function') {
    return;
  }

  isReconciliationInProgress = true;
  state.lastReconciledAt = new Date().toISOString();
  state.reconciledScanCount += 1;

  const processedBefore = state.processedJobCount;
  try {
    await workerInstance.scanAndClaimPendingJobs();
    const claimedNow = Math.max(0, state.processedJobCount - processedBefore);
    if (claimedNow > 0) {
      state.reconciledClaimAttemptCount += claimedNow;
    }
  } catch (error) {
    state.lastError = {
      message: error.message,
      timestamp: new Date().toISOString()
    };
  } finally {
    isReconciliationInProgress = false;
  }
}

export async function initializeJobQueueRuntime() {
  if (state.isReady) {
    return getJobQueueStatus();
  }

  //const workerID = process.env.CDS_JOB_QUEUE_WORKER_ID || buildRuntimeID('automated-minutes-worker');
  const workerID = buildRuntimeID('automated-minutes-worker');


  workerInstance = new Worker({
    workerID,
    supportedScopes
  });
  providerConcurrencyGate = createProviderConcurrencyGate(
    buildProviderConcurrencyLimits(getConfig())
  );

  workerInstance.on('job:new', async (job) => {
    const { jobID } = job;
    activeJobIDs.add(jobID);
    state.processedJobCount += 1;
    let providerConcurrencyToken = null;
    let lastProviderWaitStatusUpdateMS = 0;
    const reportProgress = async (data = {}) => {
      const { message, jobStateTracker, ...context } = data || {};
      const contextKeys = Object.keys(context || {});
      const serializedContext = contextKeys.length > 0 ? ` | context=${JSON.stringify(context)}` : '';
      await workerInstance.setJobStatus(jobID, JOB_STATUSES.running, {
        message: `${message || 'Progress update'}${serializedContext}`,
        ...(jobStateTracker ? { jobStateTracker } : {})
      });
    };
    try {
      await workerInstance.setJobStatus(jobID, JOB_STATUSES.running, {
        message: `Processing ${job.scope}`
      });
      providerConcurrencyToken = await providerConcurrencyGate.acquire({
        providerKey: resolveProviderKeyForJob(job),
        shouldAbort: () => cancelRequestedJobIDs.has(jobID),
        onWait: async ({ providerKey, maxConcurrency, activeCount, waitedMS, waitIteration }) => {
          const nowMS = Date.now();
          const isStatusUpdateDue = waitIteration === 1 || (nowMS - lastProviderWaitStatusUpdateMS) >= 15000;
          if (!isStatusUpdateDue) {
            return;
          }
          lastProviderWaitStatusUpdateMS = nowMS;
          try {
            await workerInstance.setJobStatus(jobID, JOB_STATUSES.running, {
              message: `Waiting for provider slot (${providerKey} ${activeCount}/${maxConcurrency})`,
              jobStateTracker: {
                PROVIDER_NAME: providerKey,
                PROVIDER_MAX_CONCURRENCY: maxConcurrency,
                PROVIDER_ACTIVE_CONCURRENCY: activeCount,
                PROVIDER_WAIT_TIME_MS: waitedMS
              }
            });
          } catch {
            // Best effort only.
          }
        }
      });
      if (providerConcurrencyToken?.acquired) {
        try {
          await workerInstance.setJobStatus(jobID, JOB_STATUSES.running, {
            message: `Provider slot acquired (${providerConcurrencyToken.providerKey})`,
            jobStateTracker: {
              PROVIDER_NAME: providerConcurrencyToken.providerKey,
              PROVIDER_MAX_CONCURRENCY: providerConcurrencyToken.maxConcurrency,
              PROVIDER_QUEUE_WAIT_MS: providerConcurrencyToken.waitedMS
            }
          });
        } catch {
          // Best effort only.
        }
      }

      const result = await processIngestionJob(job, { reportProgress, workerID });
      if (cancelRequestedJobIDs.has(jobID)) {
        cancelRequestedJobIDs.delete(jobID);
        state.cancelledJobCount += 1;
        await workerInstance.setJobStatus(jobID, JOB_STATUSES.cancelled, {
          message: 'Cancelled by producer request'
        });
        return;
      }

      if (!result?.success) {
        state.failedJobCount += 1;
        const failureData = buildFailureData(result, 'Job handler returned a failure result');
        await workerInstance.setJobStatus(jobID, JOB_STATUSES.failed, failureData);
        return;
      }

      state.completedJobCount += 1;
      await workerInstance.setJobStatus(jobID, JOB_STATUSES.completed, {
        message: 'Job completed successfully',
        ...(result?.jobStateTracker ? { jobStateTracker: result.jobStateTracker } : {}),
        result
      });
    } catch (error) {
      if (error instanceof ProviderConcurrencyWaitCancelledError) {
        cancelRequestedJobIDs.delete(jobID);
        state.cancelledJobCount += 1;
        await workerInstance.setJobStatus(jobID, JOB_STATUSES.cancelled, {
          message: 'Cancelled while waiting for provider concurrency slot'
        });
        return;
      }
      state.failedJobCount += 1;
      state.lastError = {
        message: error.message,
        timestamp: new Date().toISOString()
      };
      const failureData = buildFailureData(error, 'Unexpected worker failure');
      await workerInstance.setJobStatus(jobID, JOB_STATUSES.failed, failureData);
    } finally {
      providerConcurrencyGate.release(providerConcurrencyToken);
      activeJobIDs.delete(jobID);
    }
  });

  workerInstance.on('job:cancel', async ({ jobID }) => {
    cancelRequestedJobIDs.add(jobID);
    if (!activeJobIDs.has(jobID)) {
      state.cancelledJobCount += 1;
      await workerInstance.setJobStatus(jobID, JOB_STATUSES.cancelled, {
        message: 'Cancelled before execution'
      });
      cancelRequestedJobIDs.delete(jobID);
    }
  });

  await workerInstance.initialize();
  const idleReconciliationIntervalSecs = Math.max(
    5,
    Number(process.env.CDS_JOB_QUEUE_IDLE_RECONCILIATION_INTERVAL_SECS || 30)
  );
  idleReconciliationInterval = setInterval(() => {
    reconcilePendingJobsWhenIdle().catch(() => {});
  }, idleReconciliationIntervalSecs * 1000);
  if (typeof idleReconciliationInterval.unref === 'function') {
    idleReconciliationInterval.unref();
  }
  state.isReady = true;
  state.startedAt = new Date().toISOString();
  state.workerID = workerID;

  return getJobQueueStatus();
}

export async function shutdownJobQueueRuntime() {
  state.isReady = false;
  cancelRequestedJobIDs.clear();
  activeJobIDs.clear();
  if (idleReconciliationInterval) {
    clearInterval(idleReconciliationInterval);
    idleReconciliationInterval = null;
  }
  isReconciliationInProgress = false;

  if (workerInstance) {
    await workerInstance.shutdown();
    workerInstance = null;
  }
  providerConcurrencyGate = null;
}

export function getJobQueueStatus() {
  return {
    ...state,
    activeJobCount: activeJobIDs.size,
    activeJobIDs: [...activeJobIDs],
    providerConcurrency: providerConcurrencyGate?.getSnapshot?.() || {
      activeByProvider: {},
      waitingByProvider: {}
    }
  };
}

export default {
  initializeJobQueueRuntime,
  shutdownJobQueueRuntime,
  getJobQueueStatus
};
