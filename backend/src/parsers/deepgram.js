/**
 * DeepGram JSON Response Parser
 * 
 * Parses DeepGram transcription response and converts to normalized utterance format.
 * 
 * DeepGram time units: SECONDS (must multiply by 1000 for milliseconds)
 * Speaker format: Integers (0, 1, 2, ...)
 */

/**
 * @typedef {object} NormalizedUtterance
 * @property {string} speakerOriginal - Speaker identifier
 * @property {string} textOriginal - Utterance text
 * @property {number} startMS - Start time in milliseconds
 * @property {number} endMS - End time in milliseconds
 * @property {number} confidence - Confidence score 0-1
 * @property {number} segmentIndex - 0-based index in sequence
 * @property {string} textOriginalSource - Source identifier
 */

/**
 * Detect if JSON is from DeepGram
 * @param {object} json - Parsed JSON object
 * @returns {boolean}
 */
export function isDeepGramFormat(json) {
  return !!(json.metadata && json.results && json.results.channels);
}

/**
 * Parse DeepGram transcription response
 * @param {object} json - DeepGram response JSON
 * @returns {object} Parsed result with transcript info and utterances
 * @throws {Error} If JSON is not valid DeepGram format
 */
export function parseDeepGram(json) {
  if (!isDeepGramFormat(json)) {
    throw new Error('Invalid DeepGram format: missing metadata or results.channels');
  }

  const metadata = json.metadata;

  // Extract provider metadata (the metadata object, excludes results content)
  const providerMeta = { ...metadata };

  // Extract transcript-level data
  const transcriptInfo = {
    providerName: 'DEEPGRAM',
    providerJobID: metadata.request_id,
    providerMeta,
    textOriginal: extractFullText(json),
    audioDurationMS: Math.round((metadata.duration || 0) * 1000),
    overallConfidence: extractOverallConfidence(json)
  };

  // Parse utterances
  const utterances = parseUtterances(json);

  return {
    transcriptInfo,
    utterances
  };
}

/**
 * Extract full transcript text from DeepGram response
 * @param {object} json - DeepGram response JSON
 * @returns {string} Full transcript text
 */
function extractFullText(json) {
  // Try to get from first channel's first alternative
  if (json.results?.channels?.[0]?.alternatives?.[0]?.transcript) {
    return json.results.channels[0].alternatives[0].transcript;
  }

  // Fall back to joining utterance transcripts
  if (json.results?.utterances) {
    return json.results.utterances.map(u => u.transcript).join(' ');
  }

  return '';
}

/**
 * Extract overall confidence from DeepGram response
 * @param {object} json - DeepGram response JSON
 * @returns {number} Overall confidence score
 */
function extractOverallConfidence(json) {
  if (json.results?.channels?.[0]?.alternatives?.[0]?.confidence) {
    return json.results.channels[0].alternatives[0].confidence;
  }
  return 0;
}

/**
 * Parse utterances from DeepGram response
 * @param {object} json - DeepGram response JSON
 * @returns {NormalizedUtterance[]} Array of normalized utterances
 */
function parseUtterances(json) {
  // Prefer utterances array if available (requires utterances=true in request)
  if (json.results?.utterances && Array.isArray(json.results.utterances) && json.results.utterances.length > 0) {
    return json.results.utterances.map((utterance, index) => {
      const normalizedRange = normalizeRangeMS(
        Math.round((utterance.start || 0) * 1000),
        Math.round((utterance.end || 0) * 1000)
      );

      return {
        speakerOriginal: utterance.speaker !== undefined ? String(utterance.speaker) : 'UNKNOWN',
        textOriginal: utterance.transcript || '',
        startMS: normalizedRange.startMS,  // Convert seconds to milliseconds
        endMS: normalizedRange.endMS,      // Convert seconds to milliseconds
        confidence: utterance.confidence || 0,
        segmentIndex: index,
        textOriginalSource: 'AUTOGEN:DEEPGRAM'
      };
    });
  }

  // Fall back to words array from first channel/alternative
  const words = json.results?.channels?.[0]?.alternatives?.[0]?.words;
  if (words && Array.isArray(words) && words.length > 0) {
    return groupWordsIntoUtterances(words);
  }

  // No utterances or words - create single utterance from full text
  const fullText = extractFullText(json);
  if (fullText) {
    const durationMS = Math.round((json.metadata?.duration || 0) * 1000);
    return [{
      speakerOriginal: 'UNKNOWN',
      textOriginal: fullText,
      startMS: 0,
      endMS: durationMS,
      confidence: extractOverallConfidence(json),
      segmentIndex: 0,
      textOriginalSource: 'AUTOGEN:DEEPGRAM'
    }];
  }

  return [];
}

/**
 * Group words into utterances based on speaker changes
 * @param {object[]} words - Array of word objects
 * @returns {NormalizedUtterance[]} Array of normalized utterances
 */
function groupWordsIntoUtterances(words) {
  const utterances = [];
  let currentUtterance = null;

  for (const word of words) {
    const speaker = word.speaker !== undefined ? String(word.speaker) : 'UNKNOWN';
    const text = word.punctuated_word || word.word || '';

    if (!currentUtterance || currentUtterance.speakerOriginal !== speaker) {
      // Start new utterance
      if (currentUtterance) {
        utterances.push(currentUtterance);
      }
      currentUtterance = {
        speakerOriginal: speaker,
        textOriginal: text,
        startMS: Math.round((word.start || 0) * 1000),
        endMS: Math.round((word.end || 0) * 1000),
        confidence: word.confidence || 0,
        segmentIndex: utterances.length,
        textOriginalSource: 'AUTOGEN:DEEPGRAM',
        _wordCount: 1,
        _confidenceSum: word.confidence || 0
      };
    } else {
      // Continue current utterance
      currentUtterance.textOriginal += ' ' + text;
      currentUtterance.endMS = Math.round((word.end || 0) * 1000);
      currentUtterance._wordCount++;
      currentUtterance._confidenceSum += word.confidence || 0;
    }
  }

  // Don't forget the last utterance
  if (currentUtterance) {
    utterances.push(currentUtterance);
  }

  // Calculate average confidence and clean up internal fields
  return utterances.map((u, index) => {
    const avgConfidence = u._wordCount > 0 ? u._confidenceSum / u._wordCount : 0;
    const normalizedRange = normalizeRangeMS(u.startMS, u.endMS);
    return {
      speakerOriginal: u.speakerOriginal,
      textOriginal: u.textOriginal,
      startMS: normalizedRange.startMS,
      endMS: normalizedRange.endMS,
      confidence: avgConfidence,
      segmentIndex: index,
      textOriginalSource: u.textOriginalSource
    };
  });
}

function normalizeRangeMS(startMS, endMS) {
  const safeStartMS = Number.isFinite(startMS) ? startMS : 0;
  const safeEndMS = Number.isFinite(endMS) ? endMS : safeStartMS;
  if (safeEndMS < safeStartMS) {
    return { startMS: safeEndMS, endMS: safeStartMS };
  }
  return { startMS: safeStartMS, endMS: safeEndMS };
}

export default { isDeepGramFormat, parseDeepGram };
