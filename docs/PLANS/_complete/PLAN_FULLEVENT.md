# Plan: Full Event Data Extraction for Media Resolution and Transcription Hinting

## Overview

When a producer submits a transcription request, they can now supply a `cdsV1EventID` (the
CustomerAPI `customerEventID` integer) instead of—or in addition to—explicit media identifiers and
key terms. This plan covers:

1. **Fetching** the full event payload from the CustomerAPI.
2. **Extracting** the primary video/audio media ID and path for use in the transcription job.
3. **Collecting** raw hint texts from agenda items, timeline items, and attachment file names.
4. **Extracting proper nouns** from the raw texts using a configurable LLM provider (Anthropic
   Claude Haiku or OpenAI GPT-4o mini), with a regex heuristic fallback when no LLM is configured.
5. **Merging** the extracted terms with any caller-supplied `keyTerms` through the existing
   normalization pipeline.

### Queue Producer Example (Provider + AI Key Terms)

If you publish directly to the CDS job queue (`scope: transcript:transcribe:media`), provider
selection is controlled by `payload.provider`, and key-term hinting is controlled by
`payload.options.keyTerms`.

To enable AI extraction from full-event content, you must provide both:
- `payload.cdsV1EventID`
- `payload.options.useAIKeyHintExtraction: true`

```json
{
  "scope": "transcript:transcribe:media",
  "payload": {
    "customerID": 6,
    "cdsV1EventID": 1175,
    "provider": "ASSEMBLYAI",
    "options": {
      "useAIKeyHintExtraction": true,
      "keyTerms": [
        "Resolution 25-267",
        "OHM Advisors",
        "Copper Ridge Phase 6"
      ],
      "isDiarizationEnabled": true,
      "punctuate": true,
      "languageCode": "en",
      "silenceNoiseDB": -35,
      "silenceMinSecs": 60,
      "isChunkingEnabled": true,
      "maxSegmentCount": 12
    }
  },
  "timeoutSeconds": 7200
}
```

Important behavior:
- With `cdsV1EventID` + `options.useAIKeyHintExtraction: true`, event-derived key terms are
  extracted and merged with caller-provided `options.keyTerms` (caller terms are additive).
- `payload.provider` still selects the transcription provider (`ASSEMBLYAI`, `DEEPGRAM`, `REVAI`).
- If `useAIKeyHintExtraction` is missing/false, `cdsV1EventID` still resolves primary media, but
  AI key-term extraction/merge is skipped.

**Status**: Planning
**Requested**: 2026-02-21
**Primary files affected**:
- `backend/src/services/customerApiData.js` — new CustomerAPI event fetch method
- `backend/src/services/eventHints.js` — new service (extraction + proper-noun filtering)
- `backend/src/routes/ingest.js` — `POST /ingest/transcribe-media` schema + handler update
- `backend/src/config/appConfig.js` — optional LLM provider config sections (`ANTHROPIC`, `OPENAI`, `HINT_EXTRACTION`)

---

## Source Data Reference

The full CustomerAPI event response shape is documented in
`docs/customerAPI.fullEventByEventID.json`. Key sections:

| Section | Relevant filter | Hint source |
|---|---|---|
| `media[]` | `mediaClassID === 4 && mediaTypeID === 1 && deletedDateTimeUTC === null` | Primary video/audio file — extract `customerMediaID` + `mediaPath` |
| `media[]` | `mediaClassID === 2 && mediaTypeID === 1 && deletedDateTimeUTC === null` | Attachment documents — extract `mediaNickName` as raw hint text |
| `agenda[]` | `title` non-empty string | Agenda item — extract `title` as raw hint text |
| `timeline[]` | `externalID === '' && title` non-empty string | Manually-entered timeline marker — extract `title` as raw hint text |

**Notes on the sample data:**
- All 31 timeline items in the sample carry a `VOTING_ACTIVITY_IMPORT::*` `externalID` and empty
  `title`. The empty-externalID + non-empty-title filter is correct for the general case; the
  sample happens to produce zero matches.
