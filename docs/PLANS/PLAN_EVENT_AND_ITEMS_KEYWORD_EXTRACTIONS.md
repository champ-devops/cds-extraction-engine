# Plan: First-Class `EVENT_AND_ITEMS` Output (Current Scope)

## Overview

### Goal
Move event-derived extraction outputs out of transcript metadata and into a first-class Core API `EVENT_AND_ITEMS` extraction.

### In Scope (now)
- `EVENT_AND_ITEMS` only
- Persist event/item source rows
- Persist the full event-level keyword JSON list returned by AI in the same `EVENT_AND_ITEMS` extraction so it can be reused later without another AI call
- Stop storing this payload as transcript-embedded metadata

### Out of Scope (later)
- Creating separate `KEYWORD_EXTRACTION` records/items
- Additional extraction kinds beyond `EVENT_AND_ITEMS`

## Contract Decisions

### Extraction kind
- `extractionKind: EVENT_AND_ITEMS`

### Offset unit
- `offsetUnit: NONE`

### Item kind
- `itemKind: TOPIC`

### Source typing in item metadata
Use `meta.sourceType`:
- `EVENT`
- `AGENDA_ITEM`
- `TIMELINE_ITEM`

### Targeting
Bind extraction to same target identity currently used by ingestion:
- `targetClassName` / `targetID` where available
- `v1TargetClassName` / `v1TargetID` where available

## Data Shape

### `EVENT_AND_ITEMS` extraction (root)
Recommended root fields:
- `extractionKind: EVENT_AND_ITEMS`
- `offsetUnit: NONE`
- `status: COMPLETE`
- `providerName: INTERNAL`
- `extractionData`:
  - `cdsV1EventID`
  - `sourceCounts`:
    - `eventCount`
    - `agendaItemCount`
    - `timelineItemCount`
  - `keywordListJSON` (the complete JSON list returned from AI for the entire event)
  - `keywordListVersion` (optional schema/version marker)
  - `buildMeta`:
    - `builtAt`
    - `version`

### `EVENT_AND_ITEMS` items
One item per source row:
- `itemKind: TOPIC`
- `textOriginal`: canonical merged text (title + description where applicable)
- `meta`:
  - `sourceType: EVENT | AGENDA_ITEM | TIMELINE_ITEM`
  - `sourceID` (when present)
  - `title`
  - `description` (for `EVENT` / `AGENDA_ITEM`)
  - `externalID` (timeline when present)

## Implementation Plan

### Phase 1: Add persistence helper
1. Add `createOrReplaceEventAndItemsExtraction(...)` in `backend/src/services/transcriptIngestion.js`.
2. Reuse existing Core API client methods (`createExtraction`, `createExtractionItems`, list/get + replace pattern).
3. Keep helper isolated and unit-testable.

### Phase 2: Build and persist `EVENT_AND_ITEMS` payload
1. Extend the event-hint path to produce normalized rows for:
   - Event title + description
   - Agenda item title + description
   - Timeline item title
2. Enforce trim/empty filtering and deterministic ordering.
3. Persist rows as `EVENT_AND_ITEMS` items.
4. Persist `keywordListJSON` (full AI-returned keyword list for the entire event) on `EVENT_AND_ITEMS.extractionData`.

### Phase 3: Remove transcript-embedded storage for this data
1. Stop storing event/item + keyword payload blobs in transcript `providerMeta`.
2. Keep transcript metadata focused on provider submission/polling.
3. Optionally store only a lightweight pointer: `eventAndItemsExtractionID`.

### Phase 4: Response/debug compatibility
1. Preserve current warning behavior (`EVENT_HINTS_*`) to avoid API regressions.
2. Keep operational debug details needed by current clients, but use `EVENT_AND_ITEMS` as source-of-truth payload storage.

## Idempotency and Replace Strategy

For each run and target identity:
1. Find active `EVENT_AND_ITEMS` extraction for that scope.
2. If found, hard-delete extraction + items.
3. Create fresh extraction + items.

This prevents duplicate chains during retries and reprocessing.

## Tests

### `backend/tests/services.transcriptIngestion.test.js`
Add/extend tests for:
1. `EVENT_AND_ITEMS` extraction creation with expected source row counts.
2. `keywordListJSON` persisted on extraction root.
3. Replace behavior when prior `EVENT_AND_ITEMS` extraction exists.
4. Transcript metadata no longer carries old embedded event/keyword payload blob.

### `backend/tests/services.eventHints.test.js`
Add/extend tests for:
1. Agenda row includes title + description.
2. Timeline row includes title only.
3. Event row includes title + description.
4. Source typing is correct (`EVENT`, `AGENDA_ITEM`, `TIMELINE_ITEM`).
5. Deterministic ordering and dedupe behavior.

## Rollout

### Step 1: Dual-write (optional short safety window)
- Persist `EVENT_AND_ITEMS` extraction.
- Keep transcript blob temporarily for comparison.

### Step 2: Flip to extraction-first
- Remove transcript blob writes.
- Keep only extraction pointer if needed.

## Risks and Mitigations

1. Duplicate records during retries.
- Mitigation: explicit replace strategy per target + `EVENT_AND_ITEMS`.

2. Loss of payload visibility after transcript cleanup.
- Mitigation: store full keyword JSON list on extraction root (`keywordListJSON`).

3. Behavior regressions in transcribe submission.
- Mitigation: do not change provider submission flow; change persistence layer only.

## Acceptance Criteria

1. `EVENT_AND_ITEMS` extraction is created per run with items for:
   - Event title/description (`EVENT`)
   - Agenda item title/description (`AGENDA_ITEM`)
   - Timeline title (`TIMELINE_ITEM`)
2. Full event-level keyword JSON list from AI is stored on `EVENT_AND_ITEMS.extractionData.keywordListJSON`.
3. Event/item/keyword payload blob is no longer persisted on transcript metadata.
4. Existing transcription submission/polling behavior remains unchanged.
5. Tests cover create/replace and payload-shape expectations for this scope.

## Future Phase (Explicitly Deferred)

- Create separate `KEYWORD_EXTRACTION` first-class extraction/items using the stored `keywordListJSON` from `EVENT_AND_ITEMS` as source input.

## Files Expected to Change During Implementation

- `backend/src/services/transcriptIngestion.js`
- `backend/src/services/eventHints.js`
- `backend/tests/services.transcriptIngestion.test.js`
- `backend/tests/services.eventHints.test.js`
- Optional docs updates in `README.md` and `docs/`
