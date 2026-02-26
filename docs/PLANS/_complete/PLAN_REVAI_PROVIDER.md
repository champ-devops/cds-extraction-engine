# Plan: Add `REVAI` Transcription Provider (Asynchronous API)

## Overview

Add Rev.ai as a first-class transcription provider for media ingestion, polling, parsing, and transcript finalization.

This plan targets the existing ingestion flow used by AssemblyAI/DeepGram and adds `REVAI` with minimal disruption.

**Status**: Planning  
**Requested**: February 20, 2026  
**Reference Docs**: https://docs.rev.ai/api/asynchronous/

---

## Goals

1. Support `provider: "REVAI"` in ingest APIs and internal provider enums.
2. Submit AAC media to Rev.ai asynchronous jobs endpoint.
3. Poll Rev.ai job status until completion/failure.
4. Fetch Rev.ai transcript JSON and parse into normalized utterances.
5. Persist normalized transcript + provider metadata with the same contract as existing providers.
6. Add full test coverage for parser, ingestion, polling, and route validation.

---

## Current Gaps (Codebase)

- `backend/src/parsers/index.js` has no `ProviderType.REVAI`.
- `backend/src/services/transcriptIngestion.js` `submitToProvider()` supports only `ASSEMBLYAI` and `DEEPGRAM`.
- `backend/src/services/transcriptionPoll.js` polling fetch is AssemblyAI-only.
- `backend/src/routes/ingest.js` request schema enums exclude `REVAI`.
- Provider allowlists in:
  - `backend/src/services/transcriptionFinalize.js`
  - `backend/src/services/transcriptIngestion.js`
  currently exclude `REVAI`.

---

## Rev.ai Async API Mapping

Planned usage from Rev.ai async docs:

1. **Submit job**: `POST /speechtotext/v1/jobs`
2. **Check job**: `GET /speechtotext/v1/jobs/{job_id}`
3. **Fetch transcript JSON**: `GET /speechtotext/v1/jobs/{job_id}/transcript` (Rev JSON with monologues/elements)

Expected auth model: bearer access token.

---

## Data Contract + Parsing Plan

### Provider Identity
- Provider name: `REVAI`
- `textOriginalSource`: `AUTOGEN:REVAI`
- `Transcript.providerJobID`: Rev job id

### Parser Behavior (`backend/src/parsers/revai.js`)
- Detect Rev JSON by `monologues` array shape.
- Convert Rev monologues/elements into utterance segments:
  - Speaker: `monologue.speaker` as string (fallback `UNKNOWN`)
  - Text: concatenate element values for each utterance
  - Timing: convert seconds to milliseconds (`startMS`, `endMS`)
  - Confidence: normalize from available element-level confidence when present
  - `segmentIndex`: stable 0-based index
- Produce transcriptInfo:
  - `providerName: "REVAI"`
  - `providerJobID` from job metadata if present
  - `providerMeta` containing non-transcript payload fields

### Parser Integration
- Add to `ProviderType` enum and `detectFormat()` / `parse()` switch in `backend/src/parsers/index.js`.
- Export `parseRevAI` + `isRevAIFormat`.

---

## Ingestion + Polling Plan

### 1) Submission Path (`transcribe-media`)
- Add `submitToRevAI(audioPath, options, config)` in `backend/src/services/transcriptIngestion.js`.
- Include Rev.ai config block and validation (fail fast when missing token).
- Return:
  - `providerJobID`
  - `providerMeta` (job id + status + selected request params)
  - `providerWarnings` for unsupported cross-provider options

### 2) Poll Path
- Extend `backend/src/services/transcriptionPoll.js` with Rev fetch functions:
  - `fetchRevAIJobStatusFromAPI()`
  - `fetchRevAITranscriptFromAPI()`
- Poll logic:
  - If status completed/transcribed -> fetch transcript JSON and finalize.
  - If status failed/canceled -> mark transcript `FAILED`.
  - Otherwise return `processing` with non-final result.

### 3) Polling Capability Flag
- Update `supportsProviderPolling()` in `backend/src/services/transcriptIngestion.js` so `REVAI` uses queued polling path.

---

## API + Config Plan

### Route Schemas
Update enums in `backend/src/routes/ingest.js`:
- `POST /provider-json` provider enum includes `REVAI`.
- `POST /transcribe-media` provider enum includes `REVAI`.
- Any other provider enum references include `REVAI`.

### Runtime Config
Add Rev.ai config contract (aligned with current `config.transcription.*` usage):
- `config.transcription.revai.apiKey`
- `config.transcription.revai.baseUrl` (default Rev async base URL)

Environment/config key naming should remain consistent with repository conventions.

---

## Implementation Tasks

### 1. Parser
- [ ] Create `backend/src/parsers/revai.js`
- [ ] Add Rev parser unit tests in `backend/tests/parsers.providers.test.js`
- [ ] Wire parser into `backend/src/parsers/index.js`

### 2. Submission + Options
- [ ] Add `submitToRevAI()` in `backend/src/services/transcriptIngestion.js`
- [ ] Extend `submitToProvider()` dispatch for `REVAI`
- [ ] Add provider option normalization/warnings for Rev.ai capability differences

### 3. Polling
- [ ] Extend `backend/src/services/transcriptionPoll.js` for Rev.ai status/transcript fetch
- [ ] Add polling tests in `backend/tests/services.transcriptionPoll.test.js`
- [ ] Update `supportsProviderPolling()` behavior tests in `backend/tests/services.transcriptIngestion.test.js`

### 4. API Validation + Allowlists
- [ ] Extend provider enums in `backend/src/routes/ingest.js`
- [ ] Extend allowlists in:
  - `backend/src/services/transcriptionFinalize.js`
  - `backend/src/services/transcriptIngestion.js`
- [ ] Add/adjust route tests:
  - `backend/tests/routes.ingest.transcribeMedia.test.js`
  - `backend/tests/routes.ingest.transcriptionComplete.test.js` (if provider validation paths apply)

### 5. Documentation
- [ ] Update `docs/PROVIDER-FORMATS.md` with explicit Rev.ai mapping section
- [ ] Update relevant phase docs if needed to reflect active Rev.ai support

---

## Validation Plan

1. Unit tests for Rev parser with:
   - Multi-speaker monologues
   - Missing speaker fallback
   - Timestamp conversion correctness
   - Empty/invalid payload rejection
2. Service tests:
   - Submission success/failure for Rev.ai
   - Poll transitions (`processing` -> `completed` / `failed`)
3. Route tests:
   - `REVAI` accepted by schema where provider enums are used
4. End-to-end static path check:
   - `transcribe-media` request with `provider: REVAI` reaches submit, persists provider job id, queues poll job.

---

## Risks and Mitigations

- **Risk**: Rev transcript JSON timing granularity differs from existing providers.
  - **Mitigation**: strict parser normalization + edge-case tests for contiguous/non-contiguous elements.
- **Risk**: Capability mismatch for cross-provider options (speaker count hints, key terms).
  - **Mitigation**: explicit `providerWarnings` instead of silent behavior.
- **Risk**: Status string mismatches from Rev API variants.
  - **Mitigation**: centralized status normalization helper + tests for known status values.

---

## Acceptance Criteria

1. `REVAI` is accepted in ingest API provider enums.
2. Media transcription submission works with Rev.ai credentials and returns `providerJobID`.
3. Poll worker can finalize Rev.ai jobs without inline `providerResponse`.
4. Parsed utterances from Rev transcript are stored with `textOriginalSource: AUTOGEN:REVAI`.
5. All impacted backend tests pass with new Rev coverage.