- 35 agenda items, all with non-empty `title`.
- 55 attachment media items (`mediaClassID=2`), all with `mediaNickName` values that contain
  useful proper nouns (resolution numbers, organization names, place names, development names).

---

## Architecture

### New CustomerAPI Method

**File**: `backend/src/services/customerApiData.js`

```js
export async function getFullEventByV1EventID(v1CustomerID, cdsV1EventID, deps = {})
```

- Validates both params as positive integers.
- Calls `GET /event/fullEventByEventID/{cdsV1EventID}?customerID={v1CustomerID}` via the existing
  `CustomerApiClient.requestGet()`.
- Returns the raw full-event object or `null` if the response is missing/invalid.
- Throws a wrapped error (consistent with existing `customerApiData.js` patterns) on HTTP failure.

> **Note**: Confirm the exact CustomerAPI endpoint path against
> `@champds/customerapi-client` documentation or a live call before implementing. The path
> `/event/fullEventByEventID/{id}` is inferred from the sample filename; adjust if different.

---

### New Service: `backend/src/services/eventHints.js`

Three pure extraction functions plus one orchestrating function.

#### `extractPrimaryMediaFromFullEvent(fullEvent)`

```
Input:  full event object
Output: { customerMediaID: number, mediaPath: string } | null
```

- Filters `fullEvent.media[]` where `mediaClassID === 4 && mediaTypeID === 1 && deletedDateTimeUTC === null`.
- If multiple matches, takes the first (highest priority is left to future ordering rules).
- Builds `mediaPath` using the existing `buildMediaPathFromV1Media(mediaItem)` from
  `customerApiData.js` — returns `"${mediaFileLocation}/${mediaFileName}"`.
- Returns `null` if no match found.

#### `extractRawHintTextsFromFullEvent(fullEvent)`

```
Input:  full event object
Output: string[]  (raw, unfiltered text values)
```

Collects from three sources in order:

1. **Timeline items**: `fullEvent.timeline[]` where `externalID === '' && title` non-empty.
   → Pushes `item.title`.

2. **Agenda items**: `fullEvent.agenda[]` where `title` non-empty.
   → Pushes `item.title`.

3. **Attachment media**: `fullEvent.media[]` where `mediaClassID === 2 && mediaTypeID === 1 &&
   deletedDateTimeUTC === null && mediaNickName` non-empty.
   → Pushes `item.mediaNickName`.

Returns a deduplicated array of non-empty strings after trimming each value.

#### `extractProperNounsFromTexts(rawTexts, deps = {})`

```
Input:  string[]  (raw hint texts, e.g. agenda titles, file names)
Output: Promise<string[]>  (short proper-noun phrases suitable for provider hint APIs)
```

Delegates to a **configured LLM provider** (Anthropic or OpenAI) or a **heuristic fallback**.
Provider selection is resolved at call time from `config.hintExtraction` (see Config section).

##### Shared prompt (both LLM providers)

```
System: You are a proper-noun extractor for government meeting transcription.
        You return ONLY a JSON array of strings. No other output.

User:   Extract all relevant proper nouns from the following government meeting content.
        Include: people names, organization names, place names, development project names,
        and legislative identifiers (e.g. "Resolution 25-267", "RZN 1888-2025").
        Exclude: common words, generic titles, verbs, adjectives.
        Each entry must be 1-6 words, under 100 characters.
        Return a JSON array of strings only.

        ---
        {joined raw texts, one per line}
```

##### Anthropic path

- Endpoint: `POST https://api.anthropic.com/v1/messages` (Node 22 native `fetch`; no SDK required).
- Model: `claude-haiku-4-5-20251001`.
- Auth header: `x-api-key: {config.anthropic.apiKey}`, `anthropic-version: 2023-06-01`.
- Request body:
  ```json
  {
    "model": "claude-haiku-4-5-20251001",
    "max_tokens": 1024,
    "system": "<system prompt>",
    "messages": [{ "role": "user", "content": "<user prompt>" }]
  }
  ```
- Parse result from `response.content[0].text`.

##### OpenAI path

