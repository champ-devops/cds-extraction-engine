import { parse } from '../parsers/index.js';
import { reassembleChunkedProviderResponses } from './chunkReassembly.js';

/**
 * Build finalized transcript payload from provider response(s).
 *
 * @param {{
 *   provider:string,
 *   providerResponse?:object|string,
 *   chunkResponses?:Array<{chunkIndex:number,response:object|string}>,
 *   chunkMap?:Array<object>
 * }} params
 * @returns {{transcriptInfo:object,utterances:Array<object>}}
 */
export function buildFinalizedTranscriptPayload(params) {
  const { provider, providerResponse, chunkResponses, chunkMap } = params;

  if (Array.isArray(chunkResponses) && chunkResponses.length > 0) {
    if (!Array.isArray(chunkMap) || chunkMap.length === 0) {
      throw new Error('chunkMap is required when chunkResponses are provided');
    }
    return reassembleChunkedProviderResponses({
      provider,
      chunkResponses,
      chunkMap
    });
  }

  if (!providerResponse) {
    throw new Error('providerResponse is required for non-chunked finalization');
  }

  return parse(providerResponse, { provider: String(provider || '').toUpperCase() });
}

/**
 * Persist finalized transcript and utterances to CoreAPI.
 *
 * @param {{
 *   customerID:string,
 *   transcriptID:string,
 *   finalizedPayload:{transcriptInfo:object,utterances:Array<object>},
 *   coreApiClient:object
 * }} params
 * @returns {Promise<{success:boolean,transcriptID:string,utteranceCount:number}>}
 */
export async function persistFinalizedTranscript(params) {
  const { customerID, transcriptID, finalizedPayload, coreApiClient, executionContext = {} } = params;
  const { transcriptInfo, utterances } = finalizedPayload;
  const providerName = normalizeProviderName(transcriptInfo.providerName);
  const textOriginalSource = `AUTOGEN:${providerName}`;

  if (!customerID) throw new Error('customerID is required');
  if (!transcriptID) throw new Error('transcriptID is required');
  if (!coreApiClient) throw new Error('coreApiClient is required');
  if (!transcriptInfo || !Array.isArray(utterances)) {
    throw new Error('finalizedPayload must include transcriptInfo and utterances');
  }

  const existingTranscript = (typeof coreApiClient.getTranscript === 'function')
    ? await coreApiClient.getTranscript(customerID, transcriptID).catch(() => null)
    : null;
  const existingProviderMeta = (existingTranscript?.providerMeta && typeof existingTranscript.providerMeta === 'object')
    ? existingTranscript.providerMeta
    : {};
  const providerMeta = buildProviderMetaWithExecutionContext({
    existingProviderMeta,
    transcriptInfoProviderMeta: transcriptInfo.providerMeta,
    executionContext
  });

  try {
    await coreApiClient.updateTranscript(customerID, transcriptID, {
      textOriginal: transcriptInfo.textOriginal || transcriptInfo.fullText || '',
      textOriginalSource,
      providerName,
      providerJobID: transcriptInfo.providerJobID,
      providerMeta,
      status: 'COMPLETE'
    });
  } catch (error) {
    throw annotateCoreApiError(error, 'updateTranscript');
  }

  const utterancePayload = utterances.map((u, index) => ({
    speakerOriginal: u.speakerOriginal,
    textOriginal: u.textOriginal,
    startMS: u.startMS,
    endMS: u.endMS,
    confidence: u.confidence,
    segmentIndex: index,
    textOriginalSource: u.textOriginalSource || textOriginalSource
  }));

  if (utterancePayload.length === 0) {
    return {
      success: true,
      transcriptID,
      utteranceCount: 0
    };
  }

  let created;
  try {
    created = await coreApiClient.createUtterances(customerID, transcriptID, utterancePayload);
  } catch (error) {
    throw annotateCoreApiError(error, 'createUtterances');
  }

  return {
    success: true,
    transcriptID,
    utteranceCount: Array.isArray(created) ? created.length : utterancePayload.length
  };
}

