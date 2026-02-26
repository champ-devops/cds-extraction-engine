#!/usr/bin/env node

import { initializeConfig } from '../config/appConfig.js';
import { getCoreApiClient } from '../clients/coreApiClient.js';
import { STT_EN_TRANSCRIPT_IDENTITY } from '../utils/transcriptIdentity.js';

const DEFAULT_JOB_STATUSES = ['completed', 'failed', 'running', 'cancelled', 'timeout', 'archived'];
const DEFAULT_SCOPES = new Set(['extraction:transcribe:media', 'transcription-poll']);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  validateArgs(args);
  await initializeConfig();

  const client = getCoreApiClient();
  const statusList = args.statuses.length > 0 ? args.statuses : DEFAULT_JOB_STATUSES;
  const scopeSet = new Set(args.scopes.length > 0 ? args.scopes : [...DEFAULT_SCOPES]);

  const jobs = await fetchJobs({
    client,
    customerID: args.customerID,
    statuses: statusList,
    source: args.source,
    maxJobs: args.maxJobs,
    pageSize: args.jobPageSize,
    verbose: args.verbose
  });

  const transcriptJobMapResult = buildTranscriptJobMap(jobs, scopeSet, args.since);
  const transcriptJobMap = transcriptJobMapResult.map;
  const transcripts = await fetchTranscripts({
    client,
    customerID: args.customerID,
    pageSize: args.transcriptPageSize,
    maxTranscripts: args.maxTranscripts
  });

  const updatePlan = buildUpdatePlan({
    transcripts,
    transcriptJobMap,
    isForce: args.isForce
  });

  printPlanSummary({
    customerID: args.customerID,
    statuses: statusList,
    scopes: [...scopeSet],
    totalJobsFetched: jobs.length,
    source: args.source,
    jobsInScope: transcriptJobMapResult.jobsInScope,
    jobsWithTranscriptHint: transcriptJobMapResult.jobsWithTranscriptHint,
    transcriptsScanned: transcripts.length,
    matchedTranscripts: updatePlan.matchedTranscripts,
    skippedTranscripts: updatePlan.skippedTranscripts,
    updatesPlanned: updatePlan.updates.length,
    isApply: args.isApply
  });
  if (args.verbose) {
    printScopeSummary(transcriptJobMapResult.scopeCounts);
    if (transcriptJobMapResult.sampleHints.length > 0) {
      process.stdout.write('sample transcript hints from jobs:\n');
      for (const hint of transcriptJobMapResult.sampleHints.slice(0, 10)) {
        process.stdout.write(`- scope=${hint.scope} transcriptID=${hint.transcriptID} jobID=${hint.jobID}\n`);
      }
    }
  }

  if (updatePlan.updates.length === 0) {
    return;
  }

  if (!args.isApply) {
    printDryRunPreview(updatePlan.updates, args.previewLimit);
    return;
  }

  const applyResult = await applyUpdates({
    client,
    customerID: args.customerID,
    updates: updatePlan.updates
  });
  printApplySummary(applyResult);
}

function parseArgs(argv) {
  const args = {
    customerID: '',
    statuses: [],
    scopes: [],
    isApply: false,
    isForce: false,
    jobPageSize: 200,
    transcriptPageSize: 200,
    maxJobs: 10000,
    maxTranscripts: 100000,
    previewLimit: 20,
    since: '',
    verbose: false
    ,
    source: 'both'
  };

  for (const rawArg of argv) {
    if (rawArg === '--apply') {
      args.isApply = true;
      continue;
    }
    if (rawArg === '--force') {
      args.isForce = true;
      continue;
    }
    if (rawArg === '--verbose') {
      args.verbose = true;
      continue;
    }
    if (rawArg.startsWith('--source=')) {
      const source = rawArg.slice('--source='.length).trim().toLowerCase();
      if (!['archived', 'queue', 'both'].includes(source)) {
        throw new Error(`Invalid --source value: ${source}`);
      }
      args.source = source;
      continue;
    }
    if (rawArg.startsWith('--customer-id=')) {
      args.customerID = rawArg.slice('--customer-id='.length).trim();
      continue;
    }
    if (rawArg.startsWith('--status=')) {
      args.statuses = splitCsv(rawArg.slice('--status='.length)).map((v) => v.toLowerCase());
      continue;
    }
    if (rawArg.startsWith('--scope=')) {
      args.scopes = splitCsv(rawArg.slice('--scope='.length));
      continue;
    }
    if (rawArg.startsWith('--job-page-size=')) {
      args.jobPageSize = toPositiveInt(rawArg.slice('--job-page-size='.length), 'job-page-size');
      continue;
    }
    if (rawArg.startsWith('--transcript-page-size=')) {
      args.transcriptPageSize = toPositiveInt(rawArg.slice('--transcript-page-size='.length), 'transcript-page-size');
      continue;
    }
    if (rawArg.startsWith('--max-jobs=')) {
      args.maxJobs = toPositiveInt(rawArg.slice('--max-jobs='.length), 'max-jobs');
      continue;
    }
    if (rawArg.startsWith('--max-transcripts=')) {
      args.maxTranscripts = toPositiveInt(rawArg.slice('--max-transcripts='.length), 'max-transcripts');
      continue;
    }
    if (rawArg.startsWith('--preview-limit=')) {
      args.previewLimit = toPositiveInt(rawArg.slice('--preview-limit='.length), 'preview-limit');
      continue;
    }
    if (rawArg.startsWith('--since=')) {
      args.since = rawArg.slice('--since='.length).trim();
      continue;
    }
    if (rawArg === '--help' || rawArg === '-h') {
      printUsageAndExit(0);
    }
    throw new Error(`Unknown argument: ${rawArg}`);
  }

  return args;
}

