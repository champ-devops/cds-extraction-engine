# Plan: Add Hint Text / Custom Vocabulary Across All Transcript Providers

## Overview

This plan covers adding or completing "hint text" (custom vocabulary / key term boosting) support
for all three transcription providers: AssemblyAI, Deepgram, and Rev.ai.

The internal API already accepts a `keyTerms: string[]` option that flows through
`normalizeCommonTranscriptionOptions()`. AssemblyAI and Deepgram have partial implementations;
Rev.ai currently drops all key terms with a warning. This plan brings all three providers into
full compliance with their respective APIs.

**Status**: Planning
**Requested**: February 20, 2026
**Primary file**: `backend/src/services/transcriptIngestion.js`

---

## Goals

1. AssemblyAI: close the gap for non-SLAM-1 models by using `word_boost` + `boost_param` as a
   fallback instead of silently dropping key terms.
2. Deepgram: verify existing `keyterm` implementation is compliant; add per-term length validation.
3. Rev.ai: implement `custom_vocabularies` submission (currently a no-op with a warning).
4. Expose a `hintBoostParam` caller option so AssemblyAI boost intensity can be controlled.
5. All changes remain in `buildXxxProviderOptions()` + `submitToXxx()` with no schema-breaking
   changes to the public ingest API.

---

## Provider Analysis

### 1 — AssemblyAI

#### API Capabilities

| Parameter | Type | Constraint | Model Support |
|---|---|---|---|
| `keyterms_prompt` | `string[]` | Max **100 items** | `slam-1` only |
| `word_boost` | `string[]` | No documented item cap; short words/phrases recommended | Legacy models (non-SLAM-1) |
| `boost_param` | `"low" \| "default" \| "high" \| null` | Controls boost intensity | Same legacy models |

- **`keyterms_prompt`**: Submitted in the POST `/v2/transcript` JSON body. Used by the `slam-1`
  (SLAM) model to guide its language model toward expected terms.
- **`word_boost`**: Submitted in the same JSON body. Used by AssemblyAI's older/standard speech
  models. `boost_param` controls the confidence weight applied.

Reference: AssemblyAI transcript submit API (`POST /v2/transcript`), `word_boost` and
`boost_param` are echoed back in transcript response objects (confirmed in `docs/shtn_1137_assemblyai.json`).

#### Current State

```
buildAssemblyAIProviderOptions()  — transcriptIngestion.js:1493
```

- `slam-1` + `keyTerms` → sets `keyterms_prompt` ✅
- non-SLAM-1 + `keyTerms` → emits `ASSEMBLYAI_KEY_TERMS_UNSUPPORTED_FOR_MODEL` and drops terms ❌

#### Compliance Gaps

1. When model ≠ `slam-1` and `keyTerms` are provided, the terms are lost. The correct behavior
   is to fall back to `word_boost` + `boost_param` for those models.
2. There is no way for callers to control `boost_param` intensity (low / default / high).

#### Required Changes

**`normalizeCommonTranscriptionOptions()`**:
- Accept new optional `hintBoostParam` field (`"low" | "default" | "high"`).
- Validate against the three allowed values; ignore (with warning) if unrecognized.

**`buildAssemblyAIProviderOptions()`**:
- When model starts with `slam-1`: use existing `keyterms_prompt` path (no change).
- When model is anything else and `keyTerms` provided: populate `word_boost` instead of warning
  and dropping. Populate `boost_param` from normalized `hintBoostParam` if provided.
- Retire warning `ASSEMBLYAI_KEY_TERMS_UNSUPPORTED_FOR_MODEL`; replace with
  `ASSEMBLYAI_KEY_TERMS_USING_WORD_BOOST_FALLBACK` (informational, not an error) when the
  fallback path is taken.
- Retain `ASSEMBLYAI_KEY_TERMS_TRUNCATED_TO_100` for SLAM-1 path.

**New warning codes**:

| Code | Condition |
|---|---|
| `ASSEMBLYAI_KEY_TERMS_USING_WORD_BOOST_FALLBACK` | `keyTerms` provided with a non-SLAM-1 model; `word_boost` used instead of `keyterms_prompt` |
| `ASSEMBLYAI_INVALID_HINT_BOOST_PARAM` | `hintBoostParam` provided but not one of `low`, `default`, `high` |