- Endpoint: `POST https://api.openai.com/v1/chat/completions` (Node 22 native `fetch`; no SDK required).
- Model: `gpt-4o-mini`.
- Auth header: `Authorization: Bearer {config.openai.apiKey}`.
- Request body:
  ```json
  {
    "model": "gpt-4o-mini",
    "max_tokens": 1024,
    "messages": [
      { "role": "system", "content": "<system prompt>" },
      { "role": "user",   "content": "<user prompt>" }
    ]
  }
  ```
- Parse result from `response.choices[0].message.content`.

##### Provider selection logic

Resolved once per call from config (no runtime switching):

```
if config.hintExtraction.provider === 'anthropic'  → use Anthropic path
if config.hintExtraction.provider === 'openai'      → use OpenAI path
if config.hintExtraction.provider === 'heuristic'   → skip LLM, go straight to heuristic
if config.hintExtraction.provider is absent/invalid → auto-detect:
    if config.anthropic.apiKey present  → use Anthropic path
    else if config.openai.apiKey present → use OpenAI path
    else                                → use heuristic fallback (no warning)
```

##### Error handling (both LLM paths)

- If the HTTP call fails, times out, or returns a non-2xx status: emit
  `EVENT_HINTS_PROPER_NOUN_EXTRACTION_FAILED` and fall back to heuristic.
- If the response body cannot be parsed as a non-empty JSON string array: same fallback + warning.
- Use `AbortController` with a configurable timeout to bound request latency.
- Cap LLM input before submission:
  - max **300 raw text rows**
  - max **15,000 combined characters** after join
- Cap the output at **150 items** before returning; per-provider limits are enforced downstream
  by the existing `buildXxxProviderOptions()` functions.

##### Heuristic fallback (no LLM configured, or LLM failure)

- Tokenize each raw text string by whitespace and common delimiters (` `, `,`, `;`, `_`, `(`, `)`, `.`).
- Keep tokens where the first character is an uppercase letter A–Z and length ≥ 2.
- Exclude a small stop-word set of common capitalized words that are not proper nouns:
  `["The", "A", "An", "To", "For", "Of", "And", "Or", "In", "On", "At", "By", "From",
    "With", "That", "This", "These", "Those", "Is", "Are", "Was", "Be", "Has", "Have",
    "Will", "Shall", "Consider", "Approve", "Amend", "Authorize", "Discussion", "Report",
    "Meeting", "Minutes", "Agenda", "Staff", "City", "Public", "Board"]`.
- Return unique tokens/phrases, capped at 150.

#### `buildEventKeyTerms(v1CustomerID, cdsV1EventID, deps = {})`

```
Input:  v1CustomerID (number), cdsV1EventID (number), deps (injectable clients)
Output: Promise<{
  customerMediaID: number | null,
  mediaPath: string | null,
  keyTerms: string[],
  eventWarnings: string[]
}>
```

Orchestrates the full flow:
1. Call `getFullEventByV1EventID(v1CustomerID, cdsV1EventID, deps)`.
2. If the event is not found: return `{ customerMediaID: null, mediaPath: null, keyTerms: [],
   eventWarnings: ['EVENT_HINTS_EVENT_NOT_FOUND'] }`.
3. Call `extractPrimaryMediaFromFullEvent(fullEvent)` → capture `customerMediaID` / `mediaPath`.
   If null: add warning `EVENT_HINTS_PRIMARY_MEDIA_NOT_FOUND` to `eventWarnings`.
4. Call `extractRawHintTextsFromFullEvent(fullEvent)` → raw texts.
5. Call `extractProperNounsFromTexts(rawTexts, deps)` → key terms (handles its own fallback/warning).
6. Return the assembled result object.

---

### Route Changes: `POST /ingest/transcribe-media`

**File**: `backend/src/routes/ingest.js`

#### Schema additions (request body)

Add `cdsV1EventID` to the existing body schema:

```js
cdsV1EventID: {
  type: 'number',
  description: 'CustomerAPI v1 event ID. When provided, the full event is fetched to resolve ' +
               'primary media (if no explicit media ID is given) and to augment keyTerms with ' +
               'event-derived proper nouns.'
}
```

`cdsV1EventID` is optional. Existing fields (`mediaID`, `externalMediaID`, `mediaPath`,
`options.keyTerms`) are unchanged.

