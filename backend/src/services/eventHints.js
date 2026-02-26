import { getConfig } from '../config/appConfig.js';
import { buildMediaPathFromV1Media, getFullEventByV1EventID } from './customerApiData.js';

const EVENT_HINTS_PROPER_NOUN_EXTRACTION_FAILED = 'EVENT_HINTS_PROPER_NOUN_EXTRACTION_FAILED';
const EVENT_HINTS_EVENT_NOT_FOUND = 'EVENT_HINTS_EVENT_NOT_FOUND';
const EVENT_HINTS_PRIMARY_MEDIA_NOT_FOUND = 'EVENT_HINTS_PRIMARY_MEDIA_NOT_FOUND';
const MAX_HINT_OUTPUT_COUNT = 150;
const MAX_LLM_INPUT_ROWS = 300;
const MAX_LLM_INPUT_CHARS = 15000;
const DEFAULT_LLM_TIMEOUT_MS = 6000;

const HEURISTIC_STOP_WORDS = new Set([
  'The', 'A', 'An', 'To', 'For', 'Of', 'And', 'Or', 'In', 'On', 'At', 'By', 'From',
  'With', 'That', 'This', 'These', 'Those', 'Is', 'Are', 'Was', 'Be', 'Has', 'Have',
  'Will', 'Shall', 'Consider', 'Approve', 'Amend', 'Authorize', 'Discussion', 'Report',
  'Meeting', 'Minutes', 'Agenda', 'Staff', 'City', 'Public', 'Board'
]);
const REDUNDANT_VARIANT_MARKERS = new Set(['phase', 'ph', 'final', 'completion', 'cert', 'certificate']);

const PROMPT_SYSTEM = 'You are a proper-noun extractor to provide hints for improving government meeting transcription. You return ONLY a JSON array of strings. No other output.';
const PROMPT_USER_PREFIX = [
  'Extract all relevant proper nouns from the following government meeting content.',
  'Include: people names, organization names, place names, development project names, and legislative identifiers (e.g. "Resolution 25-267", "RZN 1888-2025").',
  'Exclude: common words, generic titles, verbs, adjectives.',
  'Each entry must be 1-6 words, under 100 characters.',
  'Return a JSON array of strings only.',
  '',
  '---'
].join('\n');

export function extractPrimaryMediaFromFullEvent(fullEvent) {
  const mediaItems = Array.isArray(fullEvent?.media) ? fullEvent.media : [];
  const match = mediaItems.find((item) =>
    Number(item?.mediaClassID) === 4
    && Number(item?.mediaTypeID) === 1
    && item?.deletedDateTimeUTC === null
  );
  if (!match) {
    return null;
  }

  const customerMediaID = Number(match.customerMediaID);
  const mediaPath = buildMediaPathFromV1Media(match);
  if (!Number.isInteger(customerMediaID) || customerMediaID <= 0 || !mediaPath) {
    return null;
  }

  return { customerMediaID, mediaPath };
}

export function extractRawHintTextsFromFullEvent(fullEvent) {
  const rows = extractEventAndItemsRowsFromFullEvent(fullEvent);
  return [...new Set(rows.map((row) => String(row?.textOriginal || '').trim()).filter(Boolean))];
}

