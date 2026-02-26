#!/usr/bin/env node

import { request } from 'undici';
import { initializeConfig, getConfig } from '../config/appConfig.js';
import {
  lookupLegacyCustomerIDByV2CustomerID,
  lookupV2CustomerIDByV1CustomerID,
  getFullEventByV1EventID
} from '../services/customerApiData.js';
import {
  buildEventKeyTerms,
  extractPrimaryMediaFromFullEvent,
  extractRawHintTextsFromFullEvent
} from '../services/eventHints.js';
import { getCoreApiClient } from '../clients/coreApiClient.js';
import { STT_EN_TRANSCRIPT_IDENTITY } from '../utils/transcriptIdentity.js';

const DEFAULT_SUMMARY_INPUT_CHAR_CAP = 20000;
const DEFAULT_SUMMARY_TRANSCRIPT_CHAR_CAP = 16000;

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = {
    customerID: '',
    cdsV1EventID: null,
    json: false,
    noSummary: false,
    summaryInputChars: DEFAULT_SUMMARY_INPUT_CHAR_CAP,
    summaryTranscriptChars: DEFAULT_SUMMARY_TRANSCRIPT_CHAR_CAP
  };

  for (const arg of args) {
    if (arg === '--json') {
      result.json = true;
      continue;
    }
    if (arg === '--no-summary') {
      result.noSummary = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      result.help = true;
      continue;
    }
    if (arg.startsWith('--customerID=')) {
      result.customerID = arg.split('=')[1] || '';
      continue;
    }
    if (arg.startsWith('--cdsV1EventID=')) {
      const parsed = Number(arg.split('=')[1]);
      if (Number.isInteger(parsed) && parsed > 0) {
        result.cdsV1EventID = parsed;
      }
      continue;
    }
    if (arg.startsWith('--summary-input-chars=')) {
      const parsed = Number(arg.split('=')[1]);
      if (Number.isInteger(parsed) && parsed > 1000) {
        result.summaryInputChars = parsed;
      }
      continue;
    }
    if (arg.startsWith('--summary-transcript-chars=')) {
      const parsed = Number(arg.split('=')[1]);
      if (Number.isInteger(parsed) && parsed > 1000) {
        result.summaryTranscriptChars = parsed;
      }
      continue;
    }
  }

  return result;
}

function printHelp() {
  console.log([
    'Usage:',
    '  node src/cli/debug-event-summary.js --customerID=<v2-or-v1> --cdsV1EventID=<id> [--json] [--no-summary]',
    '',
    'Purpose:',
    '  Fast LLM/debug path for event hint extraction and summary without running full transcription jobs.',
    '',
    'Options:',
    '  --customerID=<value>               Customer ID (v2 string like SpringHillTN, or numeric v1 ID)',
    '  --cdsV1EventID=<number>            Legacy Event ID',
    '  --json                             JSON output (recommended)',
    '  --no-summary                       Skip LLM summary; only fetch and run key-term extraction',
    '  --summary-input-chars=<number>     Max chars sent to summary prompt (default 20000)',
    '  --summary-transcript-chars=<num>   Max transcript chars included in summary prompt (default 16000)'
  ].join('\n'));
}

function resolveSummaryProvider(config) {
  const explicitProvider = String(config?.hintExtraction?.provider || '').trim().toLowerCase();
  const hasAnthropicKey = String(config?.anthropic?.apiKey || '').trim().length > 0;
  const hasOpenAIKey = String(config?.openai?.apiKey || '').trim().length > 0;

  if (explicitProvider === 'openai') return 'openai';
  if (explicitProvider === 'anthropic') return 'anthropic';
  if (explicitProvider === 'heuristic') return 'none';
  if (hasOpenAIKey) return 'openai';
  if (hasAnthropicKey) return 'anthropic';
  return 'none';
}

async function requestSummaryFromOpenAI({ apiKey, timeoutMS, prompt }) {
  const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 700,
      messages: [
        { role: 'system', content: 'You summarize municipality meeting context for engineering debugging. Return plain text only.' },
        { role: 'user', content: prompt }
      ]
    })
  }, timeoutMS);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`openai-http-${response.status}: ${body.slice(0, 500)}`);
  }
  const json = await response.json();
  return String(json?.choices?.[0]?.message?.content || '').trim();
}

