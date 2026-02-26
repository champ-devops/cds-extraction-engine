/**
 * Transcript Ingestion Service
 * 
 * Handles the three ingestion paths:
 * 1. Provider JSON import (AssemblyAI, DeepGram)
 * 2. Media-based transcription (extract audio, send to provider, receive transcript)
 * 3. Caption file import (SRT/VTT)
 */

import { parse, validateUtterances, ProviderType } from '../parsers/index.js';
import { getCoreApiClient } from '../clients/coreApiClient.js';
import { getConfig } from '../config/appConfig.js';
import { request, FormData } from 'undici';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { analyzeSilence } from './silenceDetection.js';
import { buildChunkMapFromSilence, planSegmentSubmission } from './timestampRemap.js';
import { processTranscriptionPollJob } from './transcriptionPoll.js';
import {
  buildMediaPathFromV1Media,
  getMediaByLocationName,
  getMediaByV1MediaID,
  lookupLegacyCustomerIDByV2CustomerID,
  resolveLegacyMediaContext
} from './customerApiData.js';
import { buildEventKeyTerms, buildEventMediaContext } from './eventHints.js';
import { STT_EN_TRANSCRIPT_IDENTITY } from '../utils/transcriptIdentity.js';

const execFileAsync = promisify(execFile);
const EVENT_HINTS_PROPER_NOUN_EXTRACTION_FAILED = 'EVENT_HINTS_PROPER_NOUN_EXTRACTION_FAILED';
const EXTERNAL_MEDIA_ID_PREFIX_CUSTOMER_MEDIA_ID = 'CDSV1CustomerMediaID:';
const EXTERNAL_MEDIA_ID_PREFIX_MEDIA_ID = 'CDSV1MediaID:';
const EXTERNAL_MEDIA_ID_PREFIX_PATH = 'CDSV1Path:';

/**
 * @typedef {object} IngestionResult
 * @property {boolean} success - Whether ingestion succeeded
 * @property {string} [transcriptID] - Created transcript ID
 * @property {number} [utteranceCount] - Number of utterances created
 * @property {string} [error] - Error message if failed
 * @property {object} [details] - Additional details
 */

/**
 * @typedef {object} IngestionOptions
 * @property {string} customerID - Customer ID (required)
 * @property {string} [mediaID] - Media ID (one of mediaID or externalMediaID required)
 * @property {string} [externalMediaID] - External media ID
 * @property {string} [provider] - Force specific provider (ASSEMBLYAI, DEEPGRAM, REVAI, SRT, VTT)
 * @property {string} [captionerName] - For caption files, the name of the captioner
 * @property {boolean} [extractSpeakers] - For caption files, try to extract speakers from text
 */

/**
 * Ingest transcript from provider JSON content
 * 
 * Path 1: Provider JSON Import
 * 
 * @param {string|object} content - JSON content (string or object)
 * @param {IngestionOptions} options - Ingestion options
 * @returns {Promise<IngestionResult>} Ingestion result
 */
export async function ingestProviderJSON(content, options) {
  const { customerID, mediaID, externalMediaID, provider } = options;

  // Validate required fields
  if (!customerID) {
    return { success: false, error: 'customerID is required' };
  }
  if (!mediaID && !externalMediaID) {
    return { success: false, error: 'Either mediaID or externalMediaID is required' };
  }

  try {
    // Parse the provider content
    const parsed = parse(content, { provider });

    // Validate utterances
    const validation = validateUtterances(parsed.utterances);
    if (!validation.isValid) {
      return {
        success: false,
        error: 'Invalid utterances',
        details: { validationErrors: validation.errors }
      };
    }

    // Create transcript and utterances via CoreAPI
    const result = await createTranscriptWithUtterances(customerID, {
      mediaID,
      externalMediaID,
      transcriptInfo: parsed.transcriptInfo,
      utterances: parsed.utterances
    });

    return result;
  } catch (err) {
    return {
      success: false,
      error: err.message,
      details: { stack: err.stack }
    };
  }
}

/**
 * Ingest transcript from caption file content
 * 
 * Path 3: Caption File Import
 * 
 * @param {string} content - Caption file content (SRT or VTT format)
 * @param {IngestionOptions} options - Ingestion options
 * @returns {Promise<IngestionResult>} Ingestion result
 */
export async function ingestCaptionFile(content, options) {
  const { customerID, mediaID, externalMediaID, captionerName, extractSpeakers } = options;

  // Validate required fields
  if (!customerID) {
    return { success: false, error: 'customerID is required' };
  }
  if (!mediaID && !externalMediaID) {
    return { success: false, error: 'Either mediaID or externalMediaID is required' };
  }
  if (typeof content !== 'string') {
    return { success: false, error: 'Caption content must be a string' };
  }

  try {
    // Parse the caption file
    const parsed = parse(content, {
      captionerName,
      extractSpeakers: extractSpeakers !== false  // Default true
    });

    // Validate utterances
    const validation = validateUtterances(parsed.utterances);
    if (!validation.isValid) {
      return {
        success: false,
        error: 'Invalid utterances',
        details: { validationErrors: validation.errors }
      };
    }

    // Create transcript and utterances via CoreAPI
    const result = await createTranscriptWithUtterances(customerID, {
      mediaID,
      externalMediaID,
      transcriptInfo: parsed.transcriptInfo,
      utterances: parsed.utterances
    });

    return result;
  } catch (err) {
    return {
      success: false,
      error: err.message,
      details: { stack: err.stack }
    };
  }
}

/**
 * Create transcript and utterances in CoreAPI
 * @param {string} customerID - Customer ID
 * @param {object} data - Transcript and utterance data
 * @returns {Promise<IngestionResult>} Result with transcript ID and utterance count
 */
async function createTranscriptWithUtterances(customerID, data) {
  const client = data?.client || getCoreApiClient();
  const { mediaID, externalMediaID, transcriptInfo, utterances } = data;
  const providerName = resolveProviderNameForCreate(transcriptInfo, utterances);

  // Resolve mediaID if only externalMediaID provided
  let resolvedMediaID = mediaID;
  if (!resolvedMediaID && externalMediaID) {
    // Try to find media by external ID
    const mediaList = await client.findMediaByExternalID(customerID, externalMediaID);
    if (mediaList && mediaList.length > 0) {
      resolvedMediaID = mediaList[0]._id;
    } else {
      // Use a placeholder if media not found (will be linked later)
      resolvedMediaID = `EXTERNAL:${externalMediaID}`;
    }
  }

  // Create transcript
  const transcriptData = {
    ...STT_EN_TRANSCRIPT_IDENTITY,
    mediaID: resolvedMediaID,
    status: 'COMPLETE',
    externalMediaID: externalMediaID || undefined,
    providerName,
    providerJobID: transcriptInfo.providerJobID || undefined,
    providerMeta: transcriptInfo.providerMeta || undefined,
    textOriginal: transcriptInfo.textOriginal || transcriptInfo.fullText || '',
    textOriginalSource: utterances.length > 0 ? utterances[0].textOriginalSource : undefined
  };

  const transcript = await client.createTranscript(customerID, transcriptData);
  const transcriptID = transcript._id;

  // Create utterances in batch
  let createdUtterances = [];
  if (utterances.length > 0) {
    // Add transcriptID to each utterance (CoreAPI may do this automatically, but be explicit)
    const utteranceData = utterances.map(u => ({
      speakerOriginal: u.speakerOriginal,
      textOriginal: u.textOriginal,
      startMS: u.startMS,
      endMS: u.endMS,
      confidence: u.confidence,
      segmentIndex: u.segmentIndex,
      textOriginalSource: u.textOriginalSource
    }));

    createdUtterances = await client.createUtterances(customerID, transcriptID, utteranceData);
  }

  return {
    success: true,
    transcriptID,
    utteranceCount: Array.isArray(createdUtterances) ? createdUtterances.length : utterances.length,
    details: {
      providerName,
      providerJobID: transcriptInfo.providerJobID,
      audioDurationMS: transcriptInfo.audioDurationMS,
      overallConfidence: transcriptInfo.overallConfidence
    }
  };
}

/**
 * Job scope identifiers for queue integration
 */
export const JobScopes = {
  INGEST_PROVIDER_JSON: 'extraction:ingest:provider-json',
  INGEST_CAPTION_FILE: 'extraction:ingest:caption-file',
  TRANSCRIBE_MEDIA: 'extraction:transcribe:media',
  EXTRACT_SILENCE_MEDIA: 'extraction:silence:media',
  TRANSCRIPTION_POLL: 'transcription-poll',
  ENHANCE_CAPTIONS: 'extraction:enhance:captions'
};

/**
 * Submit media for transcription (Path 2)
 * Flow:
 * 1) Use local AAC cache if present
 * 2) Else fetch MP4 from DFW and extract AAC
 * 3) Upload AAC to provider and submit job
 * 4) Create pending transcript in CoreAPI
 * 5) Poll/finalize provider response within the same worker job
 * 6) Delete downloaded MP4 immediately, keep AAC for TTL reuse
 *
 * @param {IngestionOptions & { provider?: string, options?: object, mediaPath?: string, transcriptID?: string, providerJobID?: string, providerJobIDs?: string[], chunkMap?: object[], cdsJobID?: string, cdsWorkerID?: string, onProgress?:(data:object)=>Promise<void> }} options
 * @returns {Promise<IngestionResult & { providerJobID?: string, mediaSource?: string, audioExtracted?: boolean }>}
 */