function validateArgs(args) {
  if (!args.customerID) {
    printUsageAndExit(1, '--customer-id is required');
  }
  if (args.since) {
    const parsed = Date.parse(args.since);
    if (!Number.isFinite(parsed)) {
      throw new Error(`Invalid --since value: ${args.since}`);
    }
  }
}

async function fetchJobs(params) {
  const { client, customerID, statuses, source, maxJobs, pageSize, verbose } = params;
  const allJobs = [];

  if (source === 'archived' || source === 'both') {
    const archivedJobs = await fetchArchivedJobs({
      client,
      customerID,
      statuses,
      maxJobs,
      pageSize,
      verbose
    });
    allJobs.push(...archivedJobs);
  }

  if ((source === 'queue' || source === 'both') && allJobs.length < maxJobs) {
    const queueJobs = await fetchQueueJobs({
      client,
      customerID,
      maxJobs: maxJobs - allJobs.length,
      verbose
    });
    allJobs.push(...queueJobs);
  }

  return dedupeJobsByID(allJobs).slice(0, maxJobs);
}

async function fetchArchivedJobs(params) {
  const { client, customerID, statuses, maxJobs, pageSize, verbose } = params;
  const jobs = [];
  for (const status of statuses) {
    let offset = 0;
    while (jobs.length < maxJobs) {
      const response = await client.listArchivedJobsByStatus(customerID, status, {
        limit: Math.min(pageSize, maxJobs - jobs.length),
        offset
      });
      const pageJobs = extractArray(response?.jobs);
      if (pageJobs.length === 0) {
        break;
      }
      for (const job of pageJobs) {
        jobs.push(job);
        if (jobs.length >= maxJobs) {
          break;
        }
      }
      if (verbose) {
        process.stdout.write(`Fetched ${jobs.length} archived jobs so far...\n`);
      }
      if (pageJobs.length < Math.min(pageSize, maxJobs - jobs.length + pageJobs.length)) {
        break;
      }
      offset += pageJobs.length;
    }
  }
  return jobs;
}

async function fetchQueueJobs(params) {
  const { client, customerID, maxJobs, verbose } = params;
  const completedIDs = extractArray(await client.listCompletedJobIDs(customerID));
  const archivedIDs = extractArray(await client.listArchivedJobIDs(customerID));
  const uniqueJobIDs = [...new Set([...completedIDs, ...archivedIDs].map((id) => String(id || '').trim()).filter(Boolean))].slice(0, maxJobs);

  const jobs = [];
  for (const jobID of uniqueJobIDs) {
    try {
      const job = await client.getJob(customerID, jobID);
      jobs.push(job);
      if (verbose) {
        process.stdout.write(`Fetched queue job ${jobs.length}/${uniqueJobIDs.length}: ${jobID}\n`);
      }
    } catch {
      // Ignore individual queue fetch errors and continue best effort.
    }
  }
  return jobs;
}

async function fetchTranscripts(params) {
  const { client, customerID, pageSize, maxTranscripts } = params;
  const transcripts = [];
  let offset = 0;
  while (transcripts.length < maxTranscripts) {
    const response = await client.listTranscripts(customerID, {
      ...STT_EN_TRANSCRIPT_IDENTITY,
      limit: Math.min(pageSize, maxTranscripts - transcripts.length),
      offset
    });
    const pageTranscripts = extractArray(response);
    if (pageTranscripts.length === 0) {
      break;
    }
    for (const transcript of pageTranscripts) {
      transcripts.push(transcript);
      if (transcripts.length >= maxTranscripts) {
        break;
      }
    }
    if (pageTranscripts.length < Math.min(pageSize, maxTranscripts - transcripts.length + pageTranscripts.length)) {
      break;
    }
    offset += pageTranscripts.length;
  }
  return transcripts;
}