export function extractEventAndItemsRowsFromFullEvent(fullEvent) {
  const rows = [];
  const eventTitle = pickFirstNonEmptyString(fullEvent, ['title', 'eventTitle', 'name', 'eventName']);
  const eventDescription = pickFirstNonEmptyString(fullEvent, ['description', 'eventDescription', 'summary']);
  const eventTextOriginal = joinTitleAndDescription(eventTitle, eventDescription);
  if (eventTextOriginal) {
    rows.push({
      sourceType: 'EVENT',
      sourceID: pickFirstNonEmptyString(fullEvent, ['customerEventID', 'eventID', '_id', 'id']),
      title: eventTitle,
      description: eventDescription,
      textOriginal: eventTextOriginal
    });
  }

  const agendaItems = Array.isArray(fullEvent?.agenda) ? fullEvent.agenda : [];
  for (const agendaItem of agendaItems) {
    const title = pickFirstNonEmptyString(agendaItem, ['title', 'agendaTitle', 'name']);
    const description = pickFirstNonEmptyString(agendaItem, ['description', 'agendaDescription', 'summary']);
    const textOriginal = joinTitleAndDescription(title, description);
    if (!textOriginal) {
      continue;
    }
    rows.push({
      sourceType: 'AGENDA_ITEM',
      sourceID: pickFirstNonEmptyString(agendaItem, ['customerAgendaItemID', 'agendaItemID', '_id', 'id']),
      title,
      description,
      textOriginal
    });
  }

  const timelineItems = Array.isArray(fullEvent?.timeline) ? fullEvent.timeline : [];
  for (const timelineItem of timelineItems) {
    const title = pickFirstNonEmptyString(timelineItem, ['title', 'timelineTitle', 'name']);
    if (!title) {
      continue;
    }
    rows.push({
      sourceType: 'TIMELINE_ITEM',
      sourceID: pickFirstNonEmptyString(timelineItem, ['customerTimelineItemID', 'timelineItemID', '_id', 'id']),
      title,
      description: '',
      externalID: pickFirstNonEmptyString(timelineItem, ['externalID']),
      textOriginal: title
    });
  }

  return dedupeEventAndItemsRows(rows);
}

export async function extractProperNounsFromTexts(rawTexts, deps = {}) {
  const result = await extractProperNounsFromTextsWithMeta(rawTexts, deps);
  return result.keyTerms;
}

export async function extractProperNounsFromTextsWithMeta(rawTexts, deps = {}) {
  const normalizedTexts = normalizeRawTexts(rawTexts);
  if (normalizedTexts.length === 0) {
    return {
      keyTerms: [],
      eventWarnings: [],
      aiDebug: {
        isLLMUsed: false,
        provider: 'none',
        llmInputTexts: [],
        llmInputCharCount: 0,
        llmUserPrompt: ''
      }
    };
  }

  const config = deps.config || getConfig();
  const { provider, eventWarnings } = resolveHintProvider(config);
  const inputTexts = capLLMInputTexts(normalizedTexts);
  const promptUser = `${PROMPT_USER_PREFIX}\n${inputTexts.join('\n')}`;
  const aiDebugBase = {
    llmInputTexts: [...inputTexts],
    llmInputCharCount: inputTexts.join('\n').length,
    llmUserPrompt: promptUser
  };

  if (provider === 'heuristic') {
    return {
      keyTerms: extractProperNounsHeuristic(inputTexts),
      eventWarnings,
      aiDebug: {
        ...aiDebugBase,
        isLLMUsed: false,
        provider: 'heuristic'
      }
    };
  }

  const apiKey = provider === 'anthropic'
    ? String(config?.anthropic?.apiKey || '').trim()
    : String(config?.openai?.apiKey || '').trim();
  if (!apiKey) {
    return {
      keyTerms: extractProperNounsHeuristic(inputTexts),
      eventWarnings: [...new Set([...eventWarnings, EVENT_HINTS_PROPER_NOUN_EXTRACTION_FAILED])],
      aiDebug: {
        ...aiDebugBase,
        isLLMUsed: false,
        provider,
        failureReason: 'missing-api-key'
      }
    };
  }

  try {
    const fetchImpl = deps.fetch || globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new Error('fetch is not available');
    }

    const timeoutMS = resolveTimeoutMS(config);
    const llmResponseText = provider === 'anthropic'
      ? await requestAnthropic({
        fetchImpl,
        apiKey,
        timeoutMS,
        promptUser
      })
      : await requestOpenAI({
        fetchImpl,
        apiKey,
        timeoutMS,
        promptUser
      });

    const parsedKeyTerms = parseLLMResponseAsStringArray(llmResponseText);
    const cleanedKeyTerms = cleanLLMKeyTermsWithHeuristic(parsedKeyTerms, inputTexts);
    return {
      keyTerms: capAndDedupeKeyTerms(cleanedKeyTerms),
      eventWarnings,
      aiDebug: {
        ...aiDebugBase,
        isLLMUsed: true,
        provider,
        llmResponsePreview: llmResponseText.slice(0, 2000)
      }
    };
  } catch (error) {
    const failure = normalizeLLMFailure(error, { provider });
    return {
      keyTerms: extractProperNounsHeuristic(inputTexts),
      eventWarnings: [...new Set([...eventWarnings, EVENT_HINTS_PROPER_NOUN_EXTRACTION_FAILED])],
      aiDebug: {
        ...aiDebugBase,
        isLLMUsed: false,
        provider,
        failureReason: 'llm-call-failed',
        failureCode: failure.code,
        failureMessage: failure.message,
        failureDetails: failure.details
      }
    };
  }
}

