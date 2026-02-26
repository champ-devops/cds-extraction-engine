/**
 * SRT/VTT Caption File Parser
 * 
 * Parses SubRip (SRT) and WebVTT (VTT) caption files and converts to normalized utterance format.
 * 
 * SRT timecode format: HH:MM:SS,mmm (comma for milliseconds)
 * VTT timecode format: HH:MM:SS.mmm (period for milliseconds)
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
 * @typedef {object} ParseOptions
 * @property {string} [captionerName] - Name of captioner for textOriginalSource (e.g., '3PLAYMEDIA')
 * @property {boolean} [extractSpeakers] - Whether to try extracting speakers from text patterns
 */

/**
 * Detect if content is VTT format (vs SRT)
 * @param {string} content - File content
 * @returns {boolean}
 */
export function isVTTFormat(content) {
  return content.trim().startsWith('WEBVTT');
}

/**
 * Detect if content is SRT format
 * @param {string} content - File content
 * @returns {boolean}
 */
export function isSRTFormat(content) {
  // SRT starts with a number (sequence), followed by timecode line
  const lines = content.trim().split('\n');
  if (lines.length < 2) return false;
  
  const firstLine = lines[0].trim();
  const secondLine = lines[1].trim();
  
  // First line should be a number
  if (!/^\d+$/.test(firstLine)) return false;
  
  // Second line should be timecode with -->
  return /^\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,\.]\d{3}/.test(secondLine);
}

/**
 * Parse SRT or VTT caption file
 * @param {string} content - File content
 * @param {ParseOptions} [options={}] - Parse options
 * @returns {object} Parsed result with transcript info and utterances
 */
export function parseCaptionFile(content, options = {}) {
  const isVTT = isVTTFormat(content);
  const utterances = isVTT ? parseVTT(content, options) : parseSRT(content, options);

  // Build transcript text from utterances
  const textOriginal = utterances.map(u => u.textOriginal).join(' ');

  // Determine source identifier
  let textOriginalSource = 'HUMAN:CAPTIONER';
  if (options.captionerName) {
    textOriginalSource = `HUMAN:${options.captionerName.toUpperCase()}`;
  }

  // Update utterances with the source
  utterances.forEach(u => {
    u.textOriginalSource = textOriginalSource;
  });

  return {
    transcriptInfo: {
      providerName: isVTT ? 'VTT' : 'SRT',
      providerJobID: null,
      textOriginal,
      audioDurationMS: utterances.length > 0 ? utterances[utterances.length - 1].endMS : 0,
      overallConfidence: 1.0  // Human captions assumed accurate
    },
    utterances
  };
}

/**
 * Parse SRT format
 * @param {string} content - SRT file content
 * @param {ParseOptions} options - Parse options
 * @returns {NormalizedUtterance[]} Array of normalized utterances
 */
function parseSRT(content, options) {
  const utterances = [];
  const blocks = content.trim().split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;

    // Line 0: sequence number (ignored, we use array index)
    // Line 1: timecodes
    // Lines 2+: text
    const timecodeMatch = lines[1].match(/^(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})/);
    if (!timecodeMatch) continue;

    const startMS = parseTimecode(timecodeMatch[1]);
    const endMS = parseTimecode(timecodeMatch[2]);

    // Join text lines
    let text = lines.slice(2).join(' ').trim();

    // Extract speaker if enabled
    let speaker = 'UNKNOWN';
    if (options.extractSpeakers) {
      const extracted = extractSpeaker(text);
      speaker = extracted.speaker;
      text = extracted.text;
    }

    // Remove HTML tags common in captions
    text = stripHtmlTags(text);

    if (text) {
      utterances.push({
        speakerOriginal: speaker,
        textOriginal: text,
        startMS,
        endMS,
        confidence: 1.0,  // Human captions assumed accurate
        segmentIndex: utterances.length,
        textOriginalSource: ''  // Will be set by caller
      });
    }
  }

  return utterances;
}