function buildTranscriptJobMap(jobs, scopeSet, since) {
  const map = new Map();
  const sinceTimestampMS = since ? Date.parse(since) : null;
  const scopeCounts = new Map();
  let jobsInScope = 0;
  let jobsWithTranscriptHint = 0;
  const sampleHints = [];

  for (const job of jobs) {
    const scope = String(job?.scope || '').trim();
    incrementMap(scopeCounts, scope || '(missing)');
    if (!scopeSet.has(scope)) {
      continue;
    }
    jobsInScope += 1;

    const payload = normalizeObject(job?.payload);
    const result = normalizeObject(job?.result);
    const jobStateTracker = normalizeObject(job?.jobStateTracker);
    const resultJobStateTracker = normalizeObject(result?.jobStateTracker);
    const transcriptHint = findTranscriptIDFromJob(job, { payload, result, jobStateTracker, resultJobStateTracker });

    const transcriptID = String(transcriptHint || '').trim();
    if (!transcriptID) {
      continue;
    }
    jobsWithTranscriptHint += 1;

    const completedAtValue = job?.completedTimestamp || job?.completedAt || job?.updatedAt || job?.createdAt || null;
    const completedAtMS = parseTimestampMS(completedAtValue);
    if (Number.isFinite(sinceTimestampMS) && Number.isFinite(completedAtMS) && completedAtMS < sinceTimestampMS) {
      continue;
    }

    const jobID = String(job?.jobID || job?._id || '').trim();
    if (!jobID) {
      continue;
    }

    const workerID = String(
      job?.workerID
      || job?.workerId
      || resultJobStateTracker?.CDS_WORKER_ID
      || jobStateTracker?.CDS_WORKER_ID
      || findWorkerIDFromJob(job)
      || ''
    ).trim() || undefined;

    sampleHints.push({ scope, transcriptID, jobID });
    const existing = map.get(transcriptID);
    if (!existing || isNewerCandidate(completedAtMS, existing.completedAtMS)) {
      map.set(transcriptID, {
        transcriptID,
        jobID,
        workerID,
        scope,
        completedAtMS
      });
    }
  }

  return {
    map,
    scopeCounts,
    jobsInScope,
    jobsWithTranscriptHint,
    sampleHints
  };
}

function buildUpdatePlan(params) {
  const { transcripts, transcriptJobMap, isForce } = params;
  const updates = [];
  let matchedTranscripts = 0;
  let skippedTranscripts = 0;

  for (const transcript of transcripts) {
    const transcriptID = String(transcript?._id || transcript?.transcriptID || '').trim();
    if (!transcriptID) {
      skippedTranscripts += 1;
      continue;
    }
    const candidate = transcriptJobMap.get(transcriptID);
    if (!candidate) {
      skippedTranscripts += 1;
      continue;
    }
    matchedTranscripts += 1;

    const existingProviderMeta = normalizeObject(transcript?.providerMeta);
    const existingJobID = String(existingProviderMeta?.cdsJobID || '').trim();
    const existingWorkerID = String(existingProviderMeta?.cdsWorkerID || '').trim();

    const shouldSetJobID = isForce || !existingJobID;
    const shouldSetWorkerID = Boolean(candidate.workerID) && (isForce || !existingWorkerID);
    if (!shouldSetJobID && !shouldSetWorkerID) {
      skippedTranscripts += 1;
      continue;
    }

    const providerMeta = {
      ...existingProviderMeta,
      ...(shouldSetJobID ? { cdsJobID: candidate.jobID } : {}),
      ...(shouldSetWorkerID ? { cdsWorkerID: candidate.workerID } : {})
    };

    updates.push({
      transcriptID,
      providerMeta,
      jobID: candidate.jobID,
      workerID: candidate.workerID,
      scope: candidate.scope,
      previousJobID: existingJobID || undefined,
      previousWorkerID: existingWorkerID || undefined
    });
  }

  return {
    updates,
    matchedTranscripts,
    skippedTranscripts
  };
}