export async function submitMediaForTranscription(options) {
  const {
    customerID: requestedCustomerID,
    mediaID: requestedMediaID,
    externalMediaID: requestedExternalMediaID,
    cdsMediaID,
    cdsV1MediaID,
    cdsV1EventID,
    transcriptID: requestedTranscriptID,
    providerJobID: requestedProviderJobID,
    providerJobIDs: requestedProviderJobIDs,
    chunkMap: requestedChunkMap,
    cdsJobID,
    cdsWorkerID,
    provider = ProviderType.ASSEMBLYAI,
    options: requestedProviderOptions = {},
    mediaPath,
    onProgress
  } = options;

  let customerID = requestedCustomerID;
  let mediaPathCustomerID = requestedCustomerID;
  let mediaID = requestedMediaID || cdsMediaID;
  let externalMediaID = requestedExternalMediaID;
  let providerOptions = (requestedProviderOptions && typeof requestedProviderOptions === 'object')
    ? { ...requestedProviderOptions }
    : {};
  const isAIKeyHintExtractionEnabled = providerOptions.useAIKeyHintExtraction === true;
  const isAIKeyHintExtractionFailureFatal = providerOptions.isAIKeyHintExtractionFailureFatal !== false;
  const isEventHintResolver = Boolean(cdsV1EventID);
  const eventHintWarnings = [];
  let eventAndItemsExtractionResult = null;

  if (!customerID) {
    return { success: false, error: 'customerID is required' };
  }
  if (!requestedTranscriptID && !mediaID && !externalMediaID && !mediaPath && !cdsV1MediaID && !isEventHintResolver) {
    return {
      success: false,
      error: 'One of transcriptID, mediaID, externalMediaID, cdsMediaID, cdsV1MediaID, mediaPath, or cdsV1EventID is required'
    };
  }

  const config = getConfig();
  const mediaConfig = config.media || {};
  const localBasePath = mediaConfig.localBasePath || '/mnt/media';
  const tempBasePath = mediaConfig.tempBasePath || '/tmp/media-processing';
  const dfwBaseUrl = mediaConfig.dfw?.baseUrl || '';
  const localAACCacheSecs = Number(mediaConfig.localAACCacheSecs || process.env.LOCAL_AAC_CACHE_SECS || 86400);
  const localAACCacheTTLMS = localAACCacheSecs * 1000;
  const defaultSilenceNoiseDB = Number(mediaConfig.silenceDetection?.noiseDB ?? -35);
  const defaultSilenceMinSecs = Number(mediaConfig.silenceDetection?.minSilenceSecs ?? 2);
  const defaultSilenceMinSecsToSave = Number(mediaConfig.silenceDetection?.minSilenceSecsToSave ?? defaultSilenceMinSecs);
  const defaultIsChunkingEnabled = mediaConfig.silenceDetection?.isChunkingEnabled ?? true;
  const defaultMaxSegmentCount = Number(mediaConfig.silenceDetection?.maxSegmentCount ?? 12);
  const defaultMaxSegmentDurationSecs = Number(mediaConfig.silenceDetection?.maxSegmentDurationSecs ?? 3600);
  const defaultSegmentOverlapSecs = Number(mediaConfig.silenceDetection?.segmentOverlapSecs ?? 5);
  const ffmpegTimeoutSecs = Number(mediaConfig.ffmpegTimeoutSecs ?? process.env.FFMPEG_TIMEOUT_SECS ?? 1800);
  const ffmpegTimeoutMS = Math.max(0, ffmpegTimeoutSecs * 1000);
  const pollIntervalSecs = Number(providerOptions.pollIntervalSecs ?? mediaConfig.pollIntervalSecs ?? 30);
  const pollTimeoutSecs = Number(providerOptions.pollTimeoutSecs ?? mediaConfig.pollTimeoutSecs ?? 7200);

  if (!dfwBaseUrl && !mediaPath && !cdsV1MediaID && !isEventHintResolver) {
    return { success: false, error: 'DFW_MEDIA_BASE_URL is required when mediaPath is not locally resolvable' };
  }

  let downloadedMp4Path = null;
  const temporaryChunkPaths = [];
  let resolvedMediaPath = mediaPath || null;
  let legacyLookupContext = null;
  let transcriptID = null;
  let currentStage = 'initialize';
  const debugContext = {
    requestedCustomerID,
    customerID,
    mediaPathCustomerID,
    mediaID,
    externalMediaID,
    cdsMediaID,
    cdsV1MediaID,
    cdsV1EventID,
    isAIKeyHintExtractionEnabled,
    isAIKeyHintExtractionFailureFatal,
    requestedMediaPath: mediaPath || null,
    provider: String(provider || '').toUpperCase(),
    cdsJobID: cdsJobID || null,
    cdsWorkerID: cdsWorkerID || null,
    config: {
      hasDfwBaseUrl: Boolean(dfwBaseUrl),
      localBasePath,
      tempBasePath,
      localAACCacheSecs
    }
  };
  const reportProgress = async (data = {}) => {
    if (typeof onProgress !== 'function') {
      return;
    }
    try {
      await onProgress(data);
    } catch {
      // Best effort only.
    }
  };
  const taskStartedAtMS = Date.now();
  const statsTracker = {};
  const segmentSubmittedAtMSByProviderJobID = {};
  const segmentDurationCapturedByProviderJobID = {};
  const upsertStats = async (nextStats = {}, message = 'Stats updated') => {
    Object.assign(statsTracker, nextStats);
    await reportProgress({
      message,
      jobStateTracker: {
        ...statsTracker
      }
    });
  };
  if (cdsJobID) {
    statsTracker.CDS_JOB_ID = cdsJobID;
  }
  if (cdsWorkerID) {
    statsTracker.CDS_WORKER_ID = cdsWorkerID;
  }

  try {
    await reportProgress({
      stage: currentStage,
      message: 'Initializing transcription workflow',
      jobStateTracker: {
        ...statsTracker
      }
    });

    const eventHintResolution = await resolveEventKeyHintAugmentation({
      requestedTranscriptID,
      cdsV1EventID,
      isAIKeyHintExtractionEnabled,
      isAIKeyHintExtractionFailureFatal,
      customerID,
      provider,
      mediaID,
      externalMediaID,
      resolvedMediaPath,
      cdsV1MediaID,
      providerOptions,
      lookupLegacyCustomerIDByV2CustomerIDHandler: lookupLegacyCustomerIDByV2CustomerID,
      buildEventMediaContextHandler: buildEventMediaContext,
      buildEventKeyTermsHandler: buildEventKeyTerms
    });
    resolvedMediaPath = eventHintResolution.resolvedMediaPath;
    providerOptions = eventHintResolution.providerOptions;
    eventHintWarnings.push(...eventHintResolution.eventHintWarnings);
    debugContext.aiKeyHintExtraction = eventHintResolution.debug;
    if (eventHintResolution.fatalError) {
      return {
        success: false,
        error: eventHintResolution.fatalError.message,
        details: {
          ...(eventHintResolution.fatalError.details && typeof eventHintResolution.fatalError.details === 'object'
            ? eventHintResolution.fatalError.details
            : {}),
          optionWarnings: [...new Set(eventHintWarnings)]
        }
      };
    }
    if (eventHintResolution.debug.isApplied) {
      currentStage = 'resolve-event-hints';
      await reportProgress({
        stage: currentStage,
        message: 'Resolved event-based AI key hint extraction',
        transcriptID,
        eventWarnings: eventHintWarnings,
        keyTermCount: eventHintResolution.debug.finalKeyTermCount
      });
    }

    if (!requestedTranscriptID && cdsV1MediaID && !mediaID) {
      currentStage = 'resolve-legacy-media-context';
      const legacyContext = await resolveLegacyMediaContext({
        v1CustomerID: customerID,
        cdsV1MediaID
      });
      legacyLookupContext = {
        v1CustomerID: legacyContext.v1CustomerID,
        v2CustomerID: legacyContext.v2CustomerID,
        customerAccessID: legacyContext.customerAccessID,
        customerNameInternal: legacyContext.customerNameInternal,
        cdsV1MediaID: legacyContext.cdsV1MediaID
      };
      customerID = legacyContext.v2CustomerID;
      mediaPathCustomerID = legacyContext.customerNameInternal || customerID;
      resolvedMediaPath = resolvedMediaPath || legacyContext.mediaPath;
      debugContext.customerID = customerID;
      debugContext.mediaPathCustomerID = mediaPathCustomerID;
      debugContext.legacyLookupContext = legacyLookupContext;
      await reportProgress({
        stage: currentStage,
        message: 'Resolved v1 media/customer context through CustomerAPI',
        customerID
      });
    }
    if (!requestedTranscriptID && cdsV1MediaID && mediaID) {
      debugContext.legacyLookupContext = {
        skipped: true,
        reason: 'cdsMediaID-or-mediaID-present'
      };
    }
    if (!requestedTranscriptID && resolvedMediaPath && !cdsV1MediaID && !mediaID && !externalMediaID) {
      currentStage = 'resolve-legacy-media-context';
      const mediaLookup = await getMediaByLocationName(customerID, resolvedMediaPath);
      const resolvedCustomerMediaID = Number(mediaLookup?.media?.customerMediaID);
      if (!Number.isInteger(resolvedCustomerMediaID) || resolvedCustomerMediaID <= 0) {
        throw new Error(`CustomerAPI /media/byLocationName lookup did not return valid customerMediaID for path ${resolvedMediaPath} and customerID ${customerID}`);
      }

      legacyLookupContext = {
        source: 'media-by-location-name',
        v2CustomerID: mediaLookup.v2CustomerID,
        legacyCustomerID: mediaLookup.legacyCustomerID,
        customerMediaID: resolvedCustomerMediaID
      };
      debugContext.legacyLookupContext = legacyLookupContext;
      await reportProgress({
        stage: currentStage,
        message: 'Resolved media through CustomerAPI by location/name',
        customerID
      });
    }
    if (!requestedTranscriptID && cdsV1EventID && !mediaID && !externalMediaID && !resolvedMediaPath && !cdsV1MediaID) {
      return {
        success: false,
        error: 'Unable to resolve mediaPath from cdsV1EventID; no primary media found',
        details: {
          optionWarnings: [...new Set(eventHintWarnings)]
        }
      };
    }

    if (requestedTranscriptID) {
      const client = getCoreApiClient();
      const transcript = await client.getTranscript(customerID, requestedTranscriptID).catch(() => null);
      if (!transcript) {
        return {
          success: false,
          error: `Transcript not found for transcriptID ${requestedTranscriptID}`
        };
      }
      const existingCdsJobID = transcript?.providerMeta?.cdsJobID;
      const existingCdsWorkerID = transcript?.providerMeta?.cdsWorkerID;
      if ((cdsJobID && existingCdsJobID !== cdsJobID) || (cdsWorkerID && existingCdsWorkerID !== cdsWorkerID)) {
        await client.updateTranscript(customerID, requestedTranscriptID, {
          providerMeta: buildProviderMetaWithExecutionContext(transcript?.providerMeta, { cdsJobID, cdsWorkerID })
        }).catch(() => {});
      }
      const resumeProviderJobIDs = (Array.isArray(requestedProviderJobIDs) && requestedProviderJobIDs.length > 0)
        ? requestedProviderJobIDs
        : (Array.isArray(transcript?.providerMeta?.chunking?.providerJobIDs) ? transcript.providerMeta.chunking.providerJobIDs : []);
      const resumeProviderJobID = requestedProviderJobID || transcript?.providerJobID;
      let resumeChunkMap = Array.isArray(requestedChunkMap) ? requestedChunkMap : undefined;
      if (!resumeChunkMap || resumeChunkMap.length === 0) {
        const transcriptChunkMap = transcript?.providerMeta?.chunking?.chunkMap;
        if (Array.isArray(transcriptChunkMap) && transcriptChunkMap.length > 0) {
          resumeChunkMap = transcriptChunkMap;
        }
      }
      const pollPayload = {
        transcriptID: requestedTranscriptID,
        providerJobID: resumeProviderJobID,
        providerJobIDs: resumeProviderJobIDs,
        provider: String(provider).toUpperCase(),
        chunkMap: resumeChunkMap,
        customerID,
        cdsJobID,
        cdsWorkerID
      };
      if (!resumeProviderJobID && resumeProviderJobIDs.length === 0) {
        return {
          success: false,
          error: `No provider job IDs found for transcriptID ${requestedTranscriptID}; cannot resume polling`
        };
      }
      const resumedResult = await runPollingUntilFinal({
        pollPayload,
        pollIntervalSecs,
        pollTimeoutSecs,
        reportProgress,
        segmentSubmittedAtMSByProviderJobID,
        segmentDurationCapturedByProviderJobID,
        statsTracker
      });
      if (!resumedResult.success) {
        return resumedResult;
      }
      return {
        success: true,
        transcriptID: requestedTranscriptID,
        providerJobID: requestedProviderJobID,
        details: {
          provider: String(provider).toUpperCase(),
          polling: resumedResult.polling
        }
      };
    }

    currentStage = 'resolve-media-path';
    await reportProgress({
      stage: currentStage,
      message: 'Resolving media path'
    });
    // Resolve mediaPath from CoreAPI if not explicitly provided.
    if (!resolvedMediaPath) {
      const media = await resolveMedia(customerID, mediaID, externalMediaID);
      resolvedMediaPath = extractMediaPath(media);
      if (!resolvedMediaPath) {
        return {
          success: false,
          error: 'Unable to resolve mediaPath from CoreAPI media record. Provide mediaPath explicitly.'
        };
      }
    }

    const customerScopedMediaPath = scopeMediaPathForCustomer(mediaPathCustomerID, resolvedMediaPath);
    const normalizedMp4Path = normalizeMp4MediaPath(customerScopedMediaPath);
    const localAACPath = buildLocalAACPath(localBasePath, normalizedMp4Path);
    debugContext.resolvedMediaPath = resolvedMediaPath;
    debugContext.customerScopedMediaPath = customerScopedMediaPath;
    debugContext.normalizedMp4Path = normalizedMp4Path;
    debugContext.localAACPath = localAACPath;
    const externalMediaContext = await resolveCanonicalExternalMediaContext({
      customerID,
      externalMediaID,
      cdsV1MediaID,
      resolvedMediaPath,
      normalizedMp4Path
    });
    if (!externalMediaContext?.canonicalExternalMediaID) {
      return {
        success: false,
        error: 'Unable to resolve canonical externalMediaID from media context'
      };
    }
    const effectiveExternalMediaID = externalMediaContext.canonicalExternalMediaID;
    const effectiveExternalMediaPath = externalMediaContext.externalMediaPath || null;
    debugContext.effectiveExternalMediaID = effectiveExternalMediaID;
    debugContext.effectiveExternalMediaPath = effectiveExternalMediaPath;
    debugContext.externalMediaContext = {
      inputKind: externalMediaContext.inputKind,
      customerMediaID: externalMediaContext.customerMediaID,
      compatibilityExternalMediaIDs: externalMediaContext.compatibilityExternalMediaIDs
    };

    const client = getCoreApiClient();
    currentStage = 'create-transcript-initial';
    await reportProgress({
      stage: currentStage,
      message: 'Creating transcript record'
    });
    const createdOrExistingTranscript = await createOrReuseTranscript({
      client,
      customerID,
      mediaID,
      effectiveExternalMediaID,
      compatibilityExternalMediaIDs: externalMediaContext.compatibilityExternalMediaIDs,
      externalMediaPath: effectiveExternalMediaPath,
      provider,
      cdsJobID,
      cdsWorkerID
    });

    transcriptID = createdOrExistingTranscript?._id || createdOrExistingTranscript?.transcriptID;
    if (!transcriptID) {
      throw new Error('CoreAPI createTranscript did not return transcript ID');
    }
    debugContext.transcriptID = transcriptID;
    await reportProgress({
      stage: currentStage,
      message: 'Transcript record is ready',
      transcriptID,
      jobStateTracker: {
        ...statsTracker,
        CDS_EXTRACTION_ID: transcriptID,
        PROVIDER_NAME: String(provider).toUpperCase(),
        EXTERNAL_MEDIA_ID: effectiveExternalMediaID
      }
    });
    const existingCdsJobID = createdOrExistingTranscript?.providerMeta?.cdsJobID;
    const existingCdsWorkerID = createdOrExistingTranscript?.providerMeta?.cdsWorkerID;
    if ((cdsJobID && existingCdsJobID !== cdsJobID) || (cdsWorkerID && existingCdsWorkerID !== cdsWorkerID)) {
      const targetPayload = buildExtractionTargetFieldsForMedia({
        mediaID,
        externalMediaID: effectiveExternalMediaID
      });
      await client.updateTranscript(customerID, transcriptID, {
        providerMeta: buildProviderMetaWithExecutionContext(createdOrExistingTranscript?.providerMeta, {
          cdsJobID,
          cdsWorkerID,
          externalMediaPath: effectiveExternalMediaPath
        }),
        ...targetPayload
      }).catch(() => {});
    }

    const existingStatus = String(createdOrExistingTranscript?.status || '').toUpperCase();
    const existingTextOriginal = String(createdOrExistingTranscript?.textOriginal || createdOrExistingTranscript?.fullText || '').trim();
    if (existingStatus === 'COMPLETE' && existingTextOriginal.length > 0) {
      return {
        success: true,
        transcriptID,
        details: {
          message: 'Transcript already complete for this media',
          isAlreadyComplete: true
        }
      };
    }

    const existingChunkingMeta = createdOrExistingTranscript?.providerMeta?.chunking || {};
    const existingProviderJobIDs = Array.isArray(existingChunkingMeta.providerJobIDs)
      ? existingChunkingMeta.providerJobIDs
      : [];
    const existingChunkMap = Array.isArray(existingChunkingMeta.chunkMap)
      ? existingChunkingMeta.chunkMap
      : undefined;
    const existingProviderJobID = createdOrExistingTranscript?.providerJobID || null;
    const hasExistingProviderJobs = Boolean(existingProviderJobID || existingProviderJobIDs.length > 0);
    if (hasExistingProviderJobs && supportsProviderPolling(provider)) {
      currentStage = 'resume-existing-provider-jobs';
      await reportProgress({
        stage: currentStage,
        message: 'Resuming provider polling from existing transcript state',
        transcriptID,
        providerJobID: existingProviderJobID,
        providerJobIDs: existingProviderJobIDs
      });
      const resumedResult = await runPollingUntilFinal({
        pollPayload: {
          transcriptID,
          providerJobID: existingProviderJobID,
          providerJobIDs: existingProviderJobIDs,
          provider: String(provider).toUpperCase(),
          chunkMap: existingChunkMap,
          customerID,
          cdsJobID,
          cdsWorkerID
        },
        pollIntervalSecs,
        pollTimeoutSecs,
        reportProgress,
        segmentSubmittedAtMSByProviderJobID,
        segmentDurationCapturedByProviderJobID,
        statsTracker
      });
      if (!resumedResult.success) {
        return resumedResult;
      }
      return {
        success: true,
        transcriptID,
        providerJobID: existingProviderJobID,
        details: {
          provider: String(provider).toUpperCase(),
          isResumedExistingTranscript: true,
          polling: resumedResult.polling
        }
      };
    }
    if (hasExistingProviderJobs && !supportsProviderPolling(provider)) {
      await reportProgress({
        stage: 'resume-existing-provider-jobs',
        message: 'Skipping existing provider job polling for provider without polling support',
        transcriptID,
        provider: String(provider).toUpperCase(),
        providerJobID: existingProviderJobID,
        providerJobIDs: existingProviderJobIDs
      });
    }

    const eventAndItemsRows = Array.isArray(eventHintResolution?.debug?.eventAndItemsRows)
      ? eventHintResolution.debug.eventAndItemsRows
      : [];
    const keywordListJSON = Array.isArray(eventHintResolution?.debug?.keywordListJSON)
      ? eventHintResolution.debug.keywordListJSON
      : [];
    const shouldPersistEventAndItems = Boolean(cdsV1EventID)
      && (eventAndItemsRows.length > 0 || keywordListJSON.length > 0 || eventHintWarnings.length > 0);
    if (shouldPersistEventAndItems) {
      currentStage = 'persist-event-and-items-extraction';
      await reportProgress({
        stage: currentStage,
        message: 'Persisting EVENT_AND_ITEMS extraction',
        transcriptID
      });
      eventAndItemsExtractionResult = await createOrReplaceEventAndItemsExtraction({
        client,
        customerID,
        mediaID,
        externalMediaID: effectiveExternalMediaID,
        compatibilityExternalMediaIDs: externalMediaContext.compatibilityExternalMediaIDs,
        cdsV1EventID,
        eventAndItemsRows,
        keywordListJSON,
        eventWarnings: eventHintWarnings,
        aiHintDebug: eventHintResolution.debug
      });
      debugContext.eventAndItemsExtraction = {
        extractionID: eventAndItemsExtractionResult?.extractionID || null,
        itemCount: Number(eventAndItemsExtractionResult?.itemCount || 0),
        replacedExtractionCount: Number(eventAndItemsExtractionResult?.replacedExtractionCount || 0)
      };
    }

    let audioPath = null;
    let mediaSource = 'local';
    let audioExtracted = false;

    currentStage = 'locate-or-download-aac';
    await reportProgress({
      stage: currentStage,
      message: 'Locating or downloading audio'
    });
    if (await fileExists(localAACPath)) {
      audioPath = localAACPath;
      mediaSource = 'local';
    } else {
      if (!dfwBaseUrl) {
        return { success: false, error: 'DFW_MEDIA_BASE_URL must be configured to fetch missing media from DFW' };
      }

      debugContext.dfwFetchRelativePath = normalizedMp4Path;
      debugContext.dfwFetchUrl = `${String(dfwBaseUrl || '').replace(/\/+$/, '')}/${String(normalizedMp4Path || '').replace(/^\/+/, '')}`;
      const downloadStartedAtMS = Date.now();
      downloadedMp4Path = await downloadDFWMP4(dfwBaseUrl, mediaPathCustomerID, normalizedMp4Path, tempBasePath);
      const mediaDownloadTimeMS = Date.now() - downloadStartedAtMS;
      await upsertStats({
        MEDIA_DOWNLOAD_TIME_MS: mediaDownloadTimeMS
      }, 'Downloaded media from DFW');
      mediaSource = 'dfw';
      await reportProgress({
        stage: currentStage,
        message: 'Preparing AAC output path'
      });
      await ensureParentDir(localAACPath);
      currentStage = 'extract-aac';
      await reportProgress({
        stage: currentStage,
        message: 'Extracting AAC audio'
      });
      const audioSpoolOffStartedAtMS = Date.now();
      await extractAAC(downloadedMp4Path, localAACPath, ffmpegTimeoutMS);
      const audioSpoolOffTimeMS = Date.now() - audioSpoolOffStartedAtMS;
      await upsertStats({
        AUDIO_SPOOL_OFF_TIME_MS: audioSpoolOffTimeMS
      }, 'Extracted AAC audio');
      audioPath = localAACPath;
      audioExtracted = true;
    }
    debugContext.mediaSource = mediaSource;
    debugContext.audioExtracted = audioExtracted;
    debugContext.audioPath = audioPath;
    try {
      const audioStats = await fsp.stat(audioPath);
      const audioSizeMB = Number((audioStats.size / (1024 * 1024)).toFixed(3));
      await upsertStats({
        AUDIO_ONLY_FILE_SIZE_MB: audioSizeMB
      }, 'Computed audio file size');
    } catch {
      // Best effort metric only.
    }

    const silenceNoiseDB = Number(providerOptions.silenceNoiseDB ?? defaultSilenceNoiseDB);
    const silenceMinSecs = Number(providerOptions.silenceMinSecs ?? defaultSilenceMinSecs);
    const silenceMinSecsToSave = Number(defaultSilenceMinSecsToSave);
    const isSilenceForceRecreate = providerOptions.silenceForceRecreate === true;
    const silenceDetectMinSecs = Math.min(silenceMinSecs, silenceMinSecsToSave);
    const isChunkingEnabled = providerOptions.isChunkingEnabled ?? defaultIsChunkingEnabled;
    const maxSegmentCount = Number(providerOptions.maxSegmentCount ?? defaultMaxSegmentCount);
    const maxSegmentDurationSecs = Number(providerOptions.maxSegmentDurationSecs ?? defaultMaxSegmentDurationSecs);
    const segmentOverlapSecs = Number(providerOptions.segmentOverlapSecs ?? defaultSegmentOverlapSecs);
    debugContext.transcriptionOptions = {
      silenceNoiseDB,
      silenceMinSecs,
      silenceMinSecsToSave,
      isSilenceForceRecreate,
      silenceDetectMinSecs,
      isChunkingEnabled,
      maxSegmentCount,
      maxSegmentDurationSecs,
      segmentOverlapSecs
    };

    currentStage = 'analyze-silence';
    await reportProgress({
      stage: currentStage,
      message: 'Analyzing silence and planning chunks'
    });
    const silenceResolution = await resolveSilenceForTranscription({
      client,
      customerID,
      mediaID,
      externalMediaID: effectiveExternalMediaID,
      compatibilityExternalMediaIDs: externalMediaContext.compatibilityExternalMediaIDs,
      externalMediaPath: effectiveExternalMediaPath,
      audioPath,
      silenceNoiseDB,
      silenceDetectMinSecs,
      silenceMinSecs,
      silenceMinSecsToSave,
      isSilenceForceRecreate,
      reportProgress
    });
    const { silenceAnalysis } = silenceResolution;
    const chunkingSilenceIntervals = silenceResolution.chunkingSilenceIntervals;
    const savedSilenceIntervals = silenceResolution.savedSilenceIntervals;
    const totalSavedSilenceMS = silenceResolution.totalSavedSilenceMS;
    await reportProgress({
      stage: currentStage,
      message: 'Silence detection resolved',
      transcriptID
    });
    const chunkMap = buildChunkMapFromSilence({
      silenceIntervals: chunkingSilenceIntervals,
      analyzedDurationMS: silenceAnalysis.analyzedDurationMS
    });
    const segmentPlan = planSegmentSubmission({
      chunkMap,
      isChunkingEnabled,
      maxSegmentCount,
      maxSegmentDurationSecs,
      segmentOverlapSecs
    });
    const submissionChunkMap = segmentPlan.isChunkingEnabled ? segmentPlan.submissionChunks : [];
    debugContext.segmentPlan = {
      isChunkingEnabled: segmentPlan.isChunkingEnabled,
      segmentCount: segmentPlan.segmentCount,
      maxSegmentCount,
      maxSegmentDurationSecs,
      segmentOverlapSecs
    };

    const providerBaseOptions = {
      ...providerOptions
    };
    delete providerBaseOptions.silenceNoiseDB;
    delete providerBaseOptions.silenceMinSecs;
    delete providerBaseOptions.silenceForceRecreate;
    delete providerBaseOptions.isChunkingEnabled;
    delete providerBaseOptions.maxSegmentCount;
    delete providerBaseOptions.maxSegmentDurationSecs;
    delete providerBaseOptions.segmentOverlapSecs;

    const providerSubmissions = [];
    currentStage = 'submit-to-provider';
    await reportProgress({
      stage: currentStage,
      message: 'Submitting to Processor'
    });
    if (!segmentPlan.isChunkingEnabled) {
      await reportProgress({
        stage: currentStage,
        message: 'Submitting to Processor',
        transcriptID
      });
      const providerSubmitStartedAtMS = Date.now();
      const singleSubmission = await submitToProvider(audioPath, provider, providerBaseOptions, config);
      providerSubmissions.push(singleSubmission);
      segmentSubmittedAtMSByProviderJobID[singleSubmission.providerJobID] = providerSubmitStartedAtMS;
      await reportProgress({
        stage: currentStage,
        message: 'Submitted to Processor',
        transcriptID,
        providerJobID: singleSubmission.providerJobID
      });
    } else {
      for (const chunk of segmentPlan.submissionChunks) {
        await reportProgress({
          stage: currentStage,
          message: 'Submitting to Processor',
          transcriptID,
          chunkIndex: chunk.chunkIndex
        });
        const chunkAudioPath = await extractAACChunk(audioPath, tempBasePath, chunk, ffmpegTimeoutMS);
        temporaryChunkPaths.push(chunkAudioPath);
        const providerSubmitStartedAtMS = Date.now();
        const submission = await submitToProvider(chunkAudioPath, provider, providerBaseOptions, config);
        providerSubmissions.push({
          ...submission,
          chunkIndex: chunk.chunkIndex
        });
        segmentSubmittedAtMSByProviderJobID[submission.providerJobID] = providerSubmitStartedAtMS;
        await reportProgress({
          stage: currentStage,
          message: 'Submitted to Processor',
          transcriptID,
          chunkIndex: chunk.chunkIndex,
          providerJobID: submission.providerJobID
        });
      }
    }

    const providerJobID = providerSubmissions.length === 1
      ? providerSubmissions[0].providerJobID
      : `CHUNKED:${String(provider).toUpperCase()}:${providerSubmissions.length}:${providerSubmissions[0].providerJobID}`;
    const providerJobIDs = providerSubmissions.map(s => s.providerJobID);
    const providerOptionWarnings = [
      ...new Set(
        providerSubmissions.flatMap((submission) =>
          Array.isArray(submission?.providerWarnings) ? submission.providerWarnings : []
        )
      )
    ];
    const optionWarnings = [...new Set([...providerOptionWarnings, ...eventHintWarnings])];
    const optionWarningDetails = buildProviderOptionWarningDetails({
      optionWarnings,
      aiHintDebug: debugContext.aiKeyHintExtraction || null
    });
    const hintDebug = buildUnifiedHintDebug({
      aiHintDebug: debugContext.aiKeyHintExtraction || null,
      providerHintDebug: providerSubmissions[0]?.providerMeta?.hintDebug || null,
      optionWarnings
    });
    const providerMetaForTranscript = stripHintDebugFromProviderMeta(providerSubmissions[0]?.providerMeta);
    if (Object.keys(optionWarningDetails).length > 0) {
      await upsertStats({
        PROVIDER_OPTION_WARNING_COUNT: Object.keys(optionWarningDetails).length,
        PROVIDER_OPTION_WARNINGS: optionWarningDetails
      }, 'Provider options partially applied');
    }
    debugContext.providerSubmission = {
      providerJobID,
      providerJobIDs,
      submissionCount: providerSubmissions.length,
      providerOptionWarnings: optionWarnings,
      providerOptionWarningDetails: optionWarningDetails
    };
    await reportProgress({
      stage: currentStage,
      message: 'Provider accepted transcription job(s)',
      transcriptID,
      providerJobID,
      providerJobIDs,
      jobStateTracker: {
        ...statsTracker,
        CDS_EXTRACTION_ID: transcriptID,
        PROVIDER_JOB_ID: providerJobID,
        PROVIDER_JOB_IDS: providerJobIDs
      }
    });

    currentStage = 'update-transcript-provider-state';
    const silenceExtractionID = silenceResolution.debug.extractionID || silenceResolution.debug.reusedExtractionID || null;
    await client.updateTranscript(customerID, transcriptID, {
      providerName: normalizeProviderName(provider),
      providerJobID,
      providerMeta: {
        ...providerMetaForTranscript,
        ...buildProviderMetaWithExecutionContext({}, { cdsJobID, cdsWorkerID }),
        ...(effectiveExternalMediaPath ? { externalMediaPath: effectiveExternalMediaPath } : {}),
        optionWarnings,
        optionWarningDetails,
        ...(eventAndItemsExtractionResult?.extractionID ? { eventAndItemsExtractionID: eventAndItemsExtractionResult.extractionID } : {}),
        chunking: {
          isChunkingEnabled: segmentPlan.isChunkingEnabled,
          segmentCount: segmentPlan.segmentCount,
          maxSegmentCount,
          maxSegmentDurationSecs,
          segmentOverlapSecs,
          providerJobIDs,
          chunkMap: submissionChunkMap
        },
        silenceDetection: {
          extractionID: silenceExtractionID,
          source: silenceResolution.debug.source,
          isReusedExisting: silenceResolution.debug.isReusedExisting,
          isForceRecreate: silenceResolution.debug.isForceRecreate
        }
      },
      status: 'RUNNING'
    });

    const inlineProviderResponses = providerSubmissions
      .filter(s => s.providerResponse)
      .map((submission, index) => ({
        chunkIndex: submission.chunkIndex ?? index,
        response: submission.providerResponse
      }));

    const pollPayload = {
      transcriptID,
      providerJobID,
      providerJobIDs,
      provider: String(provider).toUpperCase(),
      chunkMap: segmentPlan.isChunkingEnabled ? submissionChunkMap : undefined,
      customerID,
      cdsJobID,
      cdsWorkerID
    };

    let pollingResult;
    if (inlineProviderResponses.length === providerSubmissions.length && inlineProviderResponses.length > 0) {
      currentStage = 'finalize-inline-provider-responses';
      await reportProgress({
        stage: currentStage,
        message: 'Finalizing inline provider response'
      });
      pollingResult = await processTranscriptionPollJob({
        scope: JobScopes.TRANSCRIPTION_POLL,
        payload: {
          ...pollPayload,
          providerResponse: inlineProviderResponses.length === 1 ? inlineProviderResponses[0].response : undefined,
          chunkResponses: inlineProviderResponses.length > 1 ? inlineProviderResponses : undefined
        }
      });
    } else {
      currentStage = 'poll-provider-until-final';
      pollingResult = await runPollingUntilFinal({
        pollPayload,
        pollIntervalSecs,
        pollTimeoutSecs,
        reportProgress,
        segmentSubmittedAtMSByProviderJobID,
        segmentDurationCapturedByProviderJobID,
        statsTracker
      });
    }
    if (!pollingResult?.success) {
      statsTracker.TOTAL_TASK_TIME_MS = Date.now() - taskStartedAtMS;
      await client.updateTranscript(customerID, transcriptID, {
        status: 'FAILED',
        providerMeta: {
          ...providerMetaForTranscript,
          ...buildProviderMetaWithExecutionContext({}, { cdsJobID, cdsWorkerID }),
          ...(eventAndItemsExtractionResult?.extractionID ? { eventAndItemsExtractionID: eventAndItemsExtractionResult.extractionID } : {}),
          poll: {
            status: 'failed',
            reason: pollingResult.error || 'Polling did not complete successfully'
          }
        }
      });
      return {
        ...pollingResult,
        jobStateTracker: {
          ...statsTracker,
          CDS_EXTRACTION_ID: transcriptID,
          PROVIDER_JOB_ID: providerJobID,
          PROVIDER_JOB_IDS: providerJobIDs
        }
      };
    }

    if (downloadedMp4Path) {
      currentStage = 'cleanup-downloaded-mp4';
      await safeDelete(downloadedMp4Path);
    }
    if (temporaryChunkPaths.length > 0) {
      currentStage = 'cleanup-temporary-chunks';
      await Promise.all(temporaryChunkPaths.map(p => safeDelete(p)));
    }
    if (audioExtracted && localAACCacheTTLMS > 0) {
      currentStage = 'schedule-aac-cleanup';
      scheduleFileCleanup(localAACPath, localAACCacheTTLMS);
    }

    currentStage = 'completed';
    const totalTaskTimeMS = Date.now() - taskStartedAtMS;
    statsTracker.TOTAL_TASK_TIME_MS = totalTaskTimeMS;
    return {
      success: true,
      transcriptID,
      providerJobID,
      jobStateTracker: {
        ...statsTracker,
        CDS_EXTRACTION_ID: transcriptID,
        PROVIDER_JOB_ID: providerJobID,
        PROVIDER_JOB_IDS: providerJobIDs
      },
      mediaSource,
      audioExtracted,
      details: {
        mediaPath: normalizedMp4Path,
        localAACPath,
        provider: String(provider).toUpperCase(),
        legacyLookupContext,
        hintDebug,
        optionWarnings: [
          ...new Set(
            [...providerSubmissions.flatMap((submission) =>
              Array.isArray(submission?.providerWarnings) ? submission.providerWarnings : []
            ), ...eventHintWarnings]
          )
        ],
        optionWarningDetails,
        chunking: {
          isChunkingEnabled: segmentPlan.isChunkingEnabled,
          segmentCount: segmentPlan.segmentCount,
          maxSegmentCount,
          maxSegmentDurationSecs,
          segmentOverlapSecs,
          providerJobIDs
        },
        polling: pollingResult?.polling || null,
        stats: {
          ...statsTracker
        },
        eventAndItemsExtraction: {
          extractionID: eventAndItemsExtractionResult?.extractionID || null,
          itemCount: Number(eventAndItemsExtractionResult?.itemCount || 0),
          replacedExtractionCount: Number(eventAndItemsExtractionResult?.replacedExtractionCount || 0)
        },
        silenceAnalysis: {
          source: silenceResolution.debug.source,
          extractionID: silenceResolution.debug.extractionID || silenceResolution.debug.reusedExtractionID || null,
          isReusedExisting: silenceResolution.debug.isReusedExisting,
          isForceRecreate: silenceResolution.debug.isForceRecreate,
          totalSilenceMS: totalSavedSilenceMS,
          analyzedDurationMS: silenceAnalysis.analyzedDurationMS,
          silenceIntervalCount: savedSilenceIntervals.length,
          chunkingSilenceIntervalCount: chunkingSilenceIntervals.length,
          nonSilentChunkCount: chunkMap.length
        },
        chunkMap: submissionChunkMap
      }
    };
  } catch (err) {
    if (transcriptID) {
      try {
        const client = getCoreApiClient();
        const existingTranscript = await client.getTranscript(customerID, transcriptID).catch(() => null);
        const existingProviderMeta = (existingTranscript?.providerMeta && typeof existingTranscript.providerMeta === 'object')
          ? existingTranscript.providerMeta
          : {};
        await client.updateTranscript(customerID, transcriptID, {
          status: 'FAILED',
          providerMeta: {
            ...existingProviderMeta,
            ...buildProviderMetaWithExecutionContext(existingProviderMeta, { cdsJobID, cdsWorkerID }),
            processingError: {
              stage: currentStage,
              message: err?.message || 'Unknown error during transcription submission',
              updatedAt: new Date().toISOString()
            }
          }
        });
      } catch {
        // Ignore secondary failure while handling the primary error.
      }
    }
    if (downloadedMp4Path) {
      await safeDelete(downloadedMp4Path);
    }
    if (temporaryChunkPaths.length > 0) {
      await Promise.all(temporaryChunkPaths.map(p => safeDelete(p)));
    }
    return {
      success: false,
      error: err.message,
      jobStateTracker: {
        ...statsTracker,
        TOTAL_TASK_TIME_MS: Date.now() - taskStartedAtMS,
        ...(transcriptID ? { CDS_EXTRACTION_ID: transcriptID } : {})
      },
      details: {
        stage: currentStage,
        debug: debugContext,
        coreAPIError: err?.statusCode ? {
          statusCode: err.statusCode,
          path: err.path,
          method: err.method,
          url: err.url,
          body: err.body,
          operation: err?.details?.operation
        } : undefined,
        errorCode: err?.code,
        errorName: err?.name,
        stack: err.stack
      }
    };
  }
}