**No submission changes** needed — `word_boost` and `boost_param` are plain JSON body fields,
already serialized by the existing `JSON.stringify(transcriptPayload)` in `submitToAssemblyAI()`.

---

### 2 — Deepgram

#### API Capabilities

| Parameter | Type | Constraint | Model Support |
|---|---|---|---|
| `keyterm` | Repeated string query param | Max **100 items**; short terms preferred | `nova-3`, `flux` (and variants) |
| `keywords` | `word:float` repeated query param | **Deprecated** | `nova-2` and older |

- `keyterm` (Keyterm Prompting): The current, recommended mechanism. Sent as repeated query
  params: `?keyterm=term1&keyterm=term2`. No intensifier syntax.
- `keywords` (legacy): Deprecated `word:intensifier` syntax. Not needed; do not implement.

Reference: Deepgram Keyterm Prompting docs; confirmed in codebase at `transcriptIngestion.js:1667`.

#### Current State

```
buildDeepGramProviderOptions()  — transcriptIngestion.js:1544
submitToDeepGram()              — transcriptIngestion.js:1658
```

- `nova-3`/`flux` + `keyTerms` → appends `keyterm=` query params ✅
- Other models + `keyTerms` → emits `DEEPGRAM_KEY_TERMS_UNSUPPORTED_FOR_MODEL` ✅
- Truncates to 100 with `DEEPGRAM_KEY_TERMS_TRUNCATED_TO_100` ✅

#### Compliance Gaps

1. No per-term character length validation. Deepgram does not publish an explicit character limit
   per term, but excessively long strings (multi-sentence phrases) may be rejected or ignored.
   Industry norm and Deepgram guidance: keep terms to single words or short phrases (< ~100 chars).
2. No validation that `nova-3` model variants (e.g., `nova-3-medical`) are correctly recognized.
   Current check: `normalizedModel.startsWith('nova-3')` — this handles variants correctly ✅.

#### Required Changes

**`buildDeepGramProviderOptions()`**:
- After deduplication and before the 100-item cap, filter out any term exceeding **100 characters**
  and emit a new warning `DEEPGRAM_KEY_TERM_TOO_LONG` (listing the count of filtered terms).
- This is a conservative limit; if Deepgram publishes a different limit, update accordingly.

**New warning codes**:

| Code | Condition |
|---|---|
| `DEEPGRAM_KEY_TERMS_TOO_LONG_FILTERED` | One or more terms exceeded 100 chars and were removed |

No submission changes needed — terms are already appended in `submitToDeepGram()`.

---

### 3 — Rev.ai

#### API Capabilities

**Inline `custom_vocabularies`** (per-job, no pre-registration required):

```json
{
  "custom_vocabularies": [
    { "phrases": ["Councilmember Nguyen", "CEQA", "EIR", "Prop 47"] }
  ]
}
```

| Attribute | Constraint |
|---|---|
| Structure | Array of objects, each with a `phrases` string array |
| Max objects per job (inline) | 50 |
| Max chars per phrase | **255** |
| Max phrases | Not capped per object; pre-created vocab allows 1,000 total |
| Format | Plain text only — no phonetic spellings, no regex |
| Case | Supply in expected transcription casing; matching is case-insensitive |

**Pre-created `custom_vocabulary_id`** (out of scope for this plan): A separate Custom Vocabulary
resource created via `POST /speechtotext/v1/vocabularies` and referenced by UUID. This is better
suited for long-lived, domain-specific vocabulary reuse and should be addressed in a separate plan.

**Note on submission format**: Rev.ai job submission accepts both `multipart/form-data` (used when
uploading a file) and `application/json` (used when providing a `source_config` URL). Since
`submitToRevAI()` uploads a local audio file and must use `multipart/form-data`, the
`custom_vocabularies` JSON object must be serialized as a JSON string and appended to the form
as a named field.

Reference: Rev.ai Asynchronous Speech-to-Text API, job submission parameters.

