# Plan: Decouple Saved Silence Threshold from Chunking Threshold

## Context

Current behavior uses a single threshold (`silenceMinSecs`) for:
1. `ffmpeg silencedetect` detection
2. chunk boundary planning
3. persisted `silenceAnalysis.silenceIntervals`

This means persisted silence intervals are currently tied to request/runtime `silenceMinSecs`, and can miss shorter silence periods that should be saved.

The config already includes `media.SILENCE_MIN_SECS_TO_SAVE` in `cds-automated-minutes.LOCALDEV.appConfig.json`, but backend config parsing/runtime logic does not currently use it.

## Goal

Persist all silence intervals that are at least `media.SILENCE_MIN_SECS_TO_SAVE`, regardless of the chunking threshold (`silenceMinSecs`) used for segmentation.

## Non-Goals

1. No changes to provider payload format.
2. No Core API schema changes beyond fields already accepted in transcript metadata objects.
3. No behavioral changes to diarization/vocabulary logic.

## Proposed Design

### 1) Add explicit save threshold to runtime config

File: `backend/src/config/appConfig.js`

Add `media.silenceDetection.minSilenceSecsToSave` sourced from `SILENCE_MIN_SECS_TO_SAVE`.

Compatibility rule:
1. Preferred: read `SILENCE_MIN_SECS_TO_SAVE` when present.
2. Fallback: if missing, default to `SILENCE_MIN_SECS` to preserve existing deployments/configs.

### 2) Run detection at the lower threshold once, derive two interval sets

File: `backend/src/services/transcriptIngestion.js`

At runtime compute:
1. `silenceMinSecs` (existing chunking threshold; request override still allowed)
2. `silenceMinSecsToSave` (config-driven save threshold)
3. `silenceDetectMinSecs = Math.min(silenceMinSecs, silenceMinSecsToSave)`

Call `analyzeSilence(..., { minSilenceSecs: silenceDetectMinSecs })` once.

Derive:
1. `chunkingSilenceIntervals`: intervals where `durationMS >= silenceMinSecs * 1000`
2. `savedSilenceIntervals`: intervals where `durationMS >= silenceMinSecsToSave * 1000`

Use:
1. `chunkingSilenceIntervals` for `buildChunkMapFromSilence(...)`
2. `savedSilenceIntervals` for transcript DB update payload (`silenceAnalysis.silenceIntervals`)

### 3) Keep metadata explicit to avoid ambiguity

File: `backend/src/services/transcriptIngestion.js`

Update both `providerMeta.silenceAnalysis` and root `silenceAnalysis` payloads to include:
1. `silenceDetectMinSecs` (actual ffmpeg detection threshold)
2. `chunkingMinSilenceSecs` (existing request/runtime threshold)
3. `saveMinSilenceSecs` (config threshold)
4. `silenceIntervalCount` as count of saved intervals
5. `chunkingSilenceIntervalCount` as count used for chunking

Backward compatibility:
1. Keep existing `minSilenceSecs` field for now.
2. Set it to `chunkingMinSilenceSecs` (current semantics) and rely on new explicit fields for clarity.

### 4) Optional service utility cleanup

File: `backend/src/services/silenceDetection.js` (optional)

Add a small shared helper for filtering intervals by min duration to avoid duplicate filtering logic and keep unit tests simple.

## Validation and Tests

### Unit tests

1. `backend/tests/services.silenceDetection.test.js`
   - Add coverage for filtering behavior (if helper introduced).

2. `backend/tests/services.transcriptIngestion.test.js`
   - Add a focused test that verifies:
   - chunk map uses `silenceMinSecs`
   - persisted `silenceAnalysis.silenceIntervals` uses `SILENCE_MIN_SECS_TO_SAVE`
   - metadata includes `silenceDetectMinSecs`, `chunkingMinSilenceSecs`, `saveMinSilenceSecs`

### Config parse tests

If config parsing tests exist/are added, verify:
1. `SILENCE_MIN_SECS_TO_SAVE` is read when provided.
2. fallback to `SILENCE_MIN_SECS` when not provided.

### Route tests

No schema changes required for ingest request body; request-level `silenceMinSecs` remains supported.

## Acceptance Criteria

1. Persisted silence intervals include all intervals with duration >= `media.SILENCE_MIN_SECS_TO_SAVE`, independent of request `silenceMinSecs`.
2. Chunking behavior continues using `silenceMinSecs` (request override/config default).
3. Single ffmpeg analysis pass remains (no double analysis cost).
4. Transcript metadata clearly records detect/chunk/save thresholds.
5. Existing deployments without `SILENCE_MIN_SECS_TO_SAVE` continue to start and behave as before.

## Risks and Mitigations

1. Risk: Lower detect threshold increases number of detected intervals.
   - Mitigation: single-pass detection plus explicit post-filtering; keep existing max segment controls.

2. Risk: Downstream consumers interpret `silenceIntervalCount` as chunking count.
   - Mitigation: add `chunkingSilenceIntervalCount` and keep `minSilenceSecs` for backward compatibility; document semantics.

3. Risk: Test fragility in large `submitMediaForTranscription` flow.
   - Mitigation: isolate filtering/threshold derivation into helper(s) and unit-test helpers directly.

## Implementation Checklist

1. Update config parser for `SILENCE_MIN_SECS_TO_SAVE` with fallback behavior.
2. Update transcription flow to compute detect/chunk/save thresholds.
3. Filter interval sets for chunking vs persistence.
4. Update transcript update payload metadata fields.
5. Add/adjust tests.
6. Update docs (`docs/TRANSCRIPTION-OPTIONS.md` and/or config reference) to document save-threshold behavior.