/**
 * Submit media for silence extraction only (no STT submission).
 *
 * @param {IngestionOptions & { cdsMediaID?: string, cdsV1MediaID?: number|string, options?: object, mediaPath?: string, cdsJobID?: string, cdsWorkerID?: string, onProgress?:(data:object)=>Promise<void> }} options
 * @returns {Promise<IngestionResult & { extractionID?: string, mediaSource?: string, audioExtracted?: boolean }>}
 */
export async function submitMediaForSilenceExtraction(options) {
  const {
    customerID: requestedCustomerID,
    mediaID: requestedMediaID,
    externalMediaID: requestedExternalMediaID,
    cdsMediaID,
    cdsV1MediaID,
    cdsV1EventID,
    options: requestedExtractionOptions = {},
    mediaPath,
    cdsJobID,
    cdsWorkerID,
    onProgress
  } = options;

  const customerID = requestedCustomerID;
  const mediaPathCustomerID = requestedCustomerID;
  const mediaID = requestedMediaID || cdsMediaID;
  const externalMediaID = requestedExternalMediaID;
  const extractionOptions = (requestedExtractionOptions && typeof requestedExtractionOptions === 'object')
    ? { ...requestedExtractionOptions }
    : {};
  const isEventHintResolver = Boolean(cdsV1EventID);

  if (!customerID) {
    return { success: false, error: 'customerID is required' };
  }
  if (!mediaID && !externalMediaID && !mediaPath && !cdsV1MediaID && !isEventHintResolver) {
    return {
      success: false,
      error: 'One of mediaID, externalMediaID, cdsMediaID, cdsV1MediaID, mediaPath, or cdsV1EventID is required'
    };
  }

  const config = getConfig();
  const mediaConfig = config.media || {};
  const localBasePath = mediaConfig.localBasePath || '/mnt/media';
  const tempBasePath = mediaConfig.tempBasePath || '/tmp/media-processing';
  const dfwBaseUrl = mediaConfig.dfw?.baseUrl || '';
  const localAACCacheSecs = Number(mediaConfig.localAACCacheSecs || process.env.LOCAL_AAC_CACHE_SECS || 86400);
  const localAACCacheTTLMS = localAACCacheSecs * 1000;
  const defaultSilenceNoiseDB = Number(mediaConfig.silenceDetection?.noiseDB ?? -35);
  const defaultSilenceMinSecs = Number(mediaConfig.silenceDetection?.minSilenceSecs ?? 2);
  const defaultSilenceMinSecsToSave = Number(mediaConfig.silenceDetection?.minSilenceSecsToSave ?? defaultSilenceMinSecs);
  const ffmpegTimeoutSecs = Number(mediaConfig.ffmpegTimeoutSecs ?? process.env.FFMPEG_TIMEOUT_SECS ?? 1800);
  const ffmpegTimeoutMS = Math.max(0, ffmpegTimeoutSecs * 1000);

  if (!dfwBaseUrl && !mediaPath && !cdsV1MediaID && !isEventHintResolver) {
    return { success: false, error: 'DFW_MEDIA_BASE_URL is required when mediaPath is not locally resolvable' };
  }

  let downloadedMp4Path = null;
  let resolvedMediaPath = mediaPath || null;
  let currentStage = 'initialize';
  const debugContext = {
    requestedCustomerID,
    customerID,
    mediaPathCustomerID,
    mediaID,
    externalMediaID,
    cdsMediaID,
    cdsV1MediaID,
    cdsV1EventID,
    requestedMediaPath: mediaPath || null,
    cdsJobID: cdsJobID || null,
    cdsWorkerID: cdsWorkerID || null
  };
  const reportProgress = async (data = {}) => {
    if (typeof onProgress !== 'function') {
      return;
    }
    try {
      await onProgress(data);
    } catch {
      // Best effort only.
    }
  };
  const taskStartedAtMS = Date.now();
  const statsTracker = {};
  if (cdsJobID) {
    statsTracker.CDS_JOB_ID = cdsJobID;
  }
  if (cdsWorkerID) {
    statsTracker.CDS_WORKER_ID = cdsWorkerID;
  }

  try {
    await reportProgress({
      stage: currentStage,
      message: 'Initializing silence extraction workflow',
      jobStateTracker: {
        ...statsTracker
      }
    });

    const eventHintResolution = await resolveEventKeyHintAugmentation({
      requestedTranscriptID: undefined,
      cdsV1EventID,
      isAIKeyHintExtractionEnabled: false,
      isAIKeyHintExtractionFailureFatal: false,
      customerID,
      provider: ProviderType.ASSEMBLYAI,
      mediaID,
      externalMediaID,
      resolvedMediaPath,
      cdsV1MediaID,
      providerOptions: extractionOptions,
      lookupLegacyCustomerIDByV2CustomerIDHandler: lookupLegacyCustomerIDByV2CustomerID,
      buildEventMediaContextHandler: buildEventMediaContext,
      buildEventKeyTermsHandler: buildEventKeyTerms
    });
    resolvedMediaPath = eventHintResolution.resolvedMediaPath;
    if (cdsV1EventID && !mediaID && !externalMediaID && !resolvedMediaPath && !cdsV1MediaID) {
      return {
        success: false,
        error: 'Unable to resolve mediaPath from cdsV1EventID; no primary media found'
      };
    }

    currentStage = 'resolve-media-path';
    await reportProgress({
      stage: currentStage,
      message: 'Resolving media path'
    });
    if (!resolvedMediaPath) {
      const media = await resolveMedia(customerID, mediaID, externalMediaID);
      resolvedMediaPath = extractMediaPath(media);
      if (!resolvedMediaPath) {
        return {
          success: false,
          error: 'Unable to resolve mediaPath from CoreAPI media record. Provide mediaPath explicitly.'
        };
      }
    }

    const customerScopedMediaPath = scopeMediaPathForCustomer(mediaPathCustomerID, resolvedMediaPath);
    const normalizedMp4Path = normalizeMp4MediaPath(customerScopedMediaPath);
    const localAACPath = buildLocalAACPath(localBasePath, normalizedMp4Path);
    debugContext.resolvedMediaPath = resolvedMediaPath;
    debugContext.customerScopedMediaPath = customerScopedMediaPath;
    debugContext.normalizedMp4Path = normalizedMp4Path;
    debugContext.localAACPath = localAACPath;
    const externalMediaContext = await resolveCanonicalExternalMediaContext({
      customerID,
      externalMediaID,
      cdsV1MediaID,
      resolvedMediaPath,
      normalizedMp4Path
    });
    if (!externalMediaContext?.canonicalExternalMediaID) {
      return {
        success: false,
        error: 'Unable to resolve canonical externalMediaID from media context'
      };
    }
    const effectiveExternalMediaID = externalMediaContext.canonicalExternalMediaID;
    const effectiveExternalMediaPath = externalMediaContext.externalMediaPath || null;
    debugContext.effectiveExternalMediaID = effectiveExternalMediaID;
    debugContext.effectiveExternalMediaPath = effectiveExternalMediaPath;
    debugContext.externalMediaContext = {
      inputKind: externalMediaContext.inputKind,
      customerMediaID: externalMediaContext.customerMediaID,
      compatibilityExternalMediaIDs: externalMediaContext.compatibilityExternalMediaIDs
    };

    let audioPath = null;
    let mediaSource = 'local';
    let audioExtracted = false;

    currentStage = 'locate-or-download-aac';
    await reportProgress({
      stage: currentStage,
      message: 'Locating or downloading audio'
    });
    if (await fileExists(localAACPath)) {
      audioPath = localAACPath;
      mediaSource = 'local';
    } else {
      if (!dfwBaseUrl) {
        return { success: false, error: 'DFW_MEDIA_BASE_URL must be configured to fetch missing media from DFW' };
      }

      debugContext.dfwFetchRelativePath = normalizedMp4Path;
      debugContext.dfwFetchUrl = `${String(dfwBaseUrl || '').replace(/\/+$/, '')}/${String(normalizedMp4Path || '').replace(/^\/+/, '')}`;
      downloadedMp4Path = await downloadDFWMP4(dfwBaseUrl, mediaPathCustomerID, normalizedMp4Path, tempBasePath);
      mediaSource = 'dfw';
      await ensureParentDir(localAACPath);
      currentStage = 'extract-aac';
      await reportProgress({
        stage: currentStage,
        message: 'Extracting AAC audio'
      });
      await extractAAC(downloadedMp4Path, localAACPath, ffmpegTimeoutMS);
      audioPath = localAACPath;
      audioExtracted = true;
    }
    debugContext.mediaSource = mediaSource;
    debugContext.audioExtracted = audioExtracted;
    debugContext.audioPath = audioPath;

    const client = getCoreApiClient();
    const silenceNoiseDB = Number(extractionOptions.silenceNoiseDB ?? defaultSilenceNoiseDB);
    const silenceMinSecs = Number(extractionOptions.silenceMinSecs ?? defaultSilenceMinSecs);
    const silenceMinSecsToSave = Number(defaultSilenceMinSecsToSave);
    const isSilenceForceRecreate = extractionOptions.silenceForceRecreate === true;
    const silenceDetectMinSecs = Math.min(silenceMinSecs, silenceMinSecsToSave);

    currentStage = 'analyze-silence';
    await reportProgress({
      stage: currentStage,
      message: 'Analyzing silence'
    });
    const silenceResolution = await resolveSilenceForTranscription({
      client,
      customerID,
      mediaID,
      externalMediaID: effectiveExternalMediaID,
      compatibilityExternalMediaIDs: externalMediaContext.compatibilityExternalMediaIDs,
      externalMediaPath: effectiveExternalMediaPath,
      audioPath,
      silenceNoiseDB,
      silenceDetectMinSecs,
      silenceMinSecs,
      silenceMinSecsToSave,
      isSilenceForceRecreate,
      reportProgress
    });

    if (downloadedMp4Path) {
      currentStage = 'cleanup-downloaded-mp4';
      await safeDelete(downloadedMp4Path);
      downloadedMp4Path = null;
    }
    if (audioExtracted && localAACCacheTTLMS > 0) {
      scheduleFileCleanup(localAACPath, localAACCacheTTLMS);
    }

    return {
      success: true,
      extractionID: silenceResolution?.debug?.extractionID || silenceResolution?.debug?.reusedExtractionID || null,
      mediaSource,
      audioExtracted,
      details: {
        silenceDetection: {
          source: silenceResolution.debug.source,
          isReusedExisting: silenceResolution.debug.isReusedExisting,
          isForceRecreate: silenceResolution.debug.isForceRecreate,
          extractionID: silenceResolution.debug.extractionID || silenceResolution.debug.reusedExtractionID || null,
          matchedExtractionCount: silenceResolution.debug.matchedExtractionCount
        },
        silenceAnalysis: {
          totalSilenceMS: silenceResolution.totalSavedSilenceMS,
          analyzedDurationMS: silenceResolution.silenceAnalysis?.analyzedDurationMS,
          silenceIntervalCount: silenceResolution.savedSilenceIntervals?.length || 0,
          chunkingSilenceIntervalCount: silenceResolution.chunkingSilenceIntervals?.length || 0,
          silenceDetectMinSecs,
          chunkingMinSilenceSecs: silenceMinSecs,
          saveMinSilenceSecs: silenceMinSecsToSave
        },
        stats: {
          ...statsTracker,
          TOTAL_TASK_TIME_MS: Date.now() - taskStartedAtMS
        }
      }
    };
  } catch (err) {
    if (downloadedMp4Path) {
      await safeDelete(downloadedMp4Path);
    }
    return {
      success: false,
      error: err.message,
      jobStateTracker: {
        ...statsTracker,
        TOTAL_TASK_TIME_MS: Date.now() - taskStartedAtMS
      },
      details: {
        stage: currentStage,
        debug: debugContext,
        coreAPIError: err?.statusCode ? {
          statusCode: err.statusCode,
          path: err.path,
          method: err.method,
          url: err.url,
          body: err.body,
          operation: err?.details?.operation
        } : undefined,
        errorCode: err?.code,
        errorName: err?.name,
        stack: err.stack
      }
    };
  }
}