async function requestSummaryFromAnthropic({ apiKey, timeoutMS, prompt }) {
  const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 700,
      system: 'You summarize municipality meeting context for engineering debugging. Return plain text only.',
      messages: [{ role: 'user', content: prompt }]
    })
  }, timeoutMS);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`anthropic-http-${response.status}: ${body.slice(0, 500)}`);
  }
  const json = await response.json();
  return String(json?.content?.[0]?.text || '').trim();
}

async function fetchWithTimeout(url, options, timeoutMS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildSummaryPrompt({ customerID, cdsV1EventID, mediaPath, rawHintTexts, transcriptText, keyTerms, summaryInputChars, summaryTranscriptChars }) {
  const compactAgenda = rawHintTexts.slice(0, 120).join('\n');
  const compactTranscript = transcriptText.slice(0, summaryTranscriptChars);
  const compactKeyTerms = keyTerms.slice(0, 120).join(', ');

  const prompt = [
    `Customer: ${customerID}`,
    `Event ID: ${cdsV1EventID}`,
    `Primary media path: ${mediaPath || '<none>'}`,
    '',
    'Task:',
    '1) Summarize meeting themes in 6-10 bullets.',
    '2) List the top 20 likely transcription key terms.',
    '3) Flag obviously noisy or duplicated terms.',
    '',
    `Existing key terms (${keyTerms.length}):`,
    compactKeyTerms || '<none>',
    '',
    `Agenda/timeline/attachment text (${rawHintTexts.length} lines):`,
    compactAgenda || '<none>',
    '',
    'Transcript text (truncated):',
    compactTranscript || '<none>'
  ].join('\n');

  return prompt.slice(0, summaryInputChars);
}

function toExternalMediaIDFromPath(mediaPath) {
  const normalizedPath = String(mediaPath || '').trim().replace(/^\/+/, '');
  if (!normalizedPath) {
    return '';
  }
  if (normalizedPath.startsWith('CDSV1Path:')) {
    return normalizedPath;
  }
  return `CDSV1Path:${normalizedPath}`;
}

function selectBestTranscript(transcripts = []) {
  const list = Array.isArray(transcripts) ? transcripts : [];
  const complete = list.filter((item) => String(item?.status || '').toUpperCase() === 'COMPLETE');
  const preferred = complete.length > 0 ? complete : list;
  return preferred
    .slice()
    .sort((a, b) => {
      const aModified = Date.parse(String(a?.modifiedAt || a?.updatedAt || a?.createdAt || ''));
      const bModified = Date.parse(String(b?.modifiedAt || b?.updatedAt || b?.createdAt || ''));
      if (Number.isFinite(aModified) && Number.isFinite(bModified) && aModified !== bModified) {
        return bModified - aModified;
      }
      const aLen = String(a?.textOriginal || a?.fullText || '').length;
      const bLen = String(b?.textOriginal || b?.fullText || '').length;
      return bLen - aLen;
    })[0] || null;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.customerID || !args.cdsV1EventID) {
    printHelp();
    process.exit(1);
    return;
  }

  await initializeConfig();
  const config = getConfig();
  const coreApiClient = getCoreApiClient();

  const customerIDInput = String(args.customerID).trim();
  const asNumber = Number(customerIDInput);
  const isNumericCustomerID = Number.isInteger(asNumber) && asNumber > 0;

  const customerContext = isNumericCustomerID
    ? await lookupV2CustomerIDByV1CustomerID(asNumber)
    : await lookupLegacyCustomerIDByV2CustomerID(customerIDInput);
  const v1CustomerID = Number(customerContext.legacyCustomerID);
  const v2CustomerID = String(customerContext.v2CustomerID || customerIDInput).trim();

  const fullEvent = await getFullEventByV1EventID(v1CustomerID, args.cdsV1EventID);
  const primaryMedia = extractPrimaryMediaFromFullEvent(fullEvent);
  const mediaPath = String(primaryMedia?.mediaPath || '').trim();
  const rawHintTexts = extractRawHintTextsFromFullEvent(fullEvent);

  const eventKeyTermResult = await buildEventKeyTerms(v1CustomerID, args.cdsV1EventID);
  const keyTerms = Array.isArray(eventKeyTermResult?.keyTerms) ? eventKeyTermResult.keyTerms : [];
  const aiHintDebug = eventKeyTermResult?.aiHintDebug || {};

  let transcriptInfo = null;
  let transcriptText = '';
  if (mediaPath) {
    const externalMediaID = toExternalMediaIDFromPath(mediaPath);
    const transcripts = await coreApiClient.listTranscripts(v2CustomerID, {
      ...STT_EN_TRANSCRIPT_IDENTITY,
      externalMediaID
    });
    const bestTranscript = selectBestTranscript(Array.isArray(transcripts) ? transcripts : transcripts?.items || []);
    if (bestTranscript) {
      transcriptInfo = {
        transcriptID: String(bestTranscript._id || ''),
        status: String(bestTranscript.status || ''),
        providerName: String(bestTranscript.providerName || ''),
        externalMediaID: String(bestTranscript.externalMediaID || ''),
        modifiedAt: String(bestTranscript.modifiedAt || bestTranscript.updatedAt || ''),
        textLength: String(bestTranscript.textOriginal || bestTranscript.fullText || '').length
      };
      transcriptText = normalizeText(bestTranscript.textOriginal || bestTranscript.fullText || '');
    }
  }

  const summaryDebug = {
    attempted: false,
    provider: '',
    isLLMUsed: false,
    failureReason: '',
    promptCharCount: 0
  };
  let summaryText = '';

  if (!args.noSummary) {
    const provider = resolveSummaryProvider(config);
    summaryDebug.provider = provider;
    summaryDebug.attempted = true;

    if (provider === 'none') {
      summaryDebug.failureReason = 'missing-api-key';
    } else {
      try {
        const prompt = buildSummaryPrompt({
          customerID: v2CustomerID,
          cdsV1EventID: args.cdsV1EventID,
          mediaPath,
          rawHintTexts,
          transcriptText,
          keyTerms,
          summaryInputChars: args.summaryInputChars,
          summaryTranscriptChars: args.summaryTranscriptChars
        });
        summaryDebug.promptCharCount = prompt.length;
        const timeoutMS = Number(config?.hintExtraction?.timeoutMS || 30000);
        summaryText = provider === 'openai'
          ? await requestSummaryFromOpenAI({ apiKey: config.openai.apiKey, timeoutMS, prompt })
          : await requestSummaryFromAnthropic({ apiKey: config.anthropic.apiKey, timeoutMS, prompt });
        summaryDebug.isLLMUsed = true;
      } catch (error) {
        summaryDebug.failureReason = String(error?.message || 'llm-call-failed');
      }
    }
  }

  const result = {
    input: {
      customerID: customerIDInput,
      cdsV1EventID: args.cdsV1EventID,
      noSummary: args.noSummary
    },
    customerContext: {
      v1CustomerID,
      v2CustomerID
    },
    eventContext: {
      mediaPath,
      rawHintTextCount: rawHintTexts.length,
      keyTermCount: keyTerms.length
    },
    keyHintExtraction: {
      provider: String(aiHintDebug.provider || ''),
      isLLMUsed: Boolean(aiHintDebug.isLLMUsed),
      failureReason: String(aiHintDebug.failureReason || ''),
      failureCode: String(aiHintDebug.failureCode || ''),
      failureMessage: String(aiHintDebug.failureMessage || ''),
      failureDetails: (aiHintDebug.failureDetails && typeof aiHintDebug.failureDetails === 'object')
        ? aiHintDebug.failureDetails
        : {},
      eventWarnings: Array.isArray(eventKeyTermResult?.eventWarnings) ? eventKeyTermResult.eventWarnings : [],
      keyTermsPreview: keyTerms.slice(0, 40)
    },
    transcriptContext: transcriptInfo,
    summaryDebug,
    summaryText
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Customer: ${v2CustomerID} (v1=${v1CustomerID})`);
  console.log(`Event: ${args.cdsV1EventID}`);
  console.log(`Media path: ${mediaPath || '<none>'}`);
  console.log(`Raw hint texts: ${rawHintTexts.length}`);
  console.log(`Key terms: ${keyTerms.length}`);
  console.log(`Hint provider: ${result.keyHintExtraction.provider || '<none>'}`);
  console.log(`Hint LLM used: ${result.keyHintExtraction.isLLMUsed}`);
  console.log(`Hint failure: ${result.keyHintExtraction.failureReason || '<none>'}`);
  console.log(`Summary provider: ${summaryDebug.provider || '<none>'}`);
  console.log(`Summary LLM used: ${summaryDebug.isLLMUsed}`);
  console.log(`Summary failure: ${summaryDebug.failureReason || '<none>'}`);
  if (summaryText) {
    console.log('\n--- Summary ---');
    console.log(summaryText);
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
