/**
 * AssemblyAI JSON Response Parser
 * 
 * Parses AssemblyAI transcription response and converts to normalized utterance format.
 * 
 * AssemblyAI time units: milliseconds (no conversion needed)
 * Speaker format: Letters (A, B, C, ...)
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
 * Detect if JSON is from AssemblyAI
 * @param {object} json - Parsed JSON object
 * @returns {boolean}
 */
export function isAssemblyAIFormat(json) {
  return !!(json.acoustic_model && json.language_model);
}

/**
 * Parse AssemblyAI transcription response
 * @param {object} json - AssemblyAI response JSON
 * @returns {object} Parsed result with transcript info and utterances
 * @throws {Error} If JSON is not valid AssemblyAI format
 */
export function parseAssemblyAI(json) {
  if (!isAssemblyAIFormat(json)) {
    throw new Error('Invalid AssemblyAI format: missing acoustic_model or language_model');
  }

  if (json.status !== 'completed') {
    throw new Error(`AssemblyAI transcription not completed. Status: ${json.status}`);
  }

  // Extract provider metadata (everything except text/words/utterances)
  const providerMeta = extractProviderMeta(json);

  // Extract transcript-level data
  const transcriptInfo = {
    providerName: 'ASSEMBLYAI',
    providerJobID: json.id,
    providerMeta,
    textOriginal: json.text || '',
    languageCode: json.language_code,
    audioDurationMS: json.audio_duration,
    overallConfidence: json.confidence
  };

  // Parse utterances
  const utterances = parseUtterances(json);

  return {
    transcriptInfo,
    utterances
  };
}

/**
 * Parse utterances from AssemblyAI response
 * @param {object} json - AssemblyAI response JSON
 * @returns {NormalizedUtterance[]} Array of normalized utterances
 */
function parseUtterances(json) {
  // If utterances array exists, use it
  if (json.utterances && Array.isArray(json.utterances) && json.utterances.length > 0) {
    return json.utterances.map((utterance, index) => ({
      speakerOriginal: utterance.speaker || 'UNKNOWN',
      textOriginal: utterance.text || '',
      startMS: utterance.start,
      endMS: utterance.end,
      confidence: utterance.confidence || 0,
      segmentIndex: index,
      textOriginalSource: 'AUTOGEN:ASSEMBLY'
    }));
  }

  // Fall back to words array if no utterances
  // Group words by speaker changes to create utterances
  if (json.words && Array.isArray(json.words) && json.words.length > 0) {
    return groupWordsIntoUtterances(json.words);
  }

  // No utterances or words - create single utterance from full text
  if (json.text) {
    return [{
      speakerOriginal: 'UNKNOWN',
      textOriginal: json.text,
      startMS: 0,
      endMS: json.audio_duration || 0,
      confidence: json.confidence || 0,
      segmentIndex: 0,
      textOriginalSource: 'AUTOGEN:ASSEMBLY'
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
    const speaker = word.speaker || 'UNKNOWN';

    if (!currentUtterance || currentUtterance.speakerOriginal !== speaker) {
      // Start new utterance
      if (currentUtterance) {
        utterances.push(currentUtterance);
      }
      currentUtterance = {
        speakerOriginal: speaker,
        textOriginal: word.text,
        startMS: word.start,
        endMS: word.end,
        confidence: word.confidence || 0,
        segmentIndex: utterances.length,
        textOriginalSource: 'AUTOGEN:ASSEMBLY',
        _wordCount: 1,
        _confidenceSum: word.confidence || 0
      };
    } else {
      // Continue current utterance
      currentUtterance.textOriginal += ' ' + word.text;
      currentUtterance.endMS = word.end;
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
    return {
      speakerOriginal: u.speakerOriginal,
      textOriginal: u.textOriginal,
      startMS: u.startMS,
      endMS: u.endMS,
      confidence: avgConfidence,
      segmentIndex: index,
      textOriginalSource: u.textOriginalSource
    };
  });
}

/**
 * Extract provider metadata (excludes text/words/utterances)
 * @param {object} json - AssemblyAI response JSON
 * @returns {object} Provider metadata for storage
 */
function extractProviderMeta(json) {
  // Fields to exclude from providerMeta (stored separately or too large)
  const excludeFields = ['text', 'words', 'utterances'];

  const meta = {};
  for (const [key, value] of Object.entries(json)) {
    if (!excludeFields.includes(key)) {
      meta[key] = value;
    }
  }
  return meta;
}

export default { isAssemblyAIFormat, parseAssemblyAI };