/**
 * Process a transcript ingestion job (for job queue worker)
 * @param {object} job - Job data from queue
 * @returns {Promise<IngestionResult>} Job result
 */
export async function processIngestionJob(job, deps = {}) {
  const { scope, payload } = job;

  switch (scope) {
    case JobScopes.INGEST_PROVIDER_JSON:
      return ingestProviderJSON(payload.content, payload.options);

    case JobScopes.INGEST_CAPTION_FILE:
      return ingestCaptionFile(payload.content, payload.options);

    case JobScopes.TRANSCRIBE_MEDIA:
      return submitMediaForTranscription({
        ...payload,
        cdsJobID: job?.jobID,
        cdsWorkerID: deps.workerID,
        onProgress: deps.reportProgress
      });

    case JobScopes.EXTRACT_SILENCE_MEDIA:
      return submitMediaForSilenceExtraction({
        ...payload,
        cdsJobID: job?.jobID,
        cdsWorkerID: deps.workerID,
        onProgress: deps.reportProgress
      });

    case JobScopes.TRANSCRIPTION_POLL:
      return processTranscriptionPollJob({
        ...job,
        payload: {
          ...(job?.payload || {}),
          cdsJobID: job?.jobID,
          cdsWorkerID: deps.workerID
        }
      });

    case JobScopes.ENHANCE_CAPTIONS:
      // Send caption text to provider for speaker diarization
      return {
        success: false,
        error: 'Caption enhancement not yet implemented'
      };

    default:
      return {
        success: false,
        error: `Unknown job scope: ${scope}`
      };
  }
}

export default {
  ingestProviderJSON,
  ingestCaptionFile,
  submitMediaForTranscription,
  submitMediaForSilenceExtraction,
  createTranscriptWithUtterances,
  processIngestionJob,
  JobScopes
};

async function runPollingUntilFinal(params) {
  const {
    pollPayload,
    pollIntervalSecs,
    pollTimeoutSecs,
    reportProgress,
    segmentSubmittedAtMSByProviderJobID = {},
    segmentDurationCapturedByProviderJobID = {},
    statsTracker = {}
  } = params;

  const startedAtMS = Date.now();
  let attempts = 0;
  const providerJobIDsInOrder = Array.isArray(pollPayload.providerJobIDs) && pollPayload.providerJobIDs.length > 0
    ? pollPayload.providerJobIDs
    : [pollPayload.providerJobID].filter(Boolean);

  while ((Date.now() - startedAtMS) < (pollTimeoutSecs * 1000)) {
    attempts += 1;
    const result = await processTranscriptionPollJob({
      scope: JobScopes.TRANSCRIPTION_POLL,
      payload: pollPayload
    });

    const completedProviderJobIDs = Array.isArray(result?.completedProviderJobIDs) ? result.completedProviderJobIDs : [];
    const nowMS = Date.now();
    const newStats = {};
    for (const completedProviderJobID of completedProviderJobIDs) {
      if (segmentDurationCapturedByProviderJobID[completedProviderJobID]) {
        continue;
      }
      const submittedAtMS = Number(segmentSubmittedAtMSByProviderJobID[completedProviderJobID]);
      if (!Number.isFinite(submittedAtMS)) {
        continue;
      }
      const segmentDurationMS = Math.max(0, nowMS - submittedAtMS);
      segmentDurationCapturedByProviderJobID[completedProviderJobID] = true;
      const segmentIndex = providerJobIDsInOrder.indexOf(completedProviderJobID);
      if (segmentIndex >= 0) {
        newStats[`SEGMENT_PROCESS_TIME_${segmentIndex}_MS`] = segmentDurationMS;
      }
    }
    if (Object.keys(newStats).length > 0) {
      Object.assign(statsTracker, newStats);
    }

    if (result?.isFinal) {
      return {
        ...result,
        completedProviderJobIDs,
        segmentProcessTimesMS: { ...newStats },
        polling: {
          attempts,
          pollIntervalSecs,
          pollTimeoutSecs
        }
      };
    }

    if (typeof reportProgress === 'function') {
      await reportProgress({
        stage: 'polling-provider',
        message: `Provider still processing (attempt ${attempts})`,
        transcriptID: pollPayload.transcriptID,
        providerJobID: pollPayload.providerJobID,
        providerJobIDs: pollPayload.providerJobIDs,
        ...(Object.keys(newStats).length > 0 ? { jobStateTracker: { ...statsTracker } } : {})
      });
    }
    await sleepMS(pollIntervalSecs * 1000);
  }

  return {
    success: false,
    error: `Transcription polling timed out after ${pollTimeoutSecs} seconds`,
    details: {
      pollTimeoutSecs,
      pollIntervalSecs,
      transcriptID: pollPayload.transcriptID,
      providerJobID: pollPayload.providerJobID,
      providerJobIDs: pollPayload.providerJobIDs
    }
  };
}

function sleepMS(durationMS) {
  return new Promise(resolve => {
    setTimeout(resolve, durationMS);
  });
}

async function resolveMedia(customerID, mediaID, externalMediaID) {
  const client = getCoreApiClient();
  if (mediaID) {
    return client.getMedia(customerID, mediaID);
  }
  const parsedExternalMediaIdentity = parseExternalMediaIdentity(externalMediaID);
  if (parsedExternalMediaIdentity.type === 'customer-media-id' || parsedExternalMediaIdentity.type === 'media-id') {
    const mediaByCustomerMediaID = await resolveMediaByCustomerMediaID(customerID, parsedExternalMediaIdentity.numericID);
    if (mediaByCustomerMediaID) {
      return mediaByCustomerMediaID;
    }
  }
  if (externalMediaID) {
    const mediaList = await client.findMediaByExternalID(customerID, externalMediaID);
    if (Array.isArray(mediaList) && mediaList.length > 0) {
      return mediaList[0];
    }
  }
  return null;
}

async function resolveMediaByCustomerMediaID(v2CustomerID, customerMediaID) {
  const numericCustomerMediaID = Number(customerMediaID);
  if (!Number.isInteger(numericCustomerMediaID) || numericCustomerMediaID <= 0) {
    return null;
  }
  const legacyCustomerContext = await lookupLegacyCustomerIDByV2CustomerID(v2CustomerID);
  return getMediaByV1MediaID(legacyCustomerContext.legacyCustomerID, numericCustomerMediaID, {
    legacyCustomerID: legacyCustomerContext.legacyCustomerID
  });
}

