/**
 * Rev.ai JSON Transcript Parser
 *
 * Parses Rev.ai transcript JSON and converts to normalized utterance format.
 *
 * Rev.ai time units: seconds (must multiply by 1000 for milliseconds)
 */

/**
 * Detect if JSON is from Rev.ai transcript endpoint
 * @param {object} json - Parsed JSON object
 * @returns {boolean}
 */
export function isRevAIFormat(json) {
  return !!(json && Array.isArray(json.monologues));
}

/**
 * Parse Rev.ai transcript response
 * @param {object} json - Rev.ai transcript response JSON
 * @returns {{ transcriptInfo: object, utterances: object[] }}
 * @throws {Error} If JSON is not valid Rev.ai transcript format
 */
export function parseRevAI(json) {
  if (!isRevAIFormat(json)) {
    throw new Error('Invalid Rev.ai format: missing monologues array');
  }

  const utterances = parseMonologues(json.monologues);
  const transcriptInfo = {
    providerName: 'REVAI',
    providerJobID: json.id,
    providerMeta: extractProviderMeta(json),
    textOriginal: utterances.map((u) => u.textOriginal).join(' ').trim(),
    audioDurationMS: utterances.length > 0 ? utterances[utterances.length - 1].endMS : 0,
    overallConfidence: computeOverallConfidence(utterances)
  };

  return {
    transcriptInfo,
    utterances
  };
}

function parseMonologues(monologues) {
  const utterances = [];

  monologues.forEach((monologue, index) => {
    const elements = Array.isArray(monologue?.elements) ? monologue.elements : [];
    const tokenElements = elements.filter((element) => element?.type === 'text');
    const textOriginal = tokenElements.map((element) => element?.value || '').join(' ').replace(/\s+/g, ' ').trim();

    const timings = tokenElements
      .filter((element) => Number.isFinite(element?.ts) || Number.isFinite(element?.end_ts))
      .map((element) => ({
        startMS: toMS(element.ts),
        endMS: toMS(element.end_ts)
      }));

    const fallbackStartMS = utterances.length > 0 ? utterances[utterances.length - 1].endMS : 0;
    const firstTiming = timings[0];
    const lastTiming = timings[timings.length - 1];
    const range = normalizeRangeMS(firstTiming?.startMS ?? fallbackStartMS, lastTiming?.endMS ?? fallbackStartMS);

    const confidenceValues = tokenElements
      .map((element) => Number(element?.confidence))
      .filter((value) => Number.isFinite(value) && value >= 0 && value <= 1);
    const confidence = confidenceValues.length > 0
      ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
      : 0;

    utterances.push({
      speakerOriginal: monologue?.speaker != null ? String(monologue.speaker) : 'UNKNOWN',
      textOriginal,
      startMS: range.startMS,
      endMS: range.endMS,
      confidence,
      segmentIndex: index,
      textOriginalSource: 'AUTOGEN:REVAI'
    });
  });

  return utterances;
}

function toMS(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.round(numeric * 1000);
}

function normalizeRangeMS(startMS, endMS) {
  const safeStartMS = Number.isFinite(startMS) ? startMS : 0;
  const safeEndMS = Number.isFinite(endMS) ? endMS : safeStartMS;
  if (safeEndMS < safeStartMS) {
    return { startMS: safeEndMS, endMS: safeStartMS };
  }
  return { startMS: safeStartMS, endMS: safeEndMS };
}

function computeOverallConfidence(utterances) {
  const confidenceValues = utterances
    .map((utterance) => utterance.confidence)
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 1);
  if (confidenceValues.length === 0) {
    return 0;
  }
  return confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length;
}

function extractProviderMeta(json) {
  const meta = {};
  for (const [key, value] of Object.entries(json)) {
    if (key !== 'monologues') {
      meta[key] = value;
    }
  }
  return meta;
}

export default { isRevAIFormat, parseRevAI };