/**
 * Parse VTT format
 * @param {string} content - VTT file content
 * @param {ParseOptions} options - Parse options
 * @returns {NormalizedUtterance[]} Array of normalized utterances
 */
function parseVTT(content, options) {
  const utterances = [];
  
  // Remove WEBVTT header and any metadata
  const lines = content.split('\n');
  let startIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === 'WEBVTT') {
      startIndex = i + 1;
      break;
    }
  }

  // Skip any header metadata (lines until first blank line or timecode)
  while (startIndex < lines.length) {
    const line = lines[startIndex].trim();
    if (!line || /^\d{2}:\d{2}:\d{2}[,\.]\d{3}/.test(line) || /^\d+$/.test(line)) {
      break;
    }
    startIndex++;
  }

  // Rejoin and parse like SRT
  const srtContent = lines.slice(startIndex).join('\n');
  return parseSRT(srtContent, options);
}

/**
 * Parse timecode string to milliseconds
 * Supports both SRT format (HH:MM:SS,mmm) and VTT format (HH:MM:SS.mmm)
 * @param {string} timecode - Timecode string
 * @returns {number} Milliseconds
 */
export function parseTimecode(timecode) {
  // Normalize separator to comma
  const normalized = timecode.replace('.', ',');
  const [time, msStr] = normalized.split(',');
  const [hours, minutes, seconds] = time.split(':').map(Number);
  const ms = parseInt(msStr, 10);

  return (hours * 3600 + minutes * 60 + seconds) * 1000 + ms;
}

/**
 * Convert milliseconds to SRT timecode format
 * @param {number} ms - Milliseconds
 * @returns {string} Timecode in HH:MM:SS,mmm format
 */
export function toTimecode(ms) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const milliseconds = ms % 1000;

  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(seconds).padStart(2, '0')
  ].join(':') + ',' + String(milliseconds).padStart(3, '0');
}

/**
 * Extract speaker from text using common patterns
 * @param {string} text - Text that may contain speaker indicator
 * @returns {object} Object with speaker and cleaned text
 */
function extractSpeaker(text) {
  // Pattern: [Speaker Name]: text
  let match = text.match(/^\[([^\]]+)\]:\s*(.*)$/s);
  if (match) {
    return { speaker: match[1].trim(), text: match[2].trim() };
  }

  // Pattern: [Speaker Name] text (no colon)
  match = text.match(/^\[([^\]]+)\]\s+(.*)$/s);
  if (match) {
    return { speaker: match[1].trim(), text: match[2].trim() };
  }

  // Pattern: >>Speaker Name: text
  match = text.match(/^>>\s*([^:]+):\s*(.*)$/s);
  if (match) {
    return { speaker: match[1].trim(), text: match[2].trim() };
  }

  // Pattern: SPEAKER NAME: text (all caps name followed by colon)
  match = text.match(/^([A-Z][A-Z\s]+):\s*(.*)$/s);
  if (match) {
    return { speaker: match[1].trim(), text: match[2].trim() };
  }

  // Pattern: (Speaker Name) text
  match = text.match(/^\(([^)]+)\)\s*(.*)$/s);
  if (match) {
    return { speaker: match[1].trim(), text: match[2].trim() };
  }

  return { speaker: 'UNKNOWN', text };
}

/**
 * Strip HTML tags from text
 * @param {string} text - Text with potential HTML tags
 * @returns {string} Cleaned text
 */
function stripHtmlTags(text) {
  return text
    .replace(/<[^>]+>/g, '')  // Remove HTML tags
    .replace(/&nbsp;/g, ' ')   // Replace nbsp
    .replace(/&amp;/g, '&')    // Replace amp
    .replace(/&lt;/g, '<')     // Replace lt
    .replace(/&gt;/g, '>')     // Replace gt
    .replace(/&quot;/g, '"')   // Replace quot
    .replace(/&#39;/g, "'")    // Replace apos
    .replace(/\s+/g, ' ')      // Normalize whitespace
    .trim();
}

export default { parseCaptionFile, parseTimecode, toTimecode, isSRTFormat, isVTTFormat };