async function createOrReuseTranscript(params) {
  const {
    client,
    customerID,
    mediaID,
    effectiveExternalMediaID,
    compatibilityExternalMediaIDs = [],
    externalMediaPath,
    provider,
    cdsJobID,
    cdsWorkerID
  } = params;
  const normalizedProviderName = normalizeProviderName(provider);
  const targetPayload = buildExtractionTargetFieldsForMedia({
    mediaID,
    externalMediaID: effectiveExternalMediaID
  });
  try {
    return await client.createTranscript(customerID, {
      ...STT_EN_TRANSCRIPT_IDENTITY,
      ...targetPayload,
      textOriginal: '',
      textOriginalSource: `AUTOGEN:${String(provider).toUpperCase()}`,
      providerName: normalizedProviderName,
      providerMeta: buildProviderMetaWithExecutionContext({}, {
        cdsJobID,
        cdsWorkerID,
        externalMediaPath
      }),
      status: 'RUNNING'
    });
  } catch (error) {
    if (!isTranscriptDuplicateError(error)) {
      throw error;
    }
  }

  const existingTranscript = await findTranscriptByExternalMediaIDs({
    client,
    customerID,
    externalMediaIDs: [
      effectiveExternalMediaID,
      ...compatibilityExternalMediaIDs
    ],
    providerName: normalizedProviderName
  });
  if (!existingTranscript) {
    throw new Error(
      `Transcript create conflicted but no existing transcript was found for target ${JSON.stringify(targetPayload)} and providerName ${normalizedProviderName}`
    );
  }
  const existingProviderMeta = (existingTranscript?.providerMeta && typeof existingTranscript.providerMeta === 'object')
    ? existingTranscript.providerMeta
    : {};
  if (
    isTranscriptTargetMismatch(existingTranscript, targetPayload)
    || String(existingProviderMeta?.externalMediaPath || '') !== String(externalMediaPath || '')
  ) {
    await client.updateTranscript(customerID, existingTranscript._id, {
      ...targetPayload,
      providerMeta: buildProviderMetaWithExecutionContext(existingProviderMeta, {
        cdsJobID,
        cdsWorkerID,
        externalMediaPath
      })
    }).catch(() => {});
  }
  return existingTranscript;
}

function isTranscriptDuplicateError(error) {
  if (!error) {
    return false;
  }
  if (Number(error.statusCode) === 409) {
    return true;
  }
  const bodyText = JSON.stringify(error.body || '').toLowerCase();
  return bodyText.includes('duplicate') || bodyText.includes('already exists') || bodyText.includes('e11000');
}

async function findTranscriptByExternalMediaID(params) {
  const { client, customerID, externalMediaID, providerName } = params;
  return findTranscriptByExternalMediaIDs({
    client,
    customerID,
    externalMediaIDs: [externalMediaID],
    providerName
  });
}