#### Handler logic additions

After destructuring the request body, add a pre-processing block:

```
if cdsV1EventID is present:
  1. Resolve legacy/v1 customer context from v2 customerID using
     lookupLegacyCustomerIDByV2CustomerID() (already available in customerApiData.js)
  2. Call buildEventKeyTerms(v1CustomerID, cdsV1EventID)
  3. If no mediaID / externalMediaID / mediaPath was supplied and mediaPath from event is non-null:
       set mediaPath = event mediaPath  (derived from customerMediaID + buildMediaPathFromV1Media)
  4. Merge event keyTerms into options.keyTerms:
       options.keyTerms = [...new Set([...(options.keyTerms || []), ...eventKeyTerms])]
  5. Propagate any EVENT_HINTS_* warnings into the result's details.optionWarnings
```

The resolved `mediaPath` feeds into the existing `submitMediaForTranscription()` call unchanged.
No changes to `transcriptIngestion.js` are required for the media path flow.

Validation guard update in route handler:

```
if !mediaID && !externalMediaID && !mediaPath:
  if cdsV1EventID is absent:
    return 400 "One of mediaID, externalMediaID, mediaPath, or cdsV1EventID is required"
  if cdsV1EventID is present but event-derived mediaPath is null:
    return 400 with EVENT_HINTS_PRIMARY_MEDIA_NOT_FOUND context
```

---

### Config: LLM Provider Keys

**File**: `backend/src/config/appConfig.js`

Add three optional sections:

```json
{
  "ANTHROPIC": {
    "API_KEY": "sk-ant-..."
  },
  "OPENAI": {
    "API_KEY": "sk-..."
  },
  "HINT_EXTRACTION": {
    "PROVIDER": "anthropic",
    "TIMEOUT_MS": 6000
  }
}
```

| Key | Type | Values | Notes |
|---|---|---|---|
| `ANTHROPIC.API_KEY` | string | Anthropic secret key | Required when `HINT_EXTRACTION.PROVIDER` is `"anthropic"` or auto-detect finds it first |
| `OPENAI.API_KEY` | string | OpenAI secret key | Required when `HINT_EXTRACTION.PROVIDER` is `"openai"` |
| `HINT_EXTRACTION.PROVIDER` | string | `"anthropic"` \| `"openai"` \| `"heuristic"` | Optional. Omit to auto-detect from which key is present (Anthropic preferred) |
| `HINT_EXTRACTION.TIMEOUT_MS` | number | positive integer | Optional. Timeout for outbound LLM calls |

- **All sections are optional.** Missing keys cause graceful degradation to the heuristic fallback,
  never a startup failure.
- If `HINT_EXTRACTION.PROVIDER` names a provider whose API key is absent, the function emits
  `EVENT_HINTS_PROPER_NOUN_EXTRACTION_FAILED` and falls back to heuristic.
- `appConfig.js` parse behavior:
  - Accept optional root objects `ANTHROPIC`, `OPENAI`, `HINT_EXTRACTION`.
  - Normalize to runtime keys:
    - `config.anthropic.apiKey`
    - `config.openai.apiKey`
    - `config.hintExtraction.provider`
    - `config.hintExtraction.timeoutMS`
  - Do not search aliases; only consume canonical SCREAMING_SNAKE_CASE input keys.

---

## Warning Codes

| Code | Condition |
|---|---|
| `EVENT_HINTS_EVENT_NOT_FOUND` | CustomerAPI returned no event for the supplied `cdsV1EventID` |
| `EVENT_HINTS_PRIMARY_MEDIA_NOT_FOUND` | No `mediaClassID=4 / mediaTypeID=1` non-deleted media item found in event |
| `EVENT_HINTS_PROPER_NOUN_EXTRACTION_FAILED` | LLM call failed or response was unparseable; heuristic fallback used |

Warnings are returned in `result.details.optionWarnings[]` alongside any existing provider
warnings (AssemblyAI, Deepgram, Rev.ai).

---

## Normalization Flow (end-to-end)