#### Current State

```
buildRevAIProviderOptions()  — transcriptIngestion.js:1576
submitToRevAI()              — transcriptIngestion.js:1701
```

- `keyTerms` → emits `REVAI_IGNORED_KEY_TERMS` and drops all terms ❌
- Submission: `multipart/form-data` with simple string fields via `FormData.append(key, String(value))`

#### Compliance Gaps

1. Key terms are completely ignored. Rev.ai's inline `custom_vocabularies` is the direct equivalent
   and should be used.
2. The current `FormData` loop (`Object.entries(providerOptions.payload).forEach(...)`) serializes
   everything as a flat string — unsuitable for the nested `custom_vocabularies` object.

#### Required Changes

**`buildRevAIProviderOptions()`**:
- When `keyTerms` are present:
  - Filter out any phrase exceeding 255 characters; emit `REVAI_KEY_TERM_PHRASE_TOO_LONG_FILTERED`
    with a count.
  - Package remaining terms as a single inline object:
    `customVocabularies = [{ phrases: filteredKeyTerms }]`
  - Remove `REVAI_IGNORED_KEY_TERMS` warning when terms are actually submitted.
- Return `customVocabularies` separately from `payload` (parallel to how Deepgram returns
  `keyTerms` separately from `queryParams`).

**`submitToRevAI()`**:
- After the existing `Object.entries(providerOptions.payload).forEach(...)` loop:
  - If `providerOptions.customVocabularies` is non-empty:
    ```js
    formData.append('custom_vocabularies', JSON.stringify(providerOptions.customVocabularies));
    ```
  - This follows the multipart pattern Rev.ai uses for complex JSON fields.

**New warning codes**:

| Code | Condition |
|---|---|
| `REVAI_KEY_TERM_PHRASE_TOO_LONG_FILTERED` | One or more terms exceeded 255 chars and were removed |

**Retained warning**:

| Code | Condition | Change |
|---|---|---|
| `REVAI_IGNORED_KEY_TERMS` | No change in meaning — keep for edge case where all terms were filtered | Only emitted when filtered list is empty after length check |

---

## Changes to `normalizeCommonTranscriptionOptions()`

Add one new normalized field:

| Internal field | Type | Allowed values | Default | Purpose |
|---|---|---|---|---|
| `hintBoostParam` | `string \| undefined` | `"low"`, `"default"`, `"high"` | `undefined` | AssemblyAI `boost_param` for `word_boost` path |

This field passes through unchanged to `buildAssemblyAIProviderOptions()` and is ignored by
Deepgram and Rev.ai builders.

---

## Public API Changes

The `POST /ingest/transcribe-media` request body already accepts `options.keyTerms`. This plan
adds one new option field:

| Field | Type | Providers | Notes |
|---|---|---|---|
| `options.hintBoostParam` | `string` (optional) | AssemblyAI (non-SLAM-1 only) | `"low"`, `"default"`, or `"high"`. Ignored by Deepgram and Rev.ai. No schema change needed if treated as passthrough `string`; add to Joi schema description for documentation. |

---

## Implementation Tasks

### 1. `normalizeCommonTranscriptionOptions()`
- [ ] Accept and validate `options.hintBoostParam`
- [ ] Include `hintBoostParam` in the returned normalized object

### 2. AssemblyAI (`buildAssemblyAIProviderOptions()`)
- [ ] When model ≠ `slam-1` and `keyTerms` are provided: populate `word_boost` array
- [ ] When `hintBoostParam` is present: populate `boost_param` field
- [ ] Replace `ASSEMBLYAI_KEY_TERMS_UNSUPPORTED_FOR_MODEL` with
  `ASSEMBLYAI_KEY_TERMS_USING_WORD_BOOST_FALLBACK`
- [ ] Add `ASSEMBLYAI_INVALID_HINT_BOOST_PARAM` warning for unrecognized `hintBoostParam` values
- [ ] Update tests in `backend/tests/services.transcriptIngestion.test.js`