async function findTranscriptByExternalMediaIDs(params) {
  const { client, customerID, externalMediaIDs = [], providerName } = params;
  const normalizedProviderName = normalizeProviderName(providerName);
  const normalizedExternalMediaIDs = [...new Set(
    (Array.isArray(externalMediaIDs) ? externalMediaIDs : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  )];
  for (const candidateExternalMediaID of normalizedExternalMediaIDs) {
    const v1Target = parseExternalMediaIdentity(candidateExternalMediaID);
    if (
      typeof client.getNewestTranscriptByV1Target === 'function'
      && v1Target.numericID
    ) {
      const newestByV1Target = await client.getNewestTranscriptByV1Target(customerID, {
        v1TargetClassName: 'MEDIA',
        v1TargetID: v1Target.numericID,
        providerName: normalizedProviderName
      });
      if (newestByV1Target) {
        return newestByV1Target;
      }
    }

    const response = await client.listTranscripts(customerID, {
      ...STT_EN_TRANSCRIPT_IDENTITY,
      externalMediaID: candidateExternalMediaID,
      providerName: normalizedProviderName,
      limit: 100
    });
    const transcripts = extractTranscriptArray(response);
    if (!Array.isArray(transcripts) || transcripts.length === 0) {
      continue;
    }
    const exactMatch = transcripts.find((t) => {
      const isExternalMediaIDMatch = isTranscriptMatchedByExternalIdentity(t, candidateExternalMediaID);
      const isProviderMatch = normalizedProviderName
        ? normalizeProviderName(t?.providerName) === normalizedProviderName
        : true;
      return isExternalMediaIDMatch && isProviderMatch;
    });
    if (exactMatch) {
      return exactMatch;
    }
  }
  return null;
}

function extractTranscriptArray(response) {
  return extractCoreAPIArray(response);
}

function extractCoreAPIArray(response) {
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
  return [];
}

async function resolveSilenceForTranscription(params) {
  const {
    client,
    customerID,
    mediaID,
    externalMediaID,
    compatibilityExternalMediaIDs = [],
    externalMediaPath,
    audioPath,
    silenceNoiseDB,
    silenceDetectMinSecs,
    silenceMinSecs,
    silenceMinSecsToSave,
    isSilenceForceRecreate,
    reportProgress,
    analyzeSilenceHandler = analyzeSilence
  } = params;

  const existingExtractionResult = await findMostRecentSilenceExtraction({
    client,
    customerID,
    mediaID,
    externalMediaIDs: [externalMediaID, ...compatibilityExternalMediaIDs]
  });
  const existingExtraction = existingExtractionResult?.extraction || null;
  const matchedExtractions = Array.isArray(existingExtractionResult?.matchedExtractions)
    ? existingExtractionResult.matchedExtractions
    : [];

  const reusedExtractionID = String(existingExtraction?._id || existingExtraction?.extractionID || '').trim();
  const shouldReuseExisting = Boolean(existingExtraction) && !isSilenceForceRecreate;

  if (shouldReuseExisting) {
    const silenceIntervals = normalizeSilenceIntervalsFromExtractionData(existingExtraction?.extractionData);
    const fromExisting = buildSilenceAnalysisFromExistingExtraction({
      extraction: existingExtraction,
      silenceIntervals,
      silenceNoiseDB,
      silenceDetectMinSecs
    });
    const chunkingSilenceIntervals = filterSilenceIntervalsByMinSecs(fromExisting.silenceAnalysis.silenceIntervals, silenceMinSecs);
    const savedSilenceIntervals = filterSilenceIntervalsByMinSecs(fromExisting.silenceAnalysis.silenceIntervals, silenceMinSecsToSave);
    return {
      silenceAnalysis: fromExisting.silenceAnalysis,
      chunkingSilenceIntervals,
      savedSilenceIntervals,
      totalSavedSilenceMS: sumSilenceDurationMS(savedSilenceIntervals),
      debug: {
        source: 'existing',
        isReusedExisting: true,
        isForceRecreate: false,
        reusedExtractionID,
        extractionID: reusedExtractionID,
        extractionItemCount: 0,
        matchedExtractionCount: matchedExtractions.length
      }
    };
  }

  if (matchedExtractions.length > 0 && isSilenceForceRecreate) {
    await reportProgress?.({
      stage: 'analyze-silence',
      message: 'Recreating silence detection extraction',
      silenceDetection: {
        source: 'recreated',
        reusedExtractionID,
        matchedExtractionCount: matchedExtractions.length
      }
    });
    for (const extraction of matchedExtractions) {
      const extractionIDToDelete = String(extraction?._id || extraction?.extractionID || '').trim();
      if (!extractionIDToDelete) {
        continue;
      }
      await client.hardDeleteExtractionAndItems(customerID, extractionIDToDelete);
    }
  }

  const silenceAnalysis = await analyzeSilenceHandler(audioPath, {
    noiseDB: silenceNoiseDB,
    minSilenceSecs: silenceDetectMinSecs
  });
  const chunkingSilenceIntervals = filterSilenceIntervalsByMinSecs(silenceAnalysis.silenceIntervals, silenceMinSecs);
  const savedSilenceIntervals = filterSilenceIntervalsByMinSecs(silenceAnalysis.silenceIntervals, silenceMinSecsToSave);
  const totalSavedSilenceMS = sumSilenceDurationMS(savedSilenceIntervals);
  const createdExtraction = await createSilenceExtractionAndItems({
    client,
    customerID,
    mediaID,
    externalMediaID,
    externalMediaPath,
    silenceAnalysis
  });
  const createdExtractionID = String(createdExtraction?._id || createdExtraction?.extractionID || '').trim();
  return {
    silenceAnalysis,
    chunkingSilenceIntervals,
    savedSilenceIntervals,
    totalSavedSilenceMS,
    debug: {
      source: isSilenceForceRecreate ? 'recreated' : 'generated',
      isReusedExisting: false,
      isForceRecreate: isSilenceForceRecreate,
      reusedExtractionID: reusedExtractionID || null,
      extractionID: createdExtractionID || null,
      extractionItemCount: 0,
      matchedExtractionCount: matchedExtractions.length
    }
  };
}

async function createOrReplaceEventAndItemsExtraction(params) {
  const {
    client,
    customerID,
    mediaID,
    externalMediaID,
    compatibilityExternalMediaIDs = [],
    cdsV1EventID,
    keywordListJSON = [],
    eventWarnings = [],
    aiHintDebug = {}
  } = params;

  const normalizedKeywordList = normalizeKeywordListJSON(keywordListJSON);
  void eventWarnings;
  void aiHintDebug;
  const normalizedCdsV1EventID = Number(cdsV1EventID);
  if (!Number.isInteger(normalizedCdsV1EventID) || normalizedCdsV1EventID <= 0 || normalizedKeywordList.length === 0) {
    return {
      extraction: null,
      extractionID: null,
      itemCount: 0,
      replacedExtractionCount: 0
    };
  }

  const existing = await findMostRecentEventAndItemsExtraction({
    client,
    customerID,
    cdsV1EventID: normalizedCdsV1EventID
  });
  const matchedExtractions = Array.isArray(existing?.matchedExtractions) ? existing.matchedExtractions : [];
  for (const extraction of matchedExtractions) {
    const extractionIDToDelete = String(extraction?._id || extraction?.extractionID || '').trim();
    if (!extractionIDToDelete) {
      continue;
    }
    await client.hardDeleteExtractionAndItems(customerID, extractionIDToDelete);
  }

  const targetPayload = {
    v1TargetClassName: 'EVENT_AND_ITEMS',
    v1TargetID: normalizedCdsV1EventID
  };
  const extraction = await client.createExtraction(customerID, {
    extractionKind: 'KEYWORD_EXTRACTION',
    offsetUnit: 'NONE',
    status: 'COMPLETE',
    providerName: 'INTERNAL',
    ...targetPayload,
    extractionData: {
      keywordListJSON: normalizedKeywordList
    }
  });
  const extractionID = String(extraction?._id || extraction?.extractionID || '').trim();
  if (!extractionID) {
    throw new Error('CoreAPI createExtraction did not return extraction ID for EVENT_AND_ITEMS');
  }

  return {
    extraction,
    extractionID,
    itemCount: 0,
    replacedExtractionCount: matchedExtractions.length
  };
}

async function findMostRecentEventAndItemsExtraction(params) {
  const { client, customerID, cdsV1EventID } = params;
  const normalizedCdsV1EventID = Number(cdsV1EventID);
  if (!Number.isInteger(normalizedCdsV1EventID) || normalizedCdsV1EventID <= 0) {
    return {
      extraction: null,
      matchedExtractions: []
    };
  }
  const listResponse = await client.listExtractions(customerID, {
    extractionKind: 'KEYWORD_EXTRACTION',
    offsetUnit: 'NONE',
    status: 'COMPLETE',
    v1TargetClassName: 'EVENT_AND_ITEMS',
    v1TargetID: normalizedCdsV1EventID,
    limit: 100
  });
  const matchedExtractions = extractCoreAPIArray(listResponse);
  if (matchedExtractions.length === 0) {
    return {
      extraction: null,
      matchedExtractions: []
    };
  }
  const dedupedExtractions = [...new Map(
    matchedExtractions.map((extraction) => [String(extraction?._id || extraction?.extractionID || ''), extraction])
  ).values()].filter((extraction) => String(extraction?._id || extraction?.extractionID || '').trim().length > 0);
  const sorted = [...dedupedExtractions].sort((a, b) => getEntityTimestampMS(b) - getEntityTimestampMS(a));
  return {
    extraction: sorted[0] || null,
    matchedExtractions: dedupedExtractions
  };
}

function normalizeEventAndItemsRows(rows = []) {
  const normalized = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const sourceType = String(row?.sourceType || '').trim();
    const sourceID = String(row?.sourceID || '').trim();
    const title = String(row?.title || '').trim();
    const description = String(row?.description || '').trim();
    const externalID = String(row?.externalID || '').trim();
    const textOriginal = String(row?.textOriginal || '').trim();
    if (!sourceType || !textOriginal) {
      continue;
    }
    const dedupeKey = `${sourceType}::${sourceID}::${textOriginal}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    normalized.push({
      sourceType,
      sourceID,
      title,
      description,
      externalID,
      textOriginal
    });
  }
  return normalized;
}

function normalizeKeywordListJSON(keywordListJSON) {
  return [...new Set(
    (Array.isArray(keywordListJSON) ? keywordListJSON : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  )];
}

async function findMostRecentSilenceExtraction(params) {
  const { client, customerID, mediaID, externalMediaIDs = [] } = params;
  const normalizedExternalMediaIDs = [...new Set(
    (Array.isArray(externalMediaIDs) ? externalMediaIDs : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  )];
  const matchedExtractions = [];
  if (normalizedExternalMediaIDs.length === 0 && !mediaID) {
    return {
      extraction: null,
      matchedExtractions: []
    };
  }
  const queryCandidates = normalizedExternalMediaIDs.length > 0
    ? normalizedExternalMediaIDs
    : [null];
  for (const candidateExternalMediaID of queryCandidates) {
    const targetQuery = buildExtractionTargetFieldsForMedia({
      mediaID,
      externalMediaID: candidateExternalMediaID
    });
    if (!targetQuery.mediaID && !targetQuery.v1TargetID && !targetQuery.targetID) {
      continue;
    }
    const listResponse = await client.listExtractions(customerID, {
      extractionKind: 'SILENCE_DETECTION',
      offsetUnit: 'MS',
      status: 'COMPLETE',
      ...targetQuery,
      limit: 100
    });
    const extractions = extractCoreAPIArray(listResponse);
    if (!Array.isArray(extractions) || extractions.length === 0) {
      continue;
    }
    matchedExtractions.push(...extractions);
  }
  if (matchedExtractions.length === 0) {
    return {
      extraction: null,
      matchedExtractions: []
    };
  }
  const dedupedExtractions = [...new Map(
    matchedExtractions.map((extraction) => [String(extraction?._id || extraction?.extractionID || ''), extraction])
  ).values()].filter((extraction) => String(extraction?._id || extraction?.extractionID || '').trim().length > 0);
  const sorted = [...dedupedExtractions].sort((a, b) => getEntityTimestampMS(b) - getEntityTimestampMS(a));
  return {
    extraction: sorted[0] || null,
    matchedExtractions: dedupedExtractions
  };
}

function getEntityTimestampMS(value) {
  const updatedAtMS = Date.parse(String(value?.updatedAt || ''));
  if (Number.isFinite(updatedAtMS)) {
    return updatedAtMS;
  }
  const createdAtMS = Date.parse(String(value?.createdAt || ''));
  if (Number.isFinite(createdAtMS)) {
    return createdAtMS;
  }
  return 0;
}

function normalizeSilenceIntervalsFromExtractionData(extractionData = {}) {
  const sourceIntervals = Array.isArray(extractionData?.silenceIntervals)
    ? extractionData.silenceIntervals
    : [];
  const intervals = [];
  for (const interval of sourceIntervals) {
    const startMS = Number(interval?.startMS);
    const endMS = Number(interval?.endMS);
    if (!Number.isFinite(startMS) || !Number.isFinite(endMS) || endMS < startMS) {
      continue;
    }
    const providedDurationMS = Number(interval?.durationMS);
    const durationMS = Number.isFinite(providedDurationMS) && providedDurationMS >= 0
      ? providedDurationMS
      : Math.max(0, endMS - startMS);
    intervals.push({
      startMS: Math.round(startMS),
      endMS: Math.round(endMS),
      durationMS: Math.round(durationMS)
    });
  }
  return intervals.sort((a, b) => a.startMS - b.startMS);
}

function buildSilenceAnalysisFromExistingExtraction(params) {
  const { extraction, silenceIntervals, silenceNoiseDB, silenceDetectMinSecs } = params;
  const extractionData = (extraction?.extractionData && typeof extraction.extractionData === 'object')
    ? extraction.extractionData
    : {};
  const meta = (extractionData?.silenceAnalysisMeta && typeof extractionData.silenceAnalysisMeta === 'object')
    ? extractionData.silenceAnalysisMeta
    : {};
  const inferredAnalyzedDurationMS = silenceIntervals.length > 0
    ? Math.max(...silenceIntervals.map((interval) => Number(interval.endMS || 0)))
    : 0;
  const analyzedDurationMS = Number(extractionData?.analyzedDurationMS);
  const normalizedAnalyzedDurationMS = Number.isFinite(analyzedDurationMS) && analyzedDurationMS >= 0
    ? analyzedDurationMS
    : inferredAnalyzedDurationMS;
  const analyzedAt = String(meta.analyzedAt || extraction?.updatedAt || extraction?.createdAt || new Date().toISOString());
  return {
    silenceAnalysis: {
      silenceIntervals,
      totalSilenceMS: sumSilenceDurationMS(silenceIntervals),
      analyzedDurationMS: normalizedAnalyzedDurationMS,
      isSilenceAnalyzed: true,
      silenceAnalysisMeta: {
        noiseDB: Number.isFinite(Number(meta.noiseDB)) ? Number(meta.noiseDB) : silenceNoiseDB,
        minSilenceSecs: Number.isFinite(Number(meta.minSilenceSecs)) ? Number(meta.minSilenceSecs) : silenceDetectMinSecs,
        tool: String(meta.tool || 'coreapi:extractions'),
        analyzedAt
      }
    }
  };
}

async function createSilenceExtractionAndItems(params) {
  const { client, customerID, mediaID, externalMediaID, externalMediaPath, silenceAnalysis } = params;
  const extractedSilenceIntervals = normalizeSilenceIntervalsFromExtractionData({
    silenceIntervals: silenceAnalysis?.silenceIntervals
  });
  const targetPayload = buildExtractionTargetFieldsForMedia({
    mediaID,
    externalMediaID
  });
  const extraction = await client.createExtraction(customerID, {
    extractionKind: 'SILENCE_DETECTION',
    offsetUnit: 'MS',
    status: 'COMPLETE',
    ...targetPayload,
    providerName: 'FFMPEG',
    extractionData: {
      isSilenceAnalyzed: Boolean(silenceAnalysis?.isSilenceAnalyzed),
      analyzedDurationMS: Number(silenceAnalysis?.analyzedDurationMS || 0),
      totalSilenceMS: sumSilenceDurationMS(extractedSilenceIntervals),
      silenceIntervals: extractedSilenceIntervals,
      silenceAnalysisMeta: {
        noiseDB: Number(silenceAnalysis?.silenceAnalysisMeta?.noiseDB),
        minSilenceSecs: Number(silenceAnalysis?.silenceAnalysisMeta?.minSilenceSecs),
        tool: String(silenceAnalysis?.silenceAnalysisMeta?.tool || 'ffmpeg:silencedetect'),
        analyzedAt: String(silenceAnalysis?.silenceAnalysisMeta?.analyzedAt || new Date().toISOString())
      },
      ...(externalMediaPath ? { externalMediaPath } : {})
    }
  });
  const extractionID = String(extraction?._id || extraction?.extractionID || '').trim();
  if (!extractionID) {
    throw new Error('CoreAPI createExtraction did not return extraction ID');
  }
  return extraction;
}

function buildExtractionTargetFieldsForMedia(params = {}) {
  const mediaID = String(params.mediaID || '').trim();
  const parsedExternalMediaID = parseExternalMediaIdentity(params.externalMediaID);
  return {
    ...(mediaID ? {
      mediaID,
      targetClassName: 'MEDIA',
      targetID: mediaID
    } : {}),
    ...(parsedExternalMediaID.numericID ? {
      v1TargetClassName: 'MEDIA',
      v1TargetID: parsedExternalMediaID.numericID
    } : {})
  };
}

function isTranscriptMatchedByExternalIdentity(transcript, externalMediaID) {
  if (String(transcript?.externalMediaID || '') === String(externalMediaID || '')) {
    return true;
  }
  const parsedIdentity = parseExternalMediaIdentity(externalMediaID);
  if (!parsedIdentity.numericID) {
    return false;
  }
  return (
    String(transcript?.v1TargetClassName || '').toUpperCase() === 'MEDIA'
    && Number(transcript?.v1TargetID) === parsedIdentity.numericID
  );
}

function isTranscriptTargetMismatch(transcript, targetPayload) {
  if (!targetPayload || typeof targetPayload !== 'object') {
    return false;
  }
  const transcriptMediaID = String(transcript?.mediaID || '').trim();
  const expectedMediaID = String(targetPayload.mediaID || '').trim();
  const transcriptTargetID = String(transcript?.targetID || '').trim();
  const expectedTargetID = String(targetPayload.targetID || '').trim();
  const transcriptV1TargetID = Number(transcript?.v1TargetID);
  const expectedV1TargetID = Number(targetPayload.v1TargetID);

  if (expectedMediaID && transcriptMediaID !== expectedMediaID) {
    return true;
  }
  if (expectedTargetID && transcriptTargetID !== expectedTargetID) {
    return true;
  }
  if (Number.isInteger(expectedV1TargetID) && expectedV1TargetID > 0 && transcriptV1TargetID !== expectedV1TargetID) {
    return true;
  }
  return false;
}

function extractMediaPath(media) {
  if (!media || typeof media !== 'object') {
    return null;
  }
  return media.mediaPath
    || media.path
    || media.filePath
    || media.currentVersion?.mediaPath
    || media.currentVersion?.path
    || buildMediaPathFromV1Media(media)
    || null;
}

function buildProviderMetaWithExecutionContext(existingProviderMeta, executionContext = {}) {
  const providerMeta = {
    ...(existingProviderMeta && typeof existingProviderMeta === 'object' ? existingProviderMeta : {})
  };
  if (executionContext.cdsJobID) {
    providerMeta.cdsJobID = executionContext.cdsJobID;
  }
  if (executionContext.cdsWorkerID) {
    providerMeta.cdsWorkerID = executionContext.cdsWorkerID;
  }
  if (executionContext.externalMediaPath) {
    providerMeta.externalMediaPath = executionContext.externalMediaPath;
  }
  return providerMeta;
}

function normalizeMp4MediaPath(mediaPath) {
  const cleaned = String(mediaPath).replace(/^\/+/, '');
  if (cleaned.toLowerCase().endsWith('.mp4')) {
    return cleaned;
  }
  return `${cleaned}.mp4`;
}

function scopeMediaPathForCustomer(customerID, mediaPath) {
  const cleanedPath = String(mediaPath || '').replace(/^\/+/, '');
  const cleanedCustomerID = String(customerID || '').replace(/^\/+|\/+$/g, '');
  if (!cleanedCustomerID || !cleanedPath) {
    return cleanedPath;
  }

  const customerPrefix = `${cleanedCustomerID.toLowerCase()}/`;
  if (cleanedPath.toLowerCase().startsWith(customerPrefix)) {
    return cleanedPath;
  }
  return `${cleanedCustomerID}/${cleanedPath}`;
}

function buildCDSV1PathExternalMediaID(value) {
  const rawValue = String(value || '').trim();
  if (!rawValue) {
    throw new Error('Cannot build externalMediaID without a value');
  }
  if (
    rawValue.startsWith(EXTERNAL_MEDIA_ID_PREFIX_PATH)
    || rawValue.startsWith(EXTERNAL_MEDIA_ID_PREFIX_MEDIA_ID)
    || rawValue.startsWith(EXTERNAL_MEDIA_ID_PREFIX_CUSTOMER_MEDIA_ID)
  ) {
    return rawValue;
  }
  return `${EXTERNAL_MEDIA_ID_PREFIX_PATH}${rawValue.replace(/^\/+/, '')}`;
}

function buildCDSV1CustomerMediaIDExternalMediaID(customerMediaID) {
  const numericCustomerMediaID = Number(customerMediaID);
  if (!Number.isInteger(numericCustomerMediaID) || numericCustomerMediaID <= 0) {
    throw new Error(`customerMediaID must be a positive integer. Received: ${customerMediaID}`);
  }
  return `${EXTERNAL_MEDIA_ID_PREFIX_CUSTOMER_MEDIA_ID}${numericCustomerMediaID}`;
}

function buildExternalMediaPathValue(mediaPath) {
  const normalizedMediaPath = String(mediaPath || '').trim().replace(/^\/+/, '');
  if (!normalizedMediaPath) {
    return '';
  }
  return `${EXTERNAL_MEDIA_ID_PREFIX_PATH}${normalizedMediaPath}`;
}

function parseExternalMediaIdentity(value) {
  const rawValue = String(value || '').trim();
  if (!rawValue) {
    return {
      type: 'unknown',
      rawValue: '',
      numericID: null,
      mediaPath: ''
    };
  }
  if (rawValue.startsWith(EXTERNAL_MEDIA_ID_PREFIX_CUSTOMER_MEDIA_ID)) {
    const numericID = Number(rawValue.slice(EXTERNAL_MEDIA_ID_PREFIX_CUSTOMER_MEDIA_ID.length));
    return {
      type: 'customer-media-id',
      rawValue,
      numericID: Number.isInteger(numericID) && numericID > 0 ? numericID : null,
      mediaPath: ''
    };
  }
  if (rawValue.startsWith(EXTERNAL_MEDIA_ID_PREFIX_MEDIA_ID)) {
    const numericID = Number(rawValue.slice(EXTERNAL_MEDIA_ID_PREFIX_MEDIA_ID.length));
    return {
      type: 'media-id',
      rawValue,
      numericID: Number.isInteger(numericID) && numericID > 0 ? numericID : null,
      mediaPath: ''
    };
  }
  if (rawValue.startsWith(EXTERNAL_MEDIA_ID_PREFIX_PATH)) {
    return {
      type: 'path',
      rawValue,
      numericID: null,
      mediaPath: rawValue.slice(EXTERNAL_MEDIA_ID_PREFIX_PATH.length).replace(/^\/+/, '')
    };
  }
  return {
    type: 'raw-path',
    rawValue,
    numericID: null,
    mediaPath: rawValue.replace(/^\/+/, '')
  };
}

async function resolveCanonicalExternalMediaContext(params) {
  const {
    customerID,
    externalMediaID,
    cdsV1MediaID,
    resolvedMediaPath,
    normalizedMp4Path
  } = params;
  const parsedExternalMediaIdentity = parseExternalMediaIdentity(externalMediaID);
  const fallbackPath = String(resolvedMediaPath || parsedExternalMediaIdentity.mediaPath || normalizedMp4Path || '')
    .replace(/^\/+/, '');
  const normalizedFallbackPath = fallbackPath ? normalizeMp4MediaPath(fallbackPath) : '';
  const externalMediaPath = buildExternalMediaPathValue(normalizedFallbackPath || normalizedMp4Path || fallbackPath);
  const legacyPathCandidate = normalizedFallbackPath || normalizedMp4Path || fallbackPath;
  const compatibilityExternalMediaIDs = [
    ...new Set([
      externalMediaID ? String(externalMediaID).trim() : '',
      legacyPathCandidate ? buildCDSV1PathExternalMediaID(legacyPathCandidate) : '',
      cdsV1MediaID ? `${EXTERNAL_MEDIA_ID_PREFIX_MEDIA_ID}${Number(cdsV1MediaID)}` : ''
    ].filter(Boolean))
  ];

  let customerMediaID = null;
  let inputKind = parsedExternalMediaIdentity.type;
  if (cdsV1MediaID) {
    const numericCDSV1MediaID = Number(cdsV1MediaID);
    if (Number.isInteger(numericCDSV1MediaID) && numericCDSV1MediaID > 0) {
      customerMediaID = numericCDSV1MediaID;
      inputKind = 'media-id';
    }
  }
  if (!customerMediaID && parsedExternalMediaIdentity.numericID) {
    customerMediaID = parsedExternalMediaIdentity.numericID;
  }
  if (!customerMediaID && normalizedFallbackPath) {
    const customerAPILookupPath = stripCustomerPrefixFromPath(customerID, normalizedFallbackPath);
    const mediaLookup = await getMediaByLocationName(customerID, customerAPILookupPath);
    const resolvedCustomerMediaID = Number(mediaLookup?.media?.customerMediaID);
    if (Number.isInteger(resolvedCustomerMediaID) && resolvedCustomerMediaID > 0) {
      customerMediaID = resolvedCustomerMediaID;
      inputKind = parsedExternalMediaIdentity.type === 'unknown' ? 'resolved-path' : parsedExternalMediaIdentity.type;
    }
  }
  if (!customerMediaID) {
    return {
      canonicalExternalMediaID: '',
      customerMediaID: null,
      externalMediaPath,
      compatibilityExternalMediaIDs,
      inputKind
    };
  }
  const canonicalExternalMediaID = buildCDSV1CustomerMediaIDExternalMediaID(customerMediaID);
  return {
    canonicalExternalMediaID,
    customerMediaID,
    externalMediaPath,
    compatibilityExternalMediaIDs: [
      ...new Set([canonicalExternalMediaID, ...compatibilityExternalMediaIDs])
    ],
    inputKind
  };
}

function stripCustomerPrefixFromPath(customerID, mediaPath) {
  const normalizedPath = String(mediaPath || '').replace(/^\/+/, '');
  const normalizedCustomerID = String(customerID || '').replace(/^\/+|\/+$/g, '');
  if (!normalizedPath || !normalizedCustomerID) {
    return normalizedPath;
  }
  const prefix = `${normalizedCustomerID.toLowerCase()}/`;
  if (!normalizedPath.toLowerCase().startsWith(prefix)) {
    return normalizedPath;
  }
  return normalizedPath.slice(prefix.length);
}

function normalizeProviderName(value) {
  const normalizedValue = String(value || '').trim().toUpperCase();
  if (!normalizedValue) {
    return undefined;
  }
  if (!ALLOWED_PROVIDER_NAMES.has(normalizedValue)) {
    throw new Error(`Unsupported providerName: ${normalizedValue}`);
  }
  return normalizedValue;
}

function supportsProviderPolling(provider) {
  const normalizedProvider = String(provider || '').trim().toUpperCase();
  return normalizedProvider === ProviderType.ASSEMBLYAI || normalizedProvider === ProviderType.REVAI;
}

function inferProviderNameFromTextSource(textOriginalSource) {
  const sourceValue = String(textOriginalSource || '').trim();
  if (!sourceValue) {
    return undefined;
  }
  if (sourceValue.startsWith('AUTOGEN:')) {
    return normalizeProviderName(sourceValue.slice('AUTOGEN:'.length));
  }
  if (sourceValue.startsWith('HUMAN:')) {
    return 'HUMAN';
  }
  return undefined;
}

function resolveProviderNameForCreate(transcriptInfo, utterances = []) {
  const providerName = normalizeProviderName(transcriptInfo?.providerName);
  if (providerName) {
    return providerName;
  }
  const inferredProviderName = inferProviderNameFromTextSource(utterances[0]?.textOriginalSource);
  if (inferredProviderName) {
    return inferredProviderName;
  }
  throw new Error('providerName is required for transcript creation');
}

function buildLocalAACPath(localBasePath, mediaPath) {
  const audioRelativePath = mediaPath.replace(/\.mp4$/i, '.aac');
  return path.join(localBasePath, audioRelativePath);
}

async function downloadDFWMP4(dfwBaseUrl, customerID, mediaPath, tempBasePath) {
  const relative = scopeMediaPathForCustomer(customerID, mediaPath).replace(/^\/+/, '');
  const targetPath = path.join(tempBasePath, relative);
  await ensureParentDir(targetPath);

  const base = dfwBaseUrl.replace(/\/+$/, '');
  const url = `${base}/${relative}`;

  const response = await request(url, { method: 'GET' });
  if (response.statusCode >= 400) {
    throw new Error(`DFW download failed (${response.statusCode}) for ${relative}`);
  }

  await pipeline(response.body, fs.createWriteStream(targetPath));
  return targetPath;
}

async function extractAAC(inputMp4Path, outputAACPath, timeoutMS = 0) {
  await execFileAsync('ffmpeg', [
    '-nostdin',
    '-y',
    '-i', inputMp4Path,
    '-vn',
    '-acodec', 'copy',
    outputAACPath
  ], {
    ...(timeoutMS > 0 ? { timeout: timeoutMS } : {}),
    killSignal: 'SIGKILL',
    maxBuffer: 10 * 1024 * 1024
  });
}

async function extractAACChunk(inputAACPath, tempBasePath, chunk, timeoutMS = 0) {
  const chunkFileName = `${path.basename(inputAACPath, '.aac')}.chunk-${chunk.chunkIndex}.aac`;
  const chunkDir = path.join(tempBasePath, 'chunks');
  const outputAACPath = path.join(chunkDir, chunkFileName);
  await ensureParentDir(outputAACPath);

  await execFileAsync('ffmpeg', [
    '-nostdin',
    '-y',
    '-i', inputAACPath,
    '-ss', msToFfmpegTime(chunk.originalStartMS),
    '-to', msToFfmpegTime(chunk.originalEndMS),
    '-vn',
    '-acodec', 'copy',
    outputAACPath
  ], {
    ...(timeoutMS > 0 ? { timeout: timeoutMS } : {}),
    killSignal: 'SIGKILL',
    maxBuffer: 10 * 1024 * 1024
  });

  return outputAACPath;
}

async function submitToProvider(audioPath, provider, options, config) {
  const normalizedProvider = String(provider || '').toUpperCase();
  if (normalizedProvider === ProviderType.ASSEMBLYAI) {
    return submitToAssemblyAI(audioPath, options, config);
  }
  if (normalizedProvider === ProviderType.DEEPGRAM) {
    return submitToDeepGram(audioPath, options, config);
  }
  if (normalizedProvider === ProviderType.REVAI) {
    return submitToRevAI(audioPath, options, config);
  }
  throw new Error(`Unsupported provider: ${provider}`);
}

function normalizeCommonTranscriptionOptions(options = {}) {
  const keyTermsInput = Array.isArray(options?.keyTerms) ? options.keyTerms : [];
  const keyTerms = keyTermsInput
    .map((value) => sanitizeProviderKeyTerm(value))
    .filter(Boolean);
  const uniqueKeyTerms = [...new Set(keyTerms)];

  const speakerCountExpected = Number(options?.speakerCountExpected);
  const speakerCountMin = Number(options?.speakerCountMin);
  const speakerCountMax = Number(options?.speakerCountMax);

  const VALID_BOOST_PARAMS = new Set(['low', 'default', 'high']);
  const hintBoostParam = options?.hintBoostParam
    ? String(options.hintBoostParam).toLowerCase()
    : undefined;

  return {
    isDiarizationEnabled: options?.isDiarizationEnabled ?? options?.speakerLabels ?? true,
    punctuate: options?.punctuate ?? true,
    languageCode: options?.languageCode,
    model: options?.model,
    speakerCountExpected: Number.isFinite(speakerCountExpected) && speakerCountExpected > 0
      ? Math.round(speakerCountExpected)
      : undefined,
    speakerCountMin: Number.isFinite(speakerCountMin) && speakerCountMin > 0
      ? Math.round(speakerCountMin)
      : undefined,
    speakerCountMax: Number.isFinite(speakerCountMax) && speakerCountMax > 0
      ? Math.round(speakerCountMax)
      : undefined,
    keyTerms: uniqueKeyTerms,
    hintBoostParam: VALID_BOOST_PARAMS.has(hintBoostParam) ? hintBoostParam : undefined,
    hintBoostParamInvalid: hintBoostParam !== undefined && !VALID_BOOST_PARAMS.has(hintBoostParam)
  };
}

function sanitizeProviderKeyTerm(term) {
  return String(term || '')
    .trim()
    .replace(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|rtf)\b/ig, ' ')
    .replace(/\b(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|rtf)\b/ig, ' ')
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildAssemblyAIProviderOptions(options = {}) {
  const normalized = normalizeCommonTranscriptionOptions(options);
  const providerWarnings = [];
  const payload = {
    speaker_labels: normalized.isDiarizationEnabled,
    language_code: normalized.languageCode || 'en_us',
    punctuate: normalized.punctuate
  };
  if (normalized.model) {
    payload.speech_model = normalized.model;
  }

  if (normalized.speakerCountExpected) {
    payload.speakers_expected = normalized.speakerCountExpected;
    if (normalized.speakerCountMin || normalized.speakerCountMax) {
      providerWarnings.push('ASSEMBLYAI_IGNORED_SPEAKER_RANGE_WHEN_EXPECTED_SET');
    }
  } else if (normalized.speakerCountMin || normalized.speakerCountMax) {
    const min = normalized.speakerCountMin;
    const max = normalized.speakerCountMax;
    if (min && max && min > max) {
      payload.speaker_options = {
        min_speakers_expected: max,
        max_speakers_expected: min
      };
      providerWarnings.push('ASSEMBLYAI_SWAPPED_INVALID_SPEAKER_RANGE');
    } else {
      payload.speaker_options = {
        ...(min ? { min_speakers_expected: min } : {}),
        ...(max ? { max_speakers_expected: max } : {})
      };
    }
  }

  if (normalized.keyTerms.length > 0) {
    const effectiveModel = String(normalized.model || 'slam-1').toLowerCase();
    const filteredByLength = normalized.keyTerms.filter((term) => term.length <= 100);
    if (filteredByLength.length < normalized.keyTerms.length) {
      providerWarnings.push('ASSEMBLYAI_KEY_TERMS_TOO_LONG_FILTERED');
    }
    if (effectiveModel.startsWith('slam-1')) {
      payload.speech_model = normalized.model || 'slam-1';
      const safeKeyTerms = filteredByLength.slice(0, 100);
      if (safeKeyTerms.length < filteredByLength.length) {
        providerWarnings.push('ASSEMBLYAI_KEY_TERMS_TRUNCATED_TO_100');
      }
      payload.keyterms_prompt = safeKeyTerms;
    } else {
      payload.word_boost = filteredByLength;
      if (normalized.hintBoostParam) {
        payload.boost_param = normalized.hintBoostParam;
      }
      providerWarnings.push('ASSEMBLYAI_KEY_TERMS_USING_WORD_BOOST_FALLBACK');
    }
  }

  if (normalized.hintBoostParamInvalid) {
    providerWarnings.push('ASSEMBLYAI_INVALID_HINT_BOOST_PARAM');
  }

  return { payload, providerWarnings };
}

function buildDeepGramProviderOptions(options = {}) {
  const normalized = normalizeCommonTranscriptionOptions(options);
  const providerWarnings = [];
  const MAX_DEEPGRAM_KEY_TERM_COUNT_SAFE = 50;
  const queryParams = {
    diarize: String(normalized.isDiarizationEnabled),
    punctuate: String(normalized.punctuate),
    language: normalized.languageCode || 'en',
    model: normalized.model || 'nova-3',
    utterances: String(normalized.isDiarizationEnabled)
  };

  if (normalized.speakerCountExpected || normalized.speakerCountMin || normalized.speakerCountMax) {
    providerWarnings.push('DEEPGRAM_IGNORED_SPEAKER_COUNT_HINTS');
  }

  let keyTerms = [];
  let sanitizedCandidateKeyTerms = [];
  if (normalized.keyTerms.length > 0) {
    const normalizedModel = String((normalized.model || 'nova-3')).toLowerCase();
    const supportsKeyTerms = normalizedModel.startsWith('nova-3') || normalizedModel.startsWith('flux');
    if (!supportsKeyTerms) {
      providerWarnings.push('DEEPGRAM_KEY_TERMS_UNSUPPORTED_FOR_MODEL');
    } else {
      const sanitizedTerms = normalized.keyTerms
        .map((term) => sanitizeDeepGramKeyTerm(term))
        .filter(Boolean);
      sanitizedCandidateKeyTerms = sanitizedTerms;
      if (sanitizedTerms.length < normalized.keyTerms.length) {
        providerWarnings.push('DEEPGRAM_KEY_TERMS_INVALID_CHARS_FILTERED');
      }
      const filteredByLength = sanitizedTerms.filter(t => t.length <= 100);
      if (filteredByLength.length < sanitizedTerms.length) {
        providerWarnings.push('DEEPGRAM_KEY_TERMS_TOO_LONG_FILTERED');
      }
      const cappedByCount = filteredByLength.slice(0, MAX_DEEPGRAM_KEY_TERM_COUNT_SAFE);
      if (cappedByCount.length < filteredByLength.length) {
        providerWarnings.push('DEEPGRAM_KEY_TERMS_TRUNCATED_TO_SAFE_CAP');
      }
      keyTerms = capDeepGramKeyTermsByTotalLength(cappedByCount, providerWarnings);
    }
  }

  return { queryParams, keyTerms, providerWarnings, normalizedKeyTerms: normalized.keyTerms, sanitizedCandidateKeyTerms };
}

function buildRevAIProviderOptions(options = {}) {
  const normalized = normalizeCommonTranscriptionOptions(options);
  const providerWarnings = [];

  if (normalized.speakerCountExpected || normalized.speakerCountMin || normalized.speakerCountMax) {
    providerWarnings.push('REVAI_IGNORED_SPEAKER_COUNT_HINTS');
  }
  let customVocabularies = [];
  if (normalized.keyTerms.length > 0) {
    const filteredPhrases = normalized.keyTerms.filter(t => t.length <= 255);
    if (filteredPhrases.length < normalized.keyTerms.length) {
      providerWarnings.push('REVAI_KEY_TERM_PHRASE_TOO_LONG_FILTERED');
    }
    if (filteredPhrases.length > 0) {
      customVocabularies = [{ phrases: filteredPhrases }];
    } else {
      providerWarnings.push('REVAI_IGNORED_KEY_TERMS');
    }
  }
  if (normalized.model) {
    providerWarnings.push('REVAI_IGNORED_MODEL');
  }

  return {
    payload: {
      skip_diarization: !normalized.isDiarizationEnabled,
      skip_punctuation: !normalized.punctuate,
      ...(normalized.languageCode ? { language: normalized.languageCode } : {})
    },
    customVocabularies,
    providerWarnings
  };
}

async function resolveEventKeyHintAugmentation(params) {
  const {
    requestedTranscriptID,
    cdsV1EventID,
    isAIKeyHintExtractionEnabled,
    isAIKeyHintExtractionFailureFatal,
    customerID,
    provider,
    mediaID,
    externalMediaID,
    resolvedMediaPath,
    cdsV1MediaID,
    providerOptions,
    lookupLegacyCustomerIDByV2CustomerIDHandler,
    buildEventMediaContextHandler,
    buildEventKeyTermsHandler
  } = params;
  const debug = {
    isEnabled: isAIKeyHintExtractionEnabled === true,
    isApplied: false,
    cdsV1EventID: cdsV1EventID || null,
    provider: String(provider || '').toUpperCase(),
    callerKeyTermCount: Array.isArray(providerOptions?.keyTerms) ? providerOptions.keyTerms.length : 0,
    eventKeyTermCount: 0,
    finalKeyTermCount: 0,
    finalKeyTermsFull: [],
    llmInputTexts: [],
    llmInputCharCount: 0,
    llmUserPrompt: '',
    llmFailureReason: '',
    llmFailureCode: '',
    llmFailureMessage: '',
    llmFailureDetails: {},
    eventAndItemsRows: [],
    keywordListJSON: []
  };
  if (requestedTranscriptID || !cdsV1EventID) {
    return {
      resolvedMediaPath,
      providerOptions,
      eventHintWarnings: [],
      debug,
      fatalError: null
    };
  }

  let v1CustomerID = Number(customerID);
  if (!Number.isInteger(v1CustomerID) || v1CustomerID <= 0) {
    const legacyCustomerContext = await lookupLegacyCustomerIDByV2CustomerIDHandler(customerID);
    v1CustomerID = legacyCustomerContext.legacyCustomerID;
  }
  const eventMediaContext = await buildEventMediaContextHandler(v1CustomerID, cdsV1EventID);
  const eventMediaPath = String(eventMediaContext?.mediaPath || '').trim();
  let normalizedWarnings = Array.isArray(eventMediaContext?.eventWarnings) ? eventMediaContext.eventWarnings : [];
  let nextProviderOptions = { ...providerOptions };
  let finalKeyTerms = Array.isArray(providerOptions?.keyTerms) ? providerOptions.keyTerms : [];

  if (isAIKeyHintExtractionEnabled) {
    const eventKeyTermResult = await buildEventKeyTermsHandler(v1CustomerID, cdsV1EventID);
    const eventKeyTerms = Array.isArray(eventKeyTermResult?.keyTerms) ? eventKeyTermResult.keyTerms : [];
    const eventHintWarnings = Array.isArray(eventKeyTermResult?.eventWarnings) ? eventKeyTermResult.eventWarnings : [];
    const mergedKeyTerms = mergeKeyTermsWithCallerPriority(
      Array.isArray(providerOptions?.keyTerms) ? providerOptions.keyTerms : [],
      eventKeyTerms
    );
    const keyTermMaxChars = getProviderKeyTermMaxChars(provider);
    const cappedKeyTerms = mergedKeyTerms.filter((term) => term.length <= keyTermMaxChars);
    normalizedWarnings = [...new Set([
      ...normalizedWarnings,
      ...eventHintWarnings,
      ...(cappedKeyTerms.length < mergedKeyTerms.length ? ['EVENT_HINTS_KEY_TERMS_TOO_LONG_FILTERED'] : [])
    ])];
    nextProviderOptions = {
      ...providerOptions,
      keyTerms: cappedKeyTerms
    };
    finalKeyTerms = cappedKeyTerms;
    debug.isApplied = true;
    debug.eventKeyTermCount = eventKeyTerms.length;
    debug.keyTermMaxChars = keyTermMaxChars;
    debug.llmInputTexts = Array.isArray(eventKeyTermResult?.aiHintDebug?.llmInputTexts)
      ? eventKeyTermResult.aiHintDebug.llmInputTexts
      : [];
    debug.llmInputCharCount = Number(eventKeyTermResult?.aiHintDebug?.llmInputCharCount || 0);
    debug.llmUserPrompt = String(eventKeyTermResult?.aiHintDebug?.llmUserPrompt || '');
    debug.isLLMUsed = Boolean(eventKeyTermResult?.aiHintDebug?.isLLMUsed);
    debug.llmProvider = String(eventKeyTermResult?.aiHintDebug?.provider || '');
    debug.llmFailureReason = String(eventKeyTermResult?.aiHintDebug?.failureReason || '');
    debug.llmFailureCode = String(eventKeyTermResult?.aiHintDebug?.failureCode || '');
    debug.llmFailureMessage = String(eventKeyTermResult?.aiHintDebug?.failureMessage || '');
    debug.llmFailureDetails = (eventKeyTermResult?.aiHintDebug?.failureDetails && typeof eventKeyTermResult.aiHintDebug.failureDetails === 'object')
      ? eventKeyTermResult.aiHintDebug.failureDetails
      : {};
    debug.eventAndItemsRows = Array.isArray(eventKeyTermResult?.eventAndItemsRows)
      ? eventKeyTermResult.eventAndItemsRows
      : [];
    debug.keywordListJSON = Array.isArray(eventKeyTermResult?.keywordListJSON)
      ? eventKeyTermResult.keywordListJSON
      : [...eventKeyTerms];
  } else {
    debug.isApplied = false;
    debug.eventKeyTermCount = 0;
    debug.keyTermMaxChars = undefined;
    debug.isLLMUsed = false;
    debug.llmProvider = 'disabled';
    debug.llmFailureReason = 'disabled';
    debug.llmFailureCode = 'disabled';
    debug.llmFailureMessage = 'AI key hint extraction is disabled';
    debug.llmFailureDetails = {};
    debug.eventAndItemsRows = [];
    debug.keywordListJSON = [];
  }

  debug.finalKeyTermCount = Array.isArray(finalKeyTerms) ? finalKeyTerms.length : 0;
  debug.finalKeyTermsFull = Array.isArray(finalKeyTerms) ? [...finalKeyTerms] : [];
  debug.eventWarnings = normalizedWarnings;
  const shouldFailOnAIHintFailure = isAIKeyHintExtractionEnabled && isAIKeyHintExtractionFailureFatal !== false;
  if (shouldFailOnAIHintFailure && normalizedWarnings.includes(EVENT_HINTS_PROPER_NOUN_EXTRACTION_FAILED)) {
    return {
      resolvedMediaPath: (!mediaID && !externalMediaID && !resolvedMediaPath && !cdsV1MediaID && eventMediaPath)
        ? eventMediaPath
        : resolvedMediaPath,
      providerOptions: nextProviderOptions,
      eventHintWarnings: normalizedWarnings,
      debug,
      fatalError: {
        message: buildEventHintFailureMessage(debug),
        details: {
          warningCode: EVENT_HINTS_PROPER_NOUN_EXTRACTION_FAILED
        }
      }
    };
  }

  return {
    resolvedMediaPath: (!mediaID && !externalMediaID && !resolvedMediaPath && !cdsV1MediaID && eventMediaPath)
      ? eventMediaPath
      : resolvedMediaPath,
    providerOptions: nextProviderOptions,
    eventHintWarnings: normalizedWarnings,
    debug,
    fatalError: null
  };
}

function mergeKeyTermsWithCallerPriority(callerKeyTerms = [], eventKeyTerms = []) {
  return [...new Set([
    ...(Array.isArray(callerKeyTerms) ? callerKeyTerms : []),
    ...(Array.isArray(eventKeyTerms) ? eventKeyTerms : [])
  ].map((term) => String(term || '').trim()).filter(Boolean))];
}

function getProviderKeyTermMaxChars(provider) {
  const normalizedProvider = String(provider || '').toUpperCase();
  if (normalizedProvider === ProviderType.REVAI) {
    return 255;
  }
  return 100;
}

async function submitToAssemblyAI(audioPath, options, config) {
  const apiKey = config.transcription?.assemblyai?.apiKey;
  const baseUrl = (config.transcription?.assemblyai?.baseUrl || 'https://api.assemblyai.com/v2').replace(/\/+$/, '');
  if (!apiKey) {
    throw new Error('ASSEMBLYAI_API_KEY is required');
  }

  const uploadResponse = await request(`${baseUrl}/upload`, {
    method: 'POST',
    headers: {
      authorization: apiKey,
      'content-type': 'application/octet-stream'
    },
    body: fs.createReadStream(audioPath)
  });
  if (uploadResponse.statusCode >= 400) {
    const errorText = await uploadResponse.body.text();
    throw new Error(`AssemblyAI upload failed (${uploadResponse.statusCode}): ${errorText}`);
  }
  const uploadData = await uploadResponse.body.json();
  const uploadURL = uploadData?.upload_url;
  if (!uploadURL) {
    throw new Error('AssemblyAI upload did not return upload_url');
  }

  const providerOptions = buildAssemblyAIProviderOptions(options);
  const transcriptPayload = {
    audio_url: uploadURL,
    ...providerOptions.payload
  };
  const transcriptResponse = await request(`${baseUrl}/transcript`, {
    method: 'POST',
    headers: {
      authorization: apiKey,
      'content-type': 'application/json'
    },
    body: JSON.stringify(transcriptPayload)
  });
  if (transcriptResponse.statusCode >= 400) {
    const errorText = await transcriptResponse.body.text();
    throw new Error(`AssemblyAI transcript submit failed (${transcriptResponse.statusCode}): ${errorText}`);
  }
  const transcriptData = await transcriptResponse.body.json();
  if (!transcriptData?.id) {
    throw new Error('AssemblyAI transcript submit did not return job id');
  }

  return {
    providerJobID: transcriptData.id,
    providerWarnings: providerOptions.providerWarnings,
    providerMeta: {
      id: transcriptData.id,
      status: transcriptData.status,
      audio_duration: transcriptData.audio_duration,
      hintDebug: {
        requestedKeyTermCount: Array.isArray(options?.keyTerms) ? options.keyTerms.length : 0,
        requestedKeyTerms: Array.isArray(options?.keyTerms) ? [...options.keyTerms] : [],
        keyTermCount: Array.isArray(transcriptPayload.keyterms_prompt)
          ? transcriptPayload.keyterms_prompt.length
          : (Array.isArray(transcriptPayload.word_boost) ? transcriptPayload.word_boost.length : 0),
        keyTerms: Array.isArray(transcriptPayload.keyterms_prompt)
          ? [...transcriptPayload.keyterms_prompt]
          : (Array.isArray(transcriptPayload.word_boost) ? [...transcriptPayload.word_boost] : []),
        keyTermsPreview: Array.isArray(transcriptPayload.keyterms_prompt)
          ? transcriptPayload.keyterms_prompt.slice(0, 20)
          : (Array.isArray(transcriptPayload.word_boost) ? transcriptPayload.word_boost.slice(0, 20) : []),
        hintMode: Array.isArray(transcriptPayload.keyterms_prompt) ? 'keyterms_prompt' : 'word_boost'
      }
    }
  };
}

async function submitToDeepGram(audioPath, options, config) {
  const apiKey = config.transcription?.deepgram?.apiKey;
  const baseUrl = (config.transcription?.deepgram?.baseUrl || 'https://api.deepgram.com/v1').replace(/\/+$/, '');
  if (!apiKey) {
    throw new Error('DEEPGRAM_API_KEY is required');
  }

  const providerOptions = buildDeepGramProviderOptions(options);
  const buildListenUrl = (keyTerms = []) => {
    const query = new URLSearchParams(providerOptions.queryParams);
    keyTerms.forEach((term) => {
      query.append('keyterm', term);
    });
    return `${baseUrl}/listen?${query.toString()}`;
  };

  const submitRequest = async (keyTerms = []) => request(buildListenUrl(keyTerms), {
    method: 'POST',
    headers: {
      authorization: `Token ${apiKey}`,
      'content-type': 'audio/aac'
    },
    body: fs.createReadStream(audioPath)
  });

  let activeKeyTerms = providerOptions.keyTerms;
  let response = await submitRequest(activeKeyTerms);
  let didRetryWithoutKeyTerms = false;
  if (response.statusCode === 400 && activeKeyTerms.length > 0) {
    // Some keyterm payloads are rejected by Deepgram validation; retry once without keyterms.
    didRetryWithoutKeyTerms = true;
    activeKeyTerms = [];
    response = await submitRequest(activeKeyTerms);
    providerOptions.providerWarnings.push('DEEPGRAM_RETRIED_WITHOUT_KEY_TERMS_AFTER_400');
  }
  if (response.statusCode >= 400) {
    const errorText = await response.body.text();
    throw new Error(`DeepGram submit failed (${response.statusCode}): ${errorText}`);
  }
  const data = await response.body.json();
  const providerJobID = data?.metadata?.request_id || data?.request_id;
  if (!providerJobID) {
    throw new Error('DeepGram submit did not return request id');
  }

  return {
    providerJobID,
    providerResponse: data,
    providerWarnings: providerOptions.providerWarnings,
    providerMeta: {
      request_id: providerJobID,
      duration: data?.metadata?.duration,
      channels: data?.metadata?.channels,
      hintDebug: {
        requestedKeyTermCount: Array.isArray(providerOptions.normalizedKeyTerms) ? providerOptions.normalizedKeyTerms.length : 0,
        requestedKeyTerms: Array.isArray(providerOptions.keyTerms) ? [...providerOptions.keyTerms] : [],
        requestedKeyTermsSanitized: Array.isArray(providerOptions.sanitizedCandidateKeyTerms)
          ? [...providerOptions.sanitizedCandidateKeyTerms]
          : [],
        requestedKeyTermsOriginal: Array.isArray(options?.keyTerms) ? [...options.keyTerms] : [],
        keyTermCount: activeKeyTerms.length,
        keyTerms: [...activeKeyTerms],
        keyTermsPreview: activeKeyTerms.slice(0, 20),
        didRetryWithoutKeyTerms
      }
    }
  };
}

function sanitizeDeepGramKeyTerm(term) {
  const sanitized = sanitizeProviderKeyTerm(term);
  if (!sanitized) {
    return '';
  }
  if (/\b(page|memo|packet)\b/i.test(sanitized) && /\d/.test(sanitized) && sanitized.length > 60) {
    return '';
  }
  if (!/[A-Za-z0-9]/.test(sanitized)) {
    return '';
  }
  if (!/[A-Za-z]/.test(sanitized)) {
    return '';
  }
  return sanitized;
}

function capDeepGramKeyTermsByTotalLength(keyTerms, providerWarnings) {
  const MAX_DEEPGRAM_KEY_TERMS_TOTAL_CHARS = 2200;
  const accepted = [];
  let totalChars = 0;
  for (const term of keyTerms) {
    const nextChars = totalChars + term.length;
    if (nextChars > MAX_DEEPGRAM_KEY_TERMS_TOTAL_CHARS) {
      providerWarnings.push('DEEPGRAM_KEY_TERMS_TOTAL_CHARS_TRUNCATED');
      break;
    }
    accepted.push(term);
    totalChars = nextChars;
  }
  return accepted;
}

function buildUnifiedHintDebug(params = {}) {
  const { aiHintDebug, providerHintDebug, optionWarnings } = params;
  const keyTerms = Array.isArray(providerHintDebug?.keyTerms)
    ? [...providerHintDebug.keyTerms]
    : (Array.isArray(providerHintDebug?.submittedKeyTerms)
        ? [...providerHintDebug.submittedKeyTerms]
        : (Array.isArray(providerHintDebug?.requestedKeyTermsSanitized)
            ? [...providerHintDebug.requestedKeyTermsSanitized]
            : (Array.isArray(providerHintDebug?.requestedKeyTerms)
                ? [...providerHintDebug.requestedKeyTerms]
                : [])));
  const keyTermCount = Number(providerHintDebug?.keyTermCount || providerHintDebug?.submittedKeyTermCount || 0);
  const requestedKeyTermCount = Number(providerHintDebug?.requestedKeyTermCount || keyTerms.length || 0);
  return {
    warnings: Array.isArray(optionWarnings) ? [...optionWarnings] : [],
    extraction: {
      isEnabled: Boolean(aiHintDebug?.isEnabled),
      isApplied: Boolean(aiHintDebug?.isApplied),
      provider: String(aiHintDebug?.llmProvider || aiHintDebug?.provider || ''),
      cdsV1EventID: aiHintDebug?.cdsV1EventID ?? null,
      callerKeyTermCount: Number(aiHintDebug?.callerKeyTermCount || 0),
      eventKeyTermCount: Number(aiHintDebug?.eventKeyTermCount || 0),
      finalKeyTermCount: Number(aiHintDebug?.finalKeyTermCount || 0),
      keyTermMaxChars: Number.isFinite(aiHintDebug?.keyTermMaxChars) ? aiHintDebug.keyTermMaxChars : null,
      eventWarnings: Array.isArray(aiHintDebug?.eventWarnings) ? [...aiHintDebug.eventWarnings] : []
    },
    aiRequest: {
      isLLMUsed: Boolean(aiHintDebug?.isLLMUsed),
      failureReason: String(aiHintDebug?.llmFailureReason || ''),
      failureCode: String(aiHintDebug?.llmFailureCode || ''),
      failureMessage: String(aiHintDebug?.llmFailureMessage || ''),
      failureDetails: (aiHintDebug?.llmFailureDetails && typeof aiHintDebug.llmFailureDetails === 'object')
        ? { ...aiHintDebug.llmFailureDetails }
        : {},
      inputCharCount: Number(aiHintDebug?.llmInputCharCount || 0),
      inputTexts: Array.isArray(aiHintDebug?.llmInputTexts) ? [...aiHintDebug.llmInputTexts] : [],
      userPrompt: String(aiHintDebug?.llmUserPrompt || '')
    },
    providerSubmission: {
      requestedKeyTermCount,
      keyTermCount: keyTermCount || keyTerms.length,
      keyTerms,
      hintMode: String(providerHintDebug?.hintMode || ''),
      didRetryWithoutKeyTerms: Boolean(providerHintDebug?.didRetryWithoutKeyTerms)
    }
  };
}

function stripHintDebugFromProviderMeta(providerMeta) {
  const source = (providerMeta && typeof providerMeta === 'object') ? providerMeta : {};
  const { hintDebug: _ignoredHintDebug, ...rest } = source;
  return rest;
}

function buildProviderOptionWarningDetails(params = {}) {
  const optionWarnings = Array.isArray(params?.optionWarnings) ? [...new Set(params.optionWarnings)] : [];
  const aiHintDebug = params?.aiHintDebug;
  return optionWarnings.reduce((accumulator, warningCode) => {
    accumulator[warningCode] = resolveProviderOptionWarningMessage(warningCode, aiHintDebug);
    return accumulator;
  }, {});
}

function resolveProviderOptionWarningMessage(warningCode, aiHintDebug) {
  if (warningCode === 'EVENT_HINTS_PROPER_NOUN_EXTRACTION_FAILED') {
    return buildEventHintFailureMessage(aiHintDebug);
  }
  if (warningCode === 'EVENT_HINTS_EVENT_NOT_FOUND') {
    return 'Event hint extraction skipped because the event could not be found.';
  }
  if (warningCode === 'EVENT_HINTS_PRIMARY_MEDIA_NOT_FOUND') {
    return 'Event hint extraction could not resolve primary media for this event.';
  }
  if (warningCode === 'EVENT_HINTS_KEY_TERMS_TOO_LONG_FILTERED') {
    return 'Some extracted key terms exceeded provider length limits and were filtered.';
  }
  return `Warning emitted without additional context. Code=${warningCode}`;
}

function buildEventHintFailureMessage(aiHintDebug) {
  const failureMessage = String(aiHintDebug?.llmFailureMessage || '').trim();
  const failureReason = String(aiHintDebug?.llmFailureReason || '').trim();
  const failureCode = String(aiHintDebug?.llmFailureCode || '').trim();
  const failureDetails = (aiHintDebug?.llmFailureDetails && typeof aiHintDebug.llmFailureDetails === 'object')
    ? aiHintDebug.llmFailureDetails
    : null;

  const messageParts = [];
  if (failureMessage) {
    messageParts.push(failureMessage);
  } else {
    const reasonParts = [failureReason, failureCode].filter(Boolean);
    if (reasonParts.length > 0) {
      messageParts.push(`AI proper-noun extraction failed (${reasonParts.join(', ')})`);
    } else {
      messageParts.push('AI proper-noun extraction failed with no detailed error message.');
    }
  }
  if (failureDetails && Object.keys(failureDetails).length > 0) {
    messageParts.push(`details=${JSON.stringify(failureDetails)}`);
  }
  return messageParts.join(' | ');
}

async function submitToRevAI(audioPath, options, config) {
  const apiKey = config.transcription?.revai?.apiKey;
  const baseUrl = (config.transcription?.revai?.baseUrl || 'https://api.rev.ai/speechtotext/v1').replace(/\/+$/, '');
  if (!apiKey) {
    throw new Error('REVAI_API_KEY is required');
  }

  const providerOptions = buildRevAIProviderOptions(options);
  const audioBuffer = await fsp.readFile(audioPath);
  const formData = new FormData();
  formData.append('media', new Blob([audioBuffer], { type: 'audio/aac' }), path.basename(audioPath));
  Object.entries(providerOptions.payload).forEach(([key, value]) => {
    formData.append(key, String(value));
  });
  if (providerOptions.customVocabularies?.length > 0) {
    formData.append('custom_vocabularies', JSON.stringify(providerOptions.customVocabularies));
  }

  const response = await request(`${baseUrl}/jobs`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`
    },
    body: formData
  });
  if (response.statusCode >= 400) {
    const errorText = await response.body.text();
    throw new Error(`Rev.ai submit failed (${response.statusCode}): ${errorText}`);
  }
  const data = await response.body.json();
  const providerJobID = data?.id;
  if (!providerJobID) {
    throw new Error('Rev.ai submit did not return job id');
  }

  return {
    providerJobID,
    providerWarnings: providerOptions.providerWarnings,
    providerMeta: {
      id: providerJobID,
      status: data?.status,
      created_on: data?.created_on,
      hintDebug: {
        requestedKeyTermCount: Array.isArray(options?.keyTerms) ? options.keyTerms.length : 0,
        requestedKeyTerms: Array.isArray(options?.keyTerms) ? [...options.keyTerms] : [],
        keyTermCount: providerOptions.customVocabularies?.[0]?.phrases?.length || 0,
        keyTerms: Array.isArray(providerOptions.customVocabularies?.[0]?.phrases)
          ? [...providerOptions.customVocabularies[0].phrases]
          : [],
        keyTermsPreview: Array.isArray(providerOptions.customVocabularies?.[0]?.phrases)
          ? providerOptions.customVocabularies[0].phrases.slice(0, 20)
          : []
      }
    }
  };
}