```
Caller payload:
  keyTerms: ["Spring Hill Water", "BOMA"]       ← already proper nouns
  cdsV1EventID: 1175

Event-derived (after LLM extraction from 35 agenda titles + 55 attachment names):
  ["Resolution 25-267", "Water and Sewer Division", "Police Department Headquarters",
   "Copper Ridge Phase 6", "Summer Meadows", "Eastport Farms", "OHM Advisors",
   "Dara Sanders", "Carter Napier", "Dan Allen", ...]

Merged (Set union, caller terms preserved):
  ["Spring Hill Water", "BOMA", "Resolution 25-267", "Water and Sewer Division", ...]

Existing normalizeCommonTranscriptionOptions():
  → trim, filter empty, deduplicate
  → pass to buildXxxProviderOptions() for per-provider limit enforcement
    (100-item cap, 100-char/255-char per-term limits, etc.)
```

The merged terms enter `normalizeCommonTranscriptionOptions()` through `options.keyTerms` exactly
as if the caller had typed them manually — no additional normalization path needed.

---

## New Files

| File | Purpose |
|---|---|
| `backend/src/services/eventHints.js` | `extractPrimaryMediaFromFullEvent`, `extractRawHintTextsFromFullEvent`, `extractProperNounsFromTexts`, `buildEventKeyTerms` |

## Modified Files

| File | Change |
|---|---|
| `backend/src/services/customerApiData.js` | Add `getFullEventByV1EventID(v1CustomerID, cdsV1EventID, deps)` |
| `backend/src/routes/ingest.js` | Add `cdsV1EventID` to `POST /ingest/transcribe-media` schema + handler pre-processing |
| `backend/src/config/appConfig.js` | Add optional `ANTHROPIC`, `OPENAI`, and `HINT_EXTRACTION` input sections; normalize to runtime keys |

---

## Implementation Tasks

### 1. CustomerAPI method
- [ ] Add `getFullEventByV1EventID(v1CustomerID, cdsV1EventID, deps)` to `customerApiData.js`
- [ ] Validate positive integer inputs (same pattern as existing methods)
- [ ] Confirm the actual CustomerAPI endpoint path before implementing

### 2. `eventHints.js` — extraction functions
- [ ] Implement `extractPrimaryMediaFromFullEvent(fullEvent)`
- [ ] Implement `extractRawHintTextsFromFullEvent(fullEvent)` (three-source collection)
- [ ] Implement `extractProperNounsFromTexts(rawTexts, deps)`:
  - [ ] Provider selection logic (explicit config → auto-detect → heuristic)
  - [ ] Anthropic path (native `fetch`, parse `content[0].text`)
  - [ ] OpenAI path (native `fetch`, parse `choices[0].message.content`)
  - [ ] Shared JSON parse + array validation + 150-item cap
  - [ ] Heuristic fallback (tokenization + stop-word filter)
- [ ] Implement `buildEventKeyTerms(v1CustomerID, cdsV1EventID, deps)` orchestrator

### 3. Config
- [ ] Add optional `ANTHROPIC`, `OPENAI`, and `HINT_EXTRACTION` section parsing in `appConfig.js`
- [ ] Normalize parsed values into:
  - [ ] `config.anthropic.apiKey`
  - [ ] `config.openai.apiKey`
  - [ ] `config.hintExtraction.provider`
  - [ ] `config.hintExtraction.timeoutMS`
- [ ] No startup failure if any or all are absent

### 4. Route: `POST /ingest/transcribe-media`
- [ ] Add `cdsV1EventID` to body schema with description
- [ ] Add pre-processing block in handler: event fetch → media resolution → keyTerms merge
- [ ] Update missing-media guard to allow `cdsV1EventID` as valid resolver input
- [ ] Return explicit 400 when `cdsV1EventID` is provided but event primary media is missing