export async function buildEventKeyTerms(v1CustomerID, cdsV1EventID, deps = {}) {
  const fullEvent = await getFullEventByV1EventID(v1CustomerID, cdsV1EventID, deps);
  if (!fullEvent) {
    return {
      customerMediaID: null,
      mediaPath: null,
      keyTerms: [],
      keywordListJSON: [],
      eventAndItemsRows: [],
      eventWarnings: [EVENT_HINTS_EVENT_NOT_FOUND],
      aiHintDebug: {
        isLLMUsed: false,
        provider: 'none',
        llmInputTexts: [],
        llmInputCharCount: 0,
        llmUserPrompt: ''
      }
    };
  }

  const eventWarnings = [];
  const primaryMedia = extractPrimaryMediaFromFullEvent(fullEvent);
  if (!primaryMedia) {
    eventWarnings.push(EVENT_HINTS_PRIMARY_MEDIA_NOT_FOUND);
  }

  const eventAndItemsRows = extractEventAndItemsRowsFromFullEvent(fullEvent);
  const rawTexts = eventAndItemsRows.map((row) => row.textOriginal);
  const properNounsResult = await extractProperNounsFromTextsWithMeta(rawTexts, deps);

  return {
    customerMediaID: primaryMedia?.customerMediaID || null,
    mediaPath: primaryMedia?.mediaPath || null,
    keyTerms: properNounsResult.keyTerms,
    keywordListJSON: Array.isArray(properNounsResult.keyTerms) ? [...properNounsResult.keyTerms] : [],
    eventAndItemsRows,
    eventWarnings: [...new Set([...eventWarnings, ...(properNounsResult.eventWarnings || [])])],
    aiHintDebug: properNounsResult.aiDebug || {
      isLLMUsed: false,
      provider: 'unknown',
      llmInputTexts: [],
      llmInputCharCount: 0,
      llmUserPrompt: ''
    }
  };
}

export async function buildEventMediaContext(v1CustomerID, cdsV1EventID, deps = {}) {
  const fullEvent = await getFullEventByV1EventID(v1CustomerID, cdsV1EventID, deps);
  if (!fullEvent) {
    return {
      customerMediaID: null,
      mediaPath: null,
      eventWarnings: [EVENT_HINTS_EVENT_NOT_FOUND]
    };
  }

  const primaryMedia = extractPrimaryMediaFromFullEvent(fullEvent);
  if (!primaryMedia) {
    return {
      customerMediaID: null,
      mediaPath: null,
      eventWarnings: [EVENT_HINTS_PRIMARY_MEDIA_NOT_FOUND]
    };
  }

  return {
    customerMediaID: primaryMedia.customerMediaID,
    mediaPath: primaryMedia.mediaPath,
    eventWarnings: []
  };
}

function normalizeRawTexts(rawTexts) {
  if (!Array.isArray(rawTexts)) {
    return [];
  }
  return [...new Set(rawTexts
    .map((item) => String(item || '').trim())
    .filter(Boolean))];
}

function pickFirstNonEmptyString(source, keys) {
  if (!source || typeof source !== 'object' || !Array.isArray(keys)) {
    return '';
  }
  for (const key of keys) {
    const value = String(source?.[key] ?? '').trim();
    if (value) {
      return value;
    }
  }
  return '';
}

function joinTitleAndDescription(title, description) {
  const normalizedTitle = String(title || '').trim();
  const normalizedDescription = String(description || '').trim();
  if (normalizedTitle && normalizedDescription) {
    return `${normalizedTitle}. ${normalizedDescription}`;
  }
  return normalizedTitle || normalizedDescription;
}