async function ensureParentDir(filePath) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
}

async function fileExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function safeDelete(filePath) {
  if (!filePath) {
    return;
  }
  try {
    await fsp.rm(filePath, { force: true });
  } catch {
    // Best effort cleanup only
  }
}

function scheduleFileCleanup(filePath, ttlMS) {
  const timeout = setTimeout(() => {
    safeDelete(filePath).catch(() => {});
  }, ttlMS);
  if (typeof timeout.unref === 'function') {
    timeout.unref();
  }
}

function filterSilenceIntervalsByMinSecs(silenceIntervals, minSilenceSecs) {
  const minSilenceMS = Math.max(0, Math.round(Number(minSilenceSecs) * 1000));
  if (!Array.isArray(silenceIntervals)) {
    return [];
  }
  return silenceIntervals.filter((interval) => Number(interval?.durationMS) >= minSilenceMS);
}

function sumSilenceDurationMS(silenceIntervals) {
  if (!Array.isArray(silenceIntervals)) {
    return 0;
  }
  return silenceIntervals.reduce((sum, interval) => sum + Number(interval?.durationMS || 0), 0);
}

function msToFfmpegTime(ms) {
  const safeMS = Math.max(0, Math.round(ms));
  const hours = Math.floor(safeMS / 3600000);
  const minutes = Math.floor((safeMS % 3600000) / 60000);
  const seconds = Math.floor((safeMS % 60000) / 1000);
  const millis = safeMS % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export const __testables = {
  normalizeProviderName,
  inferProviderNameFromTextSource,
  resolveProviderNameForCreate,
  createTranscriptWithUtterances,
  createOrReuseTranscript,
  findTranscriptByExternalMediaID,
  findTranscriptByExternalMediaIDs,
  buildCDSV1PathExternalMediaID,
  buildCDSV1CustomerMediaIDExternalMediaID,
  buildExternalMediaPathValue,
  parseExternalMediaIdentity,
  resolveCanonicalExternalMediaContext,
  stripCustomerPrefixFromPath,
  supportsProviderPolling,
  normalizeCommonTranscriptionOptions,
  buildAssemblyAIProviderOptions,
  buildDeepGramProviderOptions,
  buildRevAIProviderOptions,
  resolveEventKeyHintAugmentation,
  mergeKeyTermsWithCallerPriority,
  getProviderKeyTermMaxChars,
  buildUnifiedHintDebug,
  buildProviderOptionWarningDetails,
  stripHintDebugFromProviderMeta,
  filterSilenceIntervalsByMinSecs,
  sumSilenceDurationMS,
  resolveSilenceForTranscription,
  createOrReplaceEventAndItemsExtraction,
  findMostRecentEventAndItemsExtraction,
  normalizeEventAndItemsRows,
  normalizeKeywordListJSON,
  findMostRecentSilenceExtraction,
  normalizeSilenceIntervalsFromExtractionData,
  buildSilenceAnalysisFromExistingExtraction
};

const ALLOWED_PROVIDER_NAMES = new Set(['ASSEMBLYAI', 'DEEPGRAM', 'REVAI', 'SRT', 'VTT', 'HUMAN']);