### 5. Tests (`backend/tests/`)
- [ ] `services.eventHints.test.js` — new test file
  - [ ] `extractPrimaryMediaFromFullEvent`: mediaClassID=4 found, multiple found (takes first),
        none found (returns null), deleted item excluded
  - [ ] `extractRawHintTextsFromFullEvent`: collects agenda titles, skips empty titles,
        collects timeline titles only when externalID is empty, collects attachment nickNames,
        skips deleted attachments, deduplicates
  - [ ] `extractProperNounsFromTexts`:
    - [ ] Anthropic path (mock fetch): valid response parsed correctly
    - [ ] OpenAI path (mock fetch): valid response parsed correctly
    - [ ] Explicit provider config selects correct path
    - [ ] Auto-detect: Anthropic key present → Anthropic path
    - [ ] Auto-detect: only OpenAI key present → OpenAI path
    - [ ] Auto-detect: neither key present → heuristic (no warning)
    - [ ] Configured provider key absent → `EVENT_HINTS_PROPER_NOUN_EXTRACTION_FAILED` + heuristic
    - [ ] LLM HTTP failure → `EVENT_HINTS_PROPER_NOUN_EXTRACTION_FAILED` + heuristic
    - [ ] Non-array LLM response → `EVENT_HINTS_PROPER_NOUN_EXTRACTION_FAILED` + heuristic
    - [ ] Heuristic stop-word exclusion
    - [ ] Output capped at 150
  - [ ] `buildEventKeyTerms`: event not found → warning, primary media extracted, key terms built
- [ ] `services.customerApiData.test.js` — add `getFullEventByV1EventID` cases
  - [ ] Valid response returns event object
  - [ ] Non-2xx throws wrapped error
  - [ ] Invalid inputs (non-positive integers) throw
- [ ] `routes.ingest.transcribeMedia.test.js` — extend route tests
  - [ ] `cdsV1EventID`-only request resolves media path and submits transcription
  - [ ] `cdsV1EventID` absent and no media fields still returns the existing 400 path
  - [ ] `cdsV1EventID` provided but no primary media path returns 400 with `EVENT_HINTS_PRIMARY_MEDIA_NOT_FOUND`
  - [ ] Event warnings are surfaced in `details.optionWarnings[]`

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| CustomerAPI endpoint path differs from inferred name | High | Confirm path against client package or live call before implementing; plan uses placeholder |
| LLM extraction returns non-JSON or hallucinated content | Medium | Strict JSON parse + array type check; heuristic fallback on any failure |
| LLM extraction call adds latency to the `transcribe-media` request | Medium | Enforce timeout (`HINT_EXTRACTION.TIMEOUT_MS`) + input caps; fallback to heuristic |
| Neither LLM API key configured in an environment | Low | Feature degrades gracefully to heuristic; no startup failure, no warning |
| Configured provider's key is absent at runtime | Low | `EVENT_HINTS_PROPER_NOUN_EXTRACTION_FAILED` emitted; heuristic fallback used |
| Both Anthropic and OpenAI keys present with no explicit provider config | Low | Auto-detect prefers Anthropic; document this tie-break in code comments |
| Event contains very large number of agenda/attachment items | Low | Enforce pre-LLM row + character caps; output remains capped at 150 with downstream provider limits |
| Multiple `mediaClassID=4` media items for one event | Low | Take first non-deleted match; emit no warning (ambiguity is acceptable for now) |

---

## Acceptance Criteria

1. `POST /ingest/transcribe-media` with only `cdsV1EventID` (no `mediaID`/`externalMediaID`/
   `mediaPath`) resolves the primary video media path from the CustomerAPI and proceeds normally.
2. `options.keyTerms` in the same request are merged with event-derived proper nouns; duplicates
   are removed; the merged list passes through existing provider-specific normalization unchanged.
3. When `cdsV1EventID` is absent the route behaves exactly as before — no regression.
4. All `EVENT_HINTS_*` warning codes surface in the response `details.optionWarnings[]`.
5. The heuristic fallback produces a non-empty key term list from the sample event data when
   no LLM API key is configured.
6. Both the Anthropic path and the OpenAI path are exercised by unit tests with mocked `fetch`
   responses; switching `config.hintExtraction.provider` selects the correct path.
7. All new functions have unit test coverage using the sample JSON as fixture data.
8. `cdsV1EventID`-only requests pass route validation, and missing-primary-media cases return
   deterministic `400` responses with `EVENT_HINTS_PRIMARY_MEDIA_NOT_FOUND`.