/**
 * High-level finalize workflow for poll-completion handlers.
 *
 * @param {{
 *   customerID:string,
 *   transcriptID:string,
 *   provider:string,
 *   coreApiClient:object,
 *   providerResponse?:object|string,
 *   chunkResponses?:Array<{chunkIndex:number,response:object|string}>,
 *   chunkMap?:Array<object>
 * }} params
 * @returns {Promise<{success:boolean,transcriptID:string,utteranceCount:number}>}
 */
export async function finalizeTranscription(params) {
  const finalizedPayload = buildFinalizedTranscriptPayload(params);
  return persistFinalizedTranscript({
    customerID: params.customerID,
    transcriptID: params.transcriptID,
    finalizedPayload,
    coreApiClient: params.coreApiClient,
    executionContext: params.executionContext
  });
}

export default {
  buildFinalizedTranscriptPayload,
  persistFinalizedTranscript,
  finalizeTranscription
};

function normalizeProviderName(value) {
  const normalizedValue = String(value || '').trim().toUpperCase();
  if (!normalizedValue) {
    throw new Error('providerName is required for finalized transcript persistence');
  }
  if (!ALLOWED_PROVIDER_NAMES.has(normalizedValue)) {
    throw new Error(`Unsupported providerName: ${normalizedValue}`);
  }
  return normalizedValue;
}

function annotateCoreApiError(error, operation) {
  if (!error || typeof error !== 'object') {
    return error;
  }
  error.details = {
    ...(error.details && typeof error.details === 'object' ? error.details : {}),
    operation
  };
  return error;
}

function buildProviderMetaWithExecutionContext(params) {
  const { existingProviderMeta, transcriptInfoProviderMeta, executionContext } = params;
  const providerMeta = {
    ...(existingProviderMeta && typeof existingProviderMeta === 'object' ? existingProviderMeta : {}),
    ...(transcriptInfoProviderMeta && typeof transcriptInfoProviderMeta === 'object' ? transcriptInfoProviderMeta : {})
  };

  // Finalized transcripts must not retain in-progress poll state.
  delete providerMeta.poll;

  if (Array.isArray(providerMeta.optionWarnings) && providerMeta.optionWarnings.length > 0) {
    const hintDebug = (providerMeta.hintDebug && typeof providerMeta.hintDebug === 'object')
      ? providerMeta.hintDebug
      : {};
    const existingWarnings = Array.isArray(hintDebug.warnings) ? hintDebug.warnings : [];
    hintDebug.warnings = [...new Set([...existingWarnings, ...providerMeta.optionWarnings])];
    providerMeta.hintDebug = hintDebug;
  }
  delete providerMeta.optionWarnings;

  if (providerMeta.isChunkedReassembly === true) {
    const chunking = (providerMeta.chunking && typeof providerMeta.chunking === 'object')
      ? { ...providerMeta.chunking }
      : {};
    if (Array.isArray(providerMeta.providerJobIDs)) {
      chunking.providerJobIDs = providerMeta.providerJobIDs;
    }
    if (Array.isArray(providerMeta.chunkMap)) {
      chunking.chunkMap = providerMeta.chunkMap;
    }
    if (Number.isInteger(providerMeta.chunkCount) && providerMeta.chunkCount > 0) {
      chunking.segmentCount = providerMeta.chunkCount;
    }
    providerMeta.chunking = chunking;

    delete providerMeta.isChunkedReassembly;
    delete providerMeta.providerJobIDs;
    delete providerMeta.chunkCount;
    delete providerMeta.chunkMap;
    delete providerMeta.chunkProviderMeta;

    // Remove stale single-job provider fields copied from pre-finalize metadata.
    delete providerMeta.id;
    delete providerMeta.status;
    delete providerMeta.audio_duration;
    delete providerMeta.audio_url;
    delete providerMeta.project_id;
    delete providerMeta.token_id;
  }

  if (executionContext?.cdsJobID) {
    providerMeta.cdsJobID = executionContext.cdsJobID;
  }
  if (executionContext?.cdsWorkerID) {
    providerMeta.cdsWorkerID = executionContext.cdsWorkerID;
  }
  return providerMeta;
}

const ALLOWED_PROVIDER_NAMES = new Set(['ASSEMBLYAI', 'DEEPGRAM', 'REVAI', 'SRT', 'VTT', 'HUMAN']);