async function applyUpdates(params) {
  const { client, customerID, updates } = params;
  const result = {
    successCount: 0,
    failedCount: 0,
    failures: []
  };

  for (const update of updates) {
    try {
      await client.updateTranscript(customerID, update.transcriptID, {
        providerMeta: update.providerMeta
      });
      result.successCount += 1;
    } catch (error) {
      result.failedCount += 1;
      result.failures.push({
        transcriptID: update.transcriptID,
        error: String(error?.message || error)
      });
    }
  }

  return result;
}

function printPlanSummary(summary) {
  process.stdout.write('\nTranscript Job Metadata Backfill\n');
  process.stdout.write(`customerID: ${summary.customerID}\n`);
  process.stdout.write(`job source scanned: ${summary.source}\n`);
  process.stdout.write(`job statuses scanned: ${summary.statuses.join(', ')}\n`);
  process.stdout.write(`job scopes scanned: ${summary.scopes.join(', ')}\n`);
  process.stdout.write(`archived jobs fetched: ${summary.totalJobsFetched}\n`);
  process.stdout.write(`archived jobs in target scopes: ${summary.jobsInScope}\n`);
  process.stdout.write(`jobs with transcript hint: ${summary.jobsWithTranscriptHint}\n`);
  process.stdout.write(`transcripts scanned: ${summary.transcriptsScanned}\n`);
  process.stdout.write(`transcripts matched to jobs: ${summary.matchedTranscripts}\n`);
  process.stdout.write(`transcripts skipped: ${summary.skippedTranscripts}\n`);
  process.stdout.write(`transcripts ${summary.isApply ? 'to update' : 'would update'}: ${summary.updatesPlanned}\n`);
}

function printScopeSummary(scopeCounts) {
  process.stdout.write('archived job scope counts:\n');
  const pairs = [...scopeCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [scope, count] of pairs) {
    process.stdout.write(`- ${scope}: ${count}\n`);
  }
}

function printDryRunPreview(updates, previewLimit) {
  process.stdout.write('\nDry run preview:\n');
  const preview = updates.slice(0, previewLimit);
  for (const item of preview) {
    process.stdout.write(
      `- transcriptID=${item.transcriptID} cdsJobID=${item.jobID} cdsWorkerID=${item.workerID || '(none)'} scope=${item.scope}\n`
    );
  }
  if (updates.length > preview.length) {
    process.stdout.write(`... and ${updates.length - preview.length} more\n`);
  }
  process.stdout.write('\nNo changes were written. Re-run with --apply to persist.\n');
}

function printApplySummary(result) {
  process.stdout.write('\nBackfill apply complete\n');
  process.stdout.write(`updated: ${result.successCount}\n`);
  process.stdout.write(`failed: ${result.failedCount}\n`);
  if (result.failures.length > 0) {
    process.stdout.write('failures:\n');
    for (const failure of result.failures) {
      process.stdout.write(`- transcriptID=${failure.transcriptID} error=${failure.error}\n`);
    }
  }
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function toPositiveInt(rawValue, flagName) {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    throw new Error(`Invalid --${flagName} value: ${rawValue}`);
  }
  return value;
}

function extractArray(response) {
  if (Array.isArray(response)) {
    return response;
  }
  if (Array.isArray(response?.items)) {
    return response.items;
  }
  if (Array.isArray(response?.data)) {
    return response.data;
  }
  if (Array.isArray(response?.results)) {
    return response.results;
  }
  if (Array.isArray(response?.jobs)) {
    return response.jobs;
  }
  return [];
}

function normalizeObject(value) {
  if (!value) {
    return {};
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function parseTimestampMS(value) {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function isNewerCandidate(nextTimestampMS, currentTimestampMS) {
  if (!Number.isFinite(currentTimestampMS)) {
    return true;
  }
  if (!Number.isFinite(nextTimestampMS)) {
    return false;
  }
  return nextTimestampMS > currentTimestampMS;
}

function findTranscriptIDFromJob(job, normalized = {}) {
  const directCandidates = [
    normalized.payload?.transcriptID,
    normalized.result?.transcriptID,
    normalized.resultJobStateTracker?.CDS_EXTRACTION_ID,
    normalized.jobStateTracker?.CDS_EXTRACTION_ID,
    normalized.resultJobStateTracker?.CDS_TRANSCRIPT_ID,
    normalized.jobStateTracker?.CDS_TRANSCRIPT_ID,
    normalizeObject(job?.details)?.transcriptID,
    normalizeObject(job?.context)?.transcriptID
  ];
  for (const candidate of directCandidates) {
    const value = String(candidate || '').trim();
    if (value) {
      return value;
    }
  }

  const recursiveObjects = [
    normalized.payload,
    normalized.result,
    normalized.jobStateTracker,
    normalized.resultJobStateTracker,
    normalizeObject(job?.details),
    normalizeObject(job?.context),
    normalizeObject(job?.error)
  ];
  for (const value of recursiveObjects) {
    const found = findValueForKeysRecursive(value, ['transcriptID', 'CDS_EXTRACTION_ID', 'CDS_TRANSCRIPT_ID', 'transcriptId', 'transcript_id']);
    if (found) {
      return found;
    }
  }

  const messageText = String(job?.message || '');
  const fromMessage = matchFirstGroup(
    messageText,
    [
      /"transcriptID"\s*:\s*"([^"]+)"/i,
      /"CDS_EXTRACTION_ID"\s*:\s*"([^"]+)"/i,
      /"CDS_TRANSCRIPT_ID"\s*:\s*"([^"]+)"/i,
      /transcriptID=([A-Za-z0-9:_-]+)/i
    ]
  );
  if (fromMessage) {
    return fromMessage;
  }

  return '';
}

