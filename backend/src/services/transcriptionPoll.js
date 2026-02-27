import { request } from 'undici';
import { getConfig } from '../config/appConfig.js';
import { getCoreApiClient } from '../clients/coreApiClient.js';
import { finalizeTranscription } from './transcriptionFinalize.js';

/**
 * Process a transcription-poll job payload.
 * Supports:
 * 1) Inline completion payloads (providerResponse/chunkResponses)
 * 2) AssemblyAI polling by providerJobID(s)
 *
 * @param {{scope?:string,payload:object}|object} job
 * @param {{
 *   coreApiClient?:object,
 *   finalizeTranscriptionHandler?:(params:object)=>Promise<object>,
 *   fetchAssemblyAITranscript?:(params:{providerJobID:string,config:object})=>Promise<object>,
 *   fetchRevAIJobStatus?:(params:{providerJobID:string,config:object})=>Promise<object>,
 *   fetchRevAITranscript?:(params:{providerJobID:string,config:object})=>Promise<object>
 * }} [deps]
 * @returns {Promise<object>}
 */
export async function processTranscriptionPollJob(job, deps = {}) {
  const payload = job?.payload || job || {};
  const customerID = payload.customerID;
  const transcriptID = payload.transcriptID;
  const provider = String(payload.provider || '').toUpperCase();
  const providerResponse = payload.providerResponse;
  const chunkResponses = payload.chunkResponses;
  const chunkMap = payload.chunkMap;
  const providerJobID = payload.providerJobID;
  const providerJobIDs = Array.isArray(payload.providerJobIDs) ? payload.providerJobIDs : [];
  const executionContext = {
    cdsJobID: payload.cdsJobID,
    cdsWorkerID: payload.cdsWorkerID
  };

  if (!customerID) throw new Error('customerID is required');
  if (!transcriptID) throw new Error('transcriptID is required');
  if (!provider) throw new Error('provider is required');

  const coreApiClient = deps.coreApiClient || getCoreApiClient();
  const finalizeTranscriptionHandler = deps.finalizeTranscriptionHandler || finalizeTranscription;
  const fetchAssemblyAITranscript = deps.fetchAssemblyAITranscript || fetchAssemblyAITranscriptFromAPI;
  const fetchRevAIJobStatus = deps.fetchRevAIJobStatus || fetchRevAIJobStatusFromAPI;
  const fetchRevAITranscript = deps.fetchRevAITranscript || fetchRevAITranscriptFromAPI;

  // If completion payload is already attached, finalize immediately.
  const isChunkedInline = Array.isArray(chunkResponses) && chunkResponses.length > 0;
  if (providerResponse || isChunkedInline) {
    const result = await finalizeTranscriptionHandler({
      customerID,
      transcriptID,
      provider,
      providerResponse,
      chunkResponses,
      chunkMap,
      coreApiClient,
      executionContext
    });
    return {
      ...result,
      status: 'completed',
      isFinal: true
    };
  }

  const isAssemblyAIWithCustomFetcher = provider === 'ASSEMBLYAI' && typeof deps.fetchAssemblyAITranscript === 'function';
  const isRevAIWithCustomFetchers = provider === 'REVAI'
    && typeof deps.fetchRevAIJobStatus === 'function'
    && typeof deps.fetchRevAITranscript === 'function';
  const config = deps.config || (isAssemblyAIWithCustomFetcher || isRevAIWithCustomFetchers ? undefined : getConfig());
  const pollJobIDs = providerJobIDs.length > 0 ? providerJobIDs : [providerJobID].filter(Boolean);
  if (pollJobIDs.length === 0) {
    throw new Error('providerJobID or providerJobIDs is required for polling');
  }

  const pollResponses = [];
  for (let chunkIndex = 0; chunkIndex < pollJobIDs.length; chunkIndex++) {
    const currentProviderJobID = pollJobIDs[chunkIndex];
    const { response, status } = await fetchProviderTranscriptByJobID({
      provider,
      providerJobID: currentProviderJobID,
      config,
      fetchAssemblyAITranscript,
      fetchRevAIJobStatus,
      fetchRevAITranscript
    });
    pollResponses.push({
      chunkIndex,
      providerJobID: currentProviderJobID,
      response,
      status
    });
  }

  const failedResponses = pollResponses.filter(item => item.status === 'error' || item.status === 'failed' || item.status === 'canceled');
  const completedProviderJobIDs = pollResponses
    .filter(item => item.status === 'completed')
    .map(item => item.providerJobID);
  if (failedResponses.length > 0) {
    const failedJobIDs = failedResponses.map(item => item.providerJobID);
    const existingTranscript = (typeof coreApiClient.getTranscript === 'function')
      ? await coreApiClient.getTranscript(customerID, transcriptID).catch(() => null)
      : null;
    const existingProviderMeta = (existingTranscript?.providerMeta && typeof existingTranscript.providerMeta === 'object')
      ? existingTranscript.providerMeta
      : {};
    await coreApiClient.updateTranscript(customerID, transcriptID, {
      status: 'FAILED',
      cdsJobID: executionContext?.cdsJobID || undefined,
      providerMeta: buildProviderMetaWithExecutionContext({
        existingProviderMeta,
        executionContext,
        poll: {
          status: 'failed',
          providerJobIDs: pollJobIDs,
          failedProviderJobIDs: failedJobIDs
        }
      })
    });
    return {
      success: false,
      transcriptID,
      status: 'failed',
      isFinal: true,
      completedProviderJobIDs,
      error: `Provider reported failure for job(s): ${failedJobIDs.join(', ')}`
    };
  }

  const pendingResponses = pollResponses.filter(item => item.status !== 'completed');
  if (pendingResponses.length > 0) {
    const existingTranscript = (typeof coreApiClient.getTranscript === 'function')
      ? await coreApiClient.getTranscript(customerID, transcriptID).catch(() => null)
      : null;
    const existingProviderMeta = (existingTranscript?.providerMeta && typeof existingTranscript.providerMeta === 'object')
      ? existingTranscript.providerMeta
      : {};
    await coreApiClient.updateTranscript(customerID, transcriptID, {
      status: 'RUNNING',
      cdsJobID: executionContext?.cdsJobID || undefined,
      providerMeta: buildProviderMetaWithExecutionContext({
        existingProviderMeta,
        executionContext,
        poll: {
          status: 'processing',
          providerJobIDs: pollJobIDs,
          pendingProviderJobIDs: pendingResponses.map(item => item.providerJobID)
        }
      })
    });
    return {
      success: true,
      transcriptID,
      status: 'processing',
      isFinal: false,
      completedProviderJobIDs,
      pendingProviderJobIDs: pendingResponses.map(item => item.providerJobID)
    };
  }

  if (pollResponses.length === 1) {
    const result = await finalizeTranscriptionHandler({
      customerID,
      transcriptID,
      provider,
      providerResponse: pollResponses[0].response,
      coreApiClient,
      executionContext
    });
    return {
      ...result,
      status: 'completed',
      completedProviderJobIDs,
      isFinal: true
    };
  }

  if (!Array.isArray(chunkMap) || chunkMap.length === 0) {
    throw new Error('chunkMap is required for multi-job polling finalization');
  }

  const finalizedChunkResponses = pollResponses.map(item => ({
    chunkIndex: item.chunkIndex,
    response: item.response
  }));

  const chunkedResult = await finalizeTranscriptionHandler({
    customerID,
    transcriptID,
    provider,
    chunkResponses: finalizedChunkResponses,
    chunkMap,
    coreApiClient,
    executionContext
  });

  return {
    ...chunkedResult,
    status: 'completed',
    completedProviderJobIDs,
    isFinal: true
  };
}

