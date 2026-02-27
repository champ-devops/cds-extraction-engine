import { parse, ProviderType } from '../parsers/index.js';
import { remapUtteranceFromChunk } from './timestampRemap.js';

/**
 * Reassemble chunked provider responses into a single normalized transcript payload.
 *
 * @param {{
 *   provider: string,
 *   chunkResponses: Array<{chunkIndex:number,response:object|string}>,
 *   chunkMap: Array<{chunkIndex:number,originalStartMS:number,originalEndMS:number,chunkStartMS:number,chunkEndMS:number,durationMS:number}>
 * }} params
 * @returns {{
 *   transcriptInfo: {
 *     providerName: string,
 *     providerJobID: string,
 *     providerMeta: object,
 *     textOriginal: string,
 *     audioDurationMS: number,
 *     overallConfidence: number
 *   },
 *   utterances: Array<object>
 * }}
 */
export function reassembleChunkedProviderResponses(params) {
  const { provider, chunkResponses, chunkMap } = params;
  const normalizedProvider = normalizeProvider(provider);

  if (!Array.isArray(chunkResponses) || chunkResponses.length === 0) {
    throw new Error('chunkResponses must be a non-empty array');
  }
  if (!Array.isArray(chunkMap) || chunkMap.length === 0) {
    throw new Error('chunkMap must be a non-empty array');
  }

  const parsedChunks = chunkResponses
    .map(entry => {
      if (!Number.isInteger(entry.chunkIndex)) {
        throw new Error('Each chunk response requires integer chunkIndex');
      }
      const parsed = parse(entry.response, { provider: normalizedProvider });
      return { chunkIndex: entry.chunkIndex, parsed };
    })
    .sort((a, b) => a.chunkIndex - b.chunkIndex);

  const mergedUtterances = [];
  const providerJobIDs = [];
  const providerMetas = [];
  const transcriptTexts = [];
  const confidences = [];

  for (const chunk of parsedChunks) {
    const { parsed, chunkIndex } = chunk;

    providerJobIDs.push(parsed.transcriptInfo.providerJobID || `chunk-${chunkIndex}`);
    providerMetas.push({
      chunkIndex,
      providerMeta: parsed.transcriptInfo.providerMeta || {}
    });
    const transcriptText = String(parsed.transcriptInfo.textOriginal || parsed.transcriptInfo.fullText || '').trim();
    if (transcriptText) {
      transcriptTexts.push(transcriptText);
    }
    if (Number.isFinite(parsed.transcriptInfo.overallConfidence)) {
      confidences.push(parsed.transcriptInfo.overallConfidence);
    }

    for (const utterance of parsed.utterances) {
      const remapped = remapUtteranceFromChunk(chunkMap, {
        chunkIndex,
        startMS: utterance.startMS,
        endMS: utterance.endMS
      });

      mergedUtterances.push({
        ...utterance,
        startMS: remapped.startMS,
        endMS: remapped.endMS,
        chunkIndex
      });
    }
  }

  mergedUtterances.sort((a, b) => {
    if (a.startMS !== b.startMS) return a.startMS - b.startMS;
    return a.endMS - b.endMS;
  });
  const dedupedUtterances = dedupeOverlapUtterances(mergedUtterances);
  dedupedUtterances.forEach((u, i) => {
    u.segmentIndex = i;
  });

  const audioDurationMS = Math.max(...chunkMap.map(c => c.originalEndMS), 0);
  const overallConfidence = confidences.length > 0
    ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length
    : 0;

  return {
    transcriptInfo: {
      providerName: normalizedProvider,
      providerJobID: providerJobIDs[0],
      providerMeta: {
        isChunkedReassembly: true,
        providerJobIDs,
        chunkCount: parsedChunks.length,
        chunkMap,
        chunkProviderMeta: providerMetas
      },
      textOriginal: transcriptTexts.join(' ').trim(),
      audioDurationMS,
      overallConfidence
    },
    utterances: dedupedUtterances
  };
}

function normalizeProvider(provider) {
  const value = String(provider || '').toUpperCase();
  if (value === ProviderType.ASSEMBLYAI) return ProviderType.ASSEMBLYAI;
  if (value === ProviderType.DEEPGRAM) return ProviderType.DEEPGRAM;
  if (value === ProviderType.REVAI) return ProviderType.REVAI;
  throw new Error(`Unsupported provider for chunk reassembly: ${provider}`);
}

function dedupeOverlapUtterances(utterances) {
  const dedupeWindowMS = 2000;
  const deduped = [];
  for (const utterance of utterances) {
    const previous = deduped[deduped.length - 1];
    if (!previous) {
      deduped.push(utterance);
      continue;
    }

    const isPotentialDuplicate = isSameSpeaker(previous, utterance)
      && normalizeText(previous.textOriginal) === normalizeText(utterance.textOriginal)
      && Math.abs(previous.startMS - utterance.startMS) <= dedupeWindowMS
      && Math.abs(previous.endMS - utterance.endMS) <= dedupeWindowMS;

    if (!isPotentialDuplicate) {
      deduped.push(utterance);
      continue;
    }

    const previousConfidence = Number.isFinite(previous.confidence) ? previous.confidence : -1;
    const currentConfidence = Number.isFinite(utterance.confidence) ? utterance.confidence : -1;
    if (currentConfidence > previousConfidence) {
      deduped[deduped.length - 1] = utterance;
    }
  }

  return deduped;
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function isSameSpeaker(left, right) {
  return String(left?.speakerOriginal || '').trim().toLowerCase()
    === String(right?.speakerOriginal || '').trim().toLowerCase();
}

export default { reassembleChunkedProviderResponses };