function dedupeEventAndItemsRows(rows) {
  const deduped = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const normalizedRow = {
      sourceType: String(row?.sourceType || '').trim(),
      sourceID: String(row?.sourceID || '').trim(),
      title: String(row?.title || '').trim(),
      description: String(row?.description || '').trim(),
      externalID: String(row?.externalID || '').trim(),
      textOriginal: String(row?.textOriginal || '').trim()
    };
    if (!normalizedRow.sourceType || !normalizedRow.textOriginal) {
      continue;
    }
    const dedupeKey = `${normalizedRow.sourceType}::${normalizedRow.sourceID}::${normalizedRow.textOriginal}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    deduped.push(normalizedRow);
  }
  return deduped;
}

function capLLMInputTexts(rawTexts) {
  const cappedRows = rawTexts.slice(0, MAX_LLM_INPUT_ROWS);
  const texts = [];
  let charCount = 0;
  for (const text of cappedRows) {
    const delta = text.length + (texts.length > 0 ? 1 : 0);
    if (charCount + delta > MAX_LLM_INPUT_CHARS) {
      break;
    }
    texts.push(text);
    charCount += delta;
  }
  return texts;
}

function resolveHintProvider(config) {
  const explicitProviderRaw = String(config?.hintExtraction?.provider || '').trim().toLowerCase();
  if (explicitProviderRaw === 'heuristic') {
    return { provider: 'heuristic', eventWarnings: [] };
  }
  if (explicitProviderRaw === 'anthropic' || explicitProviderRaw === 'openai') {
    return { provider: explicitProviderRaw, eventWarnings: [] };
  }

  const hasAnthropicKey = String(config?.anthropic?.apiKey || '').trim().length > 0;
  const hasOpenAIKey = String(config?.openai?.apiKey || '').trim().length > 0;
  if (hasAnthropicKey) {
    return { provider: 'anthropic', eventWarnings: [] };
  }
  if (hasOpenAIKey) {
    return { provider: 'openai', eventWarnings: [] };
  }
  return { provider: 'heuristic', eventWarnings: [] };
}

function resolveTimeoutMS(config) {
  const configuredTimeoutMS = Number(config?.hintExtraction?.timeoutMS);
  if (Number.isFinite(configuredTimeoutMS) && configuredTimeoutMS > 0) {
    return configuredTimeoutMS;
  }
  return DEFAULT_LLM_TIMEOUT_MS;
}

async function requestAnthropic(params) {
  const {
    fetchImpl,
    apiKey,
    timeoutMS,
    promptUser
  } = params;
  const response = await fetchWithTimeout(fetchImpl, 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: PROMPT_SYSTEM,
      messages: [{ role: 'user', content: promptUser }]
    })
  }, timeoutMS);
  if (!response.ok) {
    const responsePreview = await safeReadResponseText(response);
    throw createLLMError('llm-http-error', `Anthropic request failed with status ${response.status}`, {
      provider: 'anthropic',
      endpoint: 'https://api.anthropic.com/v1/messages',
      httpStatus: response.status,
      responsePreview
    });
  }
  const data = await response.json();
  const text = data?.content?.[0]?.text;
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw createLLMError('llm-empty-response', 'Anthropic response did not include text content', {
      provider: 'anthropic',
      endpoint: 'https://api.anthropic.com/v1/messages'
    });
  }
  return text;
}

async function requestOpenAI(params) {
  const {
    fetchImpl,
    apiKey,
    timeoutMS,
    promptUser
  } = params;
  const response = await fetchWithTimeout(fetchImpl, 'https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: PROMPT_SYSTEM },
        { role: 'user', content: promptUser }
      ]
    })
  }, timeoutMS);
  if (!response.ok) {
    const responsePreview = await safeReadResponseText(response);
    throw createLLMError('llm-http-error', `OpenAI request failed with status ${response.status}`, {
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      httpStatus: response.status,
      responsePreview
    });
  }
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw createLLMError('llm-empty-response', 'OpenAI response did not include message content', {
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1/chat/completions'
    });
  }
  return text;
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMS);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createLLMError('llm-timeout', `LLM request timed out after ${timeoutMS}ms`, {
        endpoint: url,
        timeoutMS
      });
    }
    if (error?.code && error?.details) {
      throw error;
    }
    throw createLLMError('llm-network-error', String(error?.message || 'LLM network request failed'), {
      endpoint: url,
      errorName: String(error?.name || '')
    });
  } finally {
    clearTimeout(timer);
  }
}

function createLLMError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

async function safeReadResponseText(response) {
  try {
    const text = await response.text();
    return String(text || '').slice(0, 1000);
  } catch {
    return '';
  }
}

function normalizeLLMFailure(error, fallback = {}) {
  const details = (error?.details && typeof error.details === 'object') ? error.details : {};
  const mergedDetails = {
    ...details,
    ...(fallback?.provider ? { provider: fallback.provider } : {})
  };
  return {
    code: String(error?.code || 'llm-unknown-error'),
    message: String(error?.message || 'LLM request failed'),
    details: mergedDetails
  };
}

function parseLLMResponseAsStringArray(rawResponseText) {
  const parseCandidates = [];
  const rawText = String(rawResponseText || '').trim();
  parseCandidates.push(rawText);

  const fencedMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    parseCandidates.push(fencedMatch[1].trim());
  }

  const leftBracketIndex = rawText.indexOf('[');
  const rightBracketIndex = rawText.lastIndexOf(']');
  if (leftBracketIndex >= 0 && rightBracketIndex > leftBracketIndex) {
    parseCandidates.push(rawText.slice(leftBracketIndex, rightBracketIndex + 1).trim());
  }

  for (const candidate of parseCandidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (!Array.isArray(parsed)) {
        continue;
      }
      const terms = parsed
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean);
      return terms;
    } catch {
      // Try next candidate
    }
  }

  throw createLLMError('llm-parse-error', 'LLM response is not a valid JSON array of strings', {
    responsePreview: rawText.slice(0, 1000)
  });
}

function cleanLLMKeyTermsWithHeuristic(llmKeyTerms, rawTexts) {
  const normalizedLLMTerms = capAndDedupeKeyTerms(llmKeyTerms);
  const heuristicTerms = extractProperNounsHeuristic(rawTexts);
  const heuristicSingleWordSet = new Set(
    heuristicTerms
      .map((term) => String(term || '').trim())
      .filter((term) => term.split(/\s+/g).length === 1)
  );
  const multiWordComponentSet = new Set(
    normalizedLLMTerms
      .flatMap((term) => term.split(/\s+/g))
      .map((word) => sanitizeToken(word))
      .filter(Boolean)
  );

  return normalizedLLMTerms.filter((term) => {
    const words = term.split(/\s+/g).filter(Boolean);
    if (words.length !== 1) {
      return true;
    }
    const word = sanitizeToken(words[0]);
    if (!word) {
      return false;
    }
    if (HEURISTIC_STOP_WORDS.has(word)) {
      return false;
    }
    if (!heuristicSingleWordSet.has(word)) {
      return false;
    }
    if (multiWordComponentSet.has(word) && !/^[A-Z]{2,10}$/.test(word) && !/[A-Za-z].*\d|\d.*[A-Za-z]/.test(word)) {
      // If a plain word also appears only as part of a larger phrase, keep the phrase and drop the singleton.
      const appearsInMultiWord = normalizedLLMTerms.some((candidate) => {
        const candidateWords = candidate.split(/\s+/g).map((token) => sanitizeToken(token)).filter(Boolean);
        return candidateWords.length > 1 && candidateWords.includes(word);
      });
      if (appearsInMultiWord) {
        return false;
      }
    }
    return true;
  });
}

function extractProperNounsHeuristic(rawTexts) {
  const phrases = [];
  for (const text of rawTexts) {
    const segments = String(text || '')
      .split(/[,_;()]+/g)
      .map((segment) => segment.trim())
      .filter(Boolean);
    for (const segment of segments) {
      const segmentTokens = segment.split(/\s+/g).map((token) => sanitizeToken(token)).filter(Boolean);
      const activeTokens = [];
      for (const token of segmentTokens) {
        if (isHeuristicCandidateToken(token)) {
          activeTokens.push(token);
          continue;
        }
        if (activeTokens.length > 0) {
          phrases.push(activeTokens.join(' '));
          activeTokens.length = 0;
        }
      }
      if (activeTokens.length > 0) {
        phrases.push(activeTokens.join(' '));
      }
    }
  }
  return capAndDedupeKeyTerms(phrases);
}

function capAndDedupeKeyTerms(keyTerms) {
  const deduped = [...new Set((Array.isArray(keyTerms) ? keyTerms : [])
    .map((item) => String(item || '').trim().replace(/\s+/g, ' '))
    .filter(Boolean))];
  const acceptableTerms = deduped.filter((term) => isAcceptableHeuristicTerm(term));
  return removeRedundantVariantTerms(acceptableTerms)
    .slice(0, MAX_HINT_OUTPUT_COUNT);
}

function sanitizeToken(token) {
  return String(token || '')
    .trim()
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/[^A-Za-z0-9-]+$/, '');
}

function isHeuristicCandidateToken(token) {
  if (token.length < 2) {
    return false;
  }
  if (HEURISTIC_STOP_WORDS.has(token)) {
    return false;
  }
  if (/^[A-Z][A-Za-z0-9-]*$/.test(token)) {
    return true;
  }
  if (/^[A-Z0-9-]{2,}$/.test(token)) {
    return true;
  }
  if (/[A-Za-z].*\d|\d.*[A-Za-z]/.test(token)) {
    return true;
  }
  return false;
}

function isAcceptableHeuristicTerm(term) {
  const words = String(term || '').split(/\s+/g).filter(Boolean);
  if (words.length === 0 || words.length > 6) {
    return false;
  }
  if (words.every((word) => isCodeLikeToken(word) || REDUNDANT_VARIANT_MARKERS.has(word.toLowerCase()))) {
    return false;
  }
  if (words.length >= 2) {
    return true;
  }

  const word = words[0];
  if (HEURISTIC_STOP_WORDS.has(word)) {
    return false;
  }
  if (/^[A-Z]{2,10}$/.test(word)) {
    return true;
  }
  if (/[A-Za-z].*\d|\d.*[A-Za-z]/.test(word)) {
    return !isCodeLikeToken(word);
  }
  return false;
}

function removeRedundantVariantTerms(terms) {
  const candidates = Array.isArray(terms) ? terms : [];
  return candidates.filter((term) => {
    if (!isLikelyVariantTerm(term)) {
      return true;
    }
    return !candidates.some((candidate) => (
      candidate !== term
      && isCanonicalCandidate(candidate)
      && isWholeWordPhraseContained(term, candidate)
    ));
  });
}

function isLikelyVariantTerm(term) {
  const words = String(term || '').split(/\s+/g).filter(Boolean);
  if (words.length < 2) {
    return false;
  }
  const normalizedWords = words.map((word) => word.toLowerCase());
  if (normalizedWords.some((word) => REDUNDANT_VARIANT_MARKERS.has(word))) {
    return true;
  }
  if (words.some((word) => isCodeLikeToken(word))) {
    return true;
  }
  return false;
}

function isCanonicalCandidate(term) {
  const words = String(term || '').split(/\s+/g).filter(Boolean);
  if (words.length < 2) {
    return false;
  }
  return words.every((word) => /^[A-Z][A-Za-z0-9-]*$/.test(word) && !isCodeLikeToken(word));
}

function isWholeWordPhraseContained(term, phrase) {
  const normalizedTerm = ` ${String(term || '').toLowerCase().replace(/\s+/g, ' ')} `;
  const normalizedPhrase = ` ${String(phrase || '').toLowerCase().replace(/\s+/g, ' ')} `;
  return normalizedTerm.includes(normalizedPhrase);
}

function isCodeLikeToken(token) {
  const value = String(token || '').trim();
  if (!value) {
    return false;
  }
  return /^[0-9]+[A-Za-z]?$/.test(value) || /^[A-Za-z]?[0-9]+$/.test(value);
}

export default {
  extractPrimaryMediaFromFullEvent,
  extractEventAndItemsRowsFromFullEvent,
  extractRawHintTextsFromFullEvent,
  extractProperNounsFromTexts,
  extractProperNounsFromTextsWithMeta,
  buildEventKeyTerms,
  buildEventMediaContext
};