async function fetchAssemblyAITranscriptFromAPI(params) {
  const { providerJobID, config } = params;
  const apiKey = config.transcription?.assemblyai?.apiKey;
  const baseUrl = (config.transcription?.assemblyai?.baseUrl || 'https://api.assemblyai.com/v2').replace(/\/+$/, '');
  if (!apiKey) {
    throw new Error('ASSEMBLYAI_API_KEY is required');
  }

  const response = await request(`${baseUrl}/transcript/${providerJobID}`, {
    method: 'GET',
    headers: { authorization: apiKey }
  });
  const data = await response.body.json();
  if (response.statusCode >= 400) {
    const message = data?.error || `AssemblyAI poll failed (${response.statusCode})`;
    throw new Error(message);
  }
  return data;
}

async function fetchRevAIJobStatusFromAPI(params) {
  const { providerJobID, config } = params;
  const apiKey = config.transcription?.revai?.apiKey;
  const baseUrl = (config.transcription?.revai?.baseUrl || 'https://api.rev.ai/speechtotext/v1').replace(/\/+$/, '');
  if (!apiKey) {
    throw new Error('REVAI_API_KEY is required');
  }

  const response = await request(`${baseUrl}/jobs/${providerJobID}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${apiKey}` }
  });
  const data = await response.body.json();
  if (response.statusCode >= 400) {
    const message = data?.failure || data?.message || `Rev.ai status fetch failed (${response.statusCode})`;
    throw new Error(message);
  }
  return data;
}