function findWorkerIDFromJob(job) {
  const recursiveObjects = [
    normalizeObject(job?.details),
    normalizeObject(job?.context),
    normalizeObject(job?.result),
    normalizeObject(job?.error)
  ];
  for (const value of recursiveObjects) {
    const found = findValueForKeysRecursive(value, ['workerID', 'workerId', 'CDS_WORKER_ID', 'cdsWorkerID']);
    if (found) {
      return found;
    }
  }
  const messageText = String(job?.message || '');
  return matchFirstGroup(
    messageText,
    [
      /"CDS_WORKER_ID"\s*:\s*"([^"]+)"/i,
      /"workerID"\s*:\s*"([^"]+)"/i,
      /workerID=([A-Za-z0-9:_-]+)/i
    ]
  ) || '';
}

function findValueForKeysRecursive(value, keys) {
  if (!value || typeof value !== 'object') {
    return '';
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findValueForKeysRecursive(item, keys);
      if (found) {
        return found;
      }
    }
    return '';
  }

  for (const [key, nextValue] of Object.entries(value)) {
    if (keys.includes(key)) {
      const normalized = String(nextValue || '').trim();
      if (normalized) {
        return normalized;
      }
    }
  }

  for (const nextValue of Object.values(value)) {
    if (typeof nextValue === 'string') {
      const parsed = normalizeObject(nextValue);
      if (Object.keys(parsed).length > 0) {
        const found = findValueForKeysRecursive(parsed, keys);
        if (found) {
          return found;
        }
      }
      continue;
    }
    if (nextValue && typeof nextValue === 'object') {
      const found = findValueForKeysRecursive(nextValue, keys);
      if (found) {
        return found;
      }
    }
  }
  return '';
}

function matchFirstGroup(text, patterns) {
  for (const pattern of patterns) {
    const match = String(text || '').match(pattern);
    if (match?.[1]) {
      return String(match[1]).trim();
    }
  }
  return '';
}

function incrementMap(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function dedupeJobsByID(jobs) {
  const deduped = new Map();
  for (const job of jobs) {
    const jobID = String(job?.jobID || job?._id || '').trim();
    if (!jobID) {
      continue;
    }
    if (!deduped.has(jobID)) {
      deduped.set(jobID, job);
    }
  }
  return [...deduped.values()];
}

function printUsageAndExit(code, message = '') {
  if (message) {
    process.stderr.write(`${message}\n\n`);
  }
  process.stderr.write(`Usage:
  node src/cli/backfill-transcript-job-meta.js --customer-id=<customerID> [options]

Options:
  --apply                           Write updates (default is dry-run)
  --force                           Overwrite existing cdsJobID/cdsWorkerID values
  --status=completed,failed         Archived job statuses to scan
  --scope=extraction:transcribe:media,transcription-poll
  --source=both                      Job source: archived, queue, both (default both)
  --since=2025-01-01T00:00:00Z      Only consider jobs completed on/after this timestamp
  --job-page-size=200               Page size for archived jobs endpoint
  --transcript-page-size=200        Page size for transcripts endpoint
  --max-jobs=10000                  Hard cap on archived jobs fetched
  --max-transcripts=100000          Hard cap on transcripts scanned
  --preview-limit=20                Dry-run rows printed
  --verbose                         Print progress while fetching jobs
  --help                            Show this help
`);
  process.exit(code);
}

export const __testables = {
  fetchTranscripts
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`Backfill failed: ${error?.message || error}\n`);
    process.exit(1);
  });
}
