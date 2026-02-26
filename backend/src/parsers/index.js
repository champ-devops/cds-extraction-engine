/**
 * Unified Parser Module
 * 
 * Auto-detects and parses transcription data from various sources:
 * - AssemblyAI JSON
 * - DeepGram JSON
 * - SRT/VTT caption files
 */

import { isAssemblyAIFormat, parseAssemblyAI } from './assemblyai.js';
import { isDeepGramFormat, parseDeepGram } from './deepgram.js';
import { isRevAIFormat, parseRevAI } from './revai.js';
import { parseCaptionFile, isSRTFormat, isVTTFormat } from './srt.js';

/**
 * Provider type enum
 */
export const ProviderType = {
  ASSEMBLYAI: 'ASSEMBLYAI',
  DEEPGRAM: 'DEEPGRAM',
  REVAI: 'REVAI',
  SRT: 'SRT',
  VTT: 'VTT',
  UNKNOWN: 'UNKNOWN'
};

/**
 * Detect the format/provider of the given content
 * @param {string|object} content - JSON object or string content
 * @returns {string} Provider type from ProviderType enum
 */
export function detectFormat(content) {
  // If it's a string, check for caption formats first
  if (typeof content === 'string') {
    if (isVTTFormat(content)) return ProviderType.VTT;
    if (isSRTFormat(content)) return ProviderType.SRT;
    
    // Try parsing as JSON
    try {
      const json = JSON.parse(content);
      return detectJsonProvider(json);
    } catch {
      return ProviderType.UNKNOWN;
    }
  }

  // It's already an object
  return detectJsonProvider(content);
}

/**
 * Detect JSON provider type
 * @param {object} json - Parsed JSON object
 * @returns {string} Provider type
 */
function detectJsonProvider(json) {
  if (isAssemblyAIFormat(json)) return ProviderType.ASSEMBLYAI;
  if (isDeepGramFormat(json)) return ProviderType.DEEPGRAM;
  if (isRevAIFormat(json)) return ProviderType.REVAI;
  return ProviderType.UNKNOWN;
}

/**
 * @typedef {object} ParseOptions
 * @property {string} [provider] - Force specific provider (ASSEMBLYAI, DEEPGRAM, REVAI, SRT, VTT)
 * @property {string} [captionerName] - For caption files, the name of the captioner
 * @property {boolean} [extractSpeakers] - For caption files, try to extract speakers from text
 */

/**
 * @typedef {object} ParseResult
 * @property {object} transcriptInfo - Transcript-level information
 * @property {string} transcriptInfo.providerName - Provider name (ASSEMBLYAI, DEEPGRAM, REVAI, null for captions)
 * @property {string} transcriptInfo.providerJobID - Provider's job/request ID
 * @property {string} transcriptInfo.textOriginal - Full transcript text
 * @property {number} transcriptInfo.audioDurationMS - Audio duration in milliseconds
 * @property {number} transcriptInfo.overallConfidence - Overall confidence score
 * @property {object[]} utterances - Array of normalized utterances
 */

/**
 * Parse transcription content from any supported format
 * @param {string|object} content - JSON object, JSON string, or caption file content
 * @param {ParseOptions} [options={}] - Parse options
 * @returns {ParseResult} Parsed result with transcript info and utterances
 * @throws {Error} If format is not recognized or parsing fails
 */
export function parse(content, options = {}) {
  let format = options.provider;

  if (!format) {
    format = detectFormat(content);
  }

  switch (format) {
    case ProviderType.ASSEMBLYAI: {
      const json = typeof content === 'string' ? JSON.parse(content) : content;
      return parseAssemblyAI(json);
    }

    case ProviderType.DEEPGRAM: {
      const json = typeof content === 'string' ? JSON.parse(content) : content;
      return parseDeepGram(json);
    }

    case ProviderType.REVAI: {
      const json = typeof content === 'string' ? JSON.parse(content) : content;
      return parseRevAI(json);
    }

    case ProviderType.SRT:
    case ProviderType.VTT: {
      if (typeof content !== 'string') {
        throw new Error('Caption content must be a string');
      }
      return parseCaptionFile(content, {
        captionerName: options.captionerName,
        extractSpeakers: options.extractSpeakers !== false  // Default true for captions
      });
    }

    case ProviderType.UNKNOWN:
    default:
      throw new Error('Unable to detect content format. Specify provider option or check content format.');
  }
}

/**
 * Validate that parsed utterances are well-formed
 * @param {object[]} utterances - Array of utterances to validate
 * @returns {object} Validation result with isValid boolean and errors array
 */
export function validateUtterances(utterances) {
  const errors = [];

  if (!Array.isArray(utterances)) {
    return { isValid: false, errors: ['Utterances must be an array'] };
  }

  utterances.forEach((u, index) => {
    if (typeof u.speakerOriginal !== 'string') {
      errors.push(`Utterance ${index}: speakerOriginal must be a string`);
    }
    if (typeof u.textOriginal !== 'string') {
      errors.push(`Utterance ${index}: textOriginal must be a string`);
    }
    if (typeof u.startMS !== 'number' || u.startMS < 0) {
      errors.push(`Utterance ${index}: startMS must be a non-negative number`);
    }
    if (typeof u.endMS !== 'number' || u.endMS < 0) {
      errors.push(`Utterance ${index}: endMS must be a non-negative number`);
    }
    if (u.startMS > u.endMS) {
      errors.push(`Utterance ${index}: startMS (${u.startMS}) cannot be greater than endMS (${u.endMS})`);
    }
    if (typeof u.confidence !== 'number' || u.confidence < 0 || u.confidence > 1) {
      errors.push(`Utterance ${index}: confidence must be a number between 0 and 1`);
    }
    if (typeof u.segmentIndex !== 'number' || u.segmentIndex < 0) {
      errors.push(`Utterance ${index}: segmentIndex must be a non-negative number`);
    }
    if (typeof u.textOriginalSource !== 'string') {
      errors.push(`Utterance ${index}: textOriginalSource must be a string`);
    }
  });

  return {
    isValid: errors.length === 0,
    errors
  };
}

// Re-export individual parsers for direct access
export { parseAssemblyAI, isAssemblyAIFormat } from './assemblyai.js';
export { parseDeepGram, isDeepGramFormat } from './deepgram.js';
export { parseRevAI, isRevAIFormat } from './revai.js';
export { parseCaptionFile, parseTimecode, toTimecode, isSRTFormat, isVTTFormat } from './srt.js';

export default { parse, detectFormat, validateUtterances, ProviderType };