### 3. Deepgram (`buildDeepGramProviderOptions()`)
- [ ] Add per-term length filter (100-char limit)
- [ ] Emit `DEEPGRAM_KEY_TERMS_TOO_LONG_FILTERED` when terms are removed
- [ ] Update tests in `backend/tests/services.transcriptIngestion.test.js`

### 4. Rev.ai (`buildRevAIProviderOptions()` + `submitToRevAI()`)
- [ ] Add per-phrase length filter (255-char limit)
- [ ] Package filtered terms into `customVocabularies: [{ phrases: [...] }]` return value
- [ ] Emit `REVAI_KEY_TERM_PHRASE_TOO_LONG_FILTERED` when phrases are removed
- [ ] Only emit `REVAI_IGNORED_KEY_TERMS` when all terms were filtered out (empty result)
- [ ] In `submitToRevAI()`: append `custom_vocabularies` as JSON-serialized form field
- [ ] Update tests in `backend/tests/services.transcriptIngestion.test.js`

### 5. Route schema (`backend/src/routes/ingest.js`)
- [ ] Add `hintBoostParam` to the `transcribe-media` options Joi schema with allowed values
  and description

### 6. Tests
- [ ] AssemblyAI: SLAM-1 path (existing behavior, no regression)
- [ ] AssemblyAI: non-SLAM-1 + `keyTerms` → `word_boost` populated, warning emitted
- [ ] AssemblyAI: non-SLAM-1 + `keyTerms` + `hintBoostParam` → `boost_param` populated
- [ ] AssemblyAI: invalid `hintBoostParam` → warning, field omitted
- [ ] Deepgram: terms under 100 chars pass through
- [ ] Deepgram: terms over 100 chars filtered + warning emitted
- [ ] Rev.ai: `keyTerms` → `custom_vocabularies` built correctly
- [ ] Rev.ai: phrase over 255 chars filtered + warning emitted
- [ ] Rev.ai: all phrases too long → `REVAI_IGNORED_KEY_TERMS` emitted, no `custom_vocabularies`
- [ ] Rev.ai: `submitToRevAI()` appends `custom_vocabularies` JSON string to FormData

---

## Validation Plan

1. **Unit**: All `buildXxxProviderOptions()` functions tested for key term paths with:
   - Empty `keyTerms` (no hint fields sent, no warnings)
   - Valid `keyTerms` within limits
   - `keyTerms` exceeding item count limits (truncation warnings)
   - `keyTerms` with phrases exceeding character limits (filtered warnings)
2. **Integration smoke**: Submit a test job to each provider (staging credentials) with known
   hint terms and verify the terms influence the transcript output.
3. **No regression**: Existing tests for diarization, punctuation, speaker count options, and
   provider warnings must continue to pass.

---

## Risks and Mitigations

- **Risk**: Rev.ai may not accept `custom_vocabularies` as a plain JSON-string form field in
  `multipart/form-data`.
  - **Mitigation**: Confirm with a test against the Rev.ai sandbox. If rejected, switch the job
    submission to `application/json` (with `source_config.url` instead of file upload) when
    vocabulary is present, or pre-upload the audio file and submit the job via JSON body.

- **Risk**: AssemblyAI `word_boost` behaviour differs significantly by model version; some models
  may still ignore it.
  - **Mitigation**: Treat as best-effort (informational warning, not an error). Document that
    SLAM-1 is the preferred model for reliable key term support.

- **Risk**: The 100-char per-term limit for Deepgram is inferred from guidance, not a documented
  hard limit. Long terms may work or may be silently ignored by the API.
  - **Mitigation**: Apply the filter conservatively. If the actual limit is confirmed to be
    different, update the constant without a behavioral change.

---

## Acceptance Criteria

1. All three `buildXxxProviderOptions()` functions return vocabulary hint fields when `keyTerms`
   are provided, subject to their respective model compatibility checks.
2. Rev.ai submission includes `custom_vocabularies` in the form data when `keyTerms` are present.
3. AssemblyAI non-SLAM-1 path uses `word_boost`/`boost_param` instead of silently dropping terms.
4. All character/item limit violations produce named warning codes rather than silent truncation
   or silent drop.
5. All new and modified paths are covered by unit tests.
6. No existing tests regress.