async function fetchRevAITranscriptFromAPI(params) {
  const { providerJobID, config } = params;
  const apiKey = config.transcription?.revai?.apiKey;
  const baseUrl = (config.transcription?.revai?.baseUrl || 'https://api.rev.ai/speechtotext/v1').replace(/\/+$/, '');
  if (!apiKey) {
    throw new Error('REVAI_API_KEY is required');
  }

  const response = await request(`${baseUrl}/jobs/${providerJobID}/transcript`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: 'application/vnd.rev.transcript.v1.0+json'
    }
  });
  const data = await response.body.json();
  if (response.statusCode >= 400) {
    const message = data?.failure || data?.message || `Rev.ai transcript fetch failed (${response.statusCode})`;
    throw new Error(message);
  }
  return data;
}

async function fetchProviderTranscriptByJobID(params) {
  const {
    provider,
    providerJobID,
    config,
    fetchAssemblyAITranscript,
    fetchRevAIJobStatus,
    fetchRevAITranscript
  } = params;
  const normalizedProvider = String(provider || '').toUpperCase();

  if (normalizedProvider === 'ASSEMBLYAI') {
    const response = await fetchAssemblyAITranscript({ providerJobID, config });
    return {
      response,
      status: normalizeProviderPollStatus(normalizedProvider, response?.status)
    };
  }

  if (normalizedProvider === 'REVAI') {
    const statusResponse = await fetchRevAIJobStatus({ providerJobID, config });
    const normalizedStatus = normalizeProviderPollStatus(normalizedProvider, statusResponse?.status);
    if (normalizedStatus !== 'completed') {
      return { response: statusResponse, status: normalizedStatus };
    }
    const transcriptResponse = await fetchRevAITranscript({ providerJobID, config });
    return {
      response: {
        ...transcriptResponse,
        id: transcriptResponse?.id || providerJobID
      },
      status: normalizedStatus
    };
  }

  throw new Error(`Polling fetch not implemented for provider ${provider}. Supply providerResponse/chunkResponses in job payload.`);
}

function normalizeProviderPollStatus(provider, status) {
  const normalizedProvider = String(provider || '').toUpperCase();
  const normalizedStatus = String(status || '').trim().toLowerCase();

  if (normalizedProvider === 'REVAI') {
    if (normalizedStatus === 'transcribed' || normalizedStatus === 'completed') return 'completed';
    if (normalizedStatus === 'failed') return 'failed';
    return 'processing';
  }

  return normalizedStatus;
}

export default {
  processTranscriptionPollJob
};

function buildProviderMetaWithExecutionContext(params) {
  const { existingProviderMeta, executionContext, poll } = params;
  const providerMeta = {
    ...(existingProviderMeta && typeof existingProviderMeta === 'object' ? existingProviderMeta : {})
  };
  if (executionContext?.cdsJobID) {
    providerMeta.cdsJobID = executionContext.cdsJobID;
  }
  if (executionContext?.cdsWorkerID) {
    providerMeta.cdsWorkerID = executionContext.cdsWorkerID;
  }
  providerMeta.poll = poll;
  return providerMeta;
}
