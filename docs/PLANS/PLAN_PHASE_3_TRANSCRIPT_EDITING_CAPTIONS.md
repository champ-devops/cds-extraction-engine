# Phase 3: Transcript Editing + Captions

## Overview

Phase 3 adds a human-in-the-loop transcript editing workflow and a caption generation lifecycle that stays synchronized with transcript edits.

**Status**: Planning

**Dependencies**:
- Phase 1 transcript ingestion complete
- Transcript records include editable fields (`textModified`, `speakerModified`, `modifiedAt`)

---

## Goals

1. Allow targeted edits to transcript utterances without losing original provider text
2. Support bulk speaker correction (for diarization cleanup)
3. Support authoritative caption ingest as a hint source for transcript reconciliation
4. Generate SRT/VTT caption files from the current transcript revision
5. Regenerate captions automatically when transcript edits change the revision
6. Preserve auditability across transcript revisions and caption outputs

---

## Scope

### In Scope
- Backend APIs for transcript editing and bulk speaker rename
- Transcript revision metadata (`revision`, `modifiedAt`, `modifiedBy`)
- Authoritative caption hint metadata and reconciliation status
- Caption generation service (SRT and VTT)
- Caption freshness checks and invalidation rules
- Filesystem-based caption storage
- Basic UI contract for editor workflows (frontend implementation can follow)

### Out of Scope
- Rich collaborative editor UX (real-time multi-user editing)
- Translation/localization captions
- Speaker voice enrollment and auto speaker-name prediction

---

## Data Model Additions

### Transcript Fields
- `revision`: monotonically increasing integer
- `modifiedAt`: UTC timestamp of latest transcript edit
- `modifiedBy`: user/system identifier for latest edit
- `isAuthoritativeCaptionProvided`: whether a human caption file was supplied for this transcript
- `captionHintStatus`: `none | pending_reconciliation | reconciled | conflict`
- `transcriptSourceStatus`: `pending_media_transcript | transcript_ready | reconciled`

### Utterance Fields
- `speakerOriginal`, `speakerModified`
- `textOriginal`, `textModified`
- `modifiedAt`, `modifiedBy`
- `textSourceType`: `PROVIDER_TRANSCRIPT | AUTHORITATIVE_CAPTION | HUMAN_EDIT | SYSTEM_RECONCILED`
- `isAuthoritativeText`: whether this utterance text is the governing text for downstream outputs
- `captionCueID`: source cue identifier when caption hint exists
- `providerSegmentID`: source provider segment identifier when transcript exists
- `reconciliationStatus`: `unmatched | aligned | conflict`

### Caption Metadata Record
```json
{
  "transcriptID": "01ABC...",
  "format": "srt",
  "isAuthoritativeCaption": true,
  "path": "/captions/CUST123/01ABC/rev-12.srt",
  "transcriptRevision": 12,
  "generatedAt": "2026-02-10T18:30:00.000Z",
  "generator": "transcript-caption-service"
}
```

### Field Semantics (Preserved Explanation)

1. `textSourceType`
   - Meaning: where the current utterance text came from.
   - This is provenance, not precedence.
2. `isAuthoritativeText`
   - Meaning: whether this utterance text is the governing value for downstream use.
   - This is precedence, not provenance.
3. `reconciliationStatus`
   - Meaning: whether caption hints and provider transcript segments have been aligned or require review.

---

## API Plan

### PATCH /v1/transcripts/:transcriptID/utterances/:utteranceID

Edit a single utterance.

**Request:**
```json
{
  "speakerModified": "Timmy Smith",
  "textModified": "Corrected utterance text.",
  "editor": "user_123"
}
```

**Response:**
```json
{
  "success": true,
  "transcriptID": "01ABC...",
  "revision": 12,
  "modifiedAt": "2026-02-10T18:25:00.000Z"
}
```

### POST /v1/transcripts/:transcriptID/speakers/rename

Bulk rename all matching speaker labels.

**Request:**
```json
{
  "fromSpeaker": "Speaker A",
  "toSpeaker": "Timmy Smith",
  "editor": "user_123"
}
```

**Response:**
```json
{
  "success": true,
  "updatedUtterances": 146,
  "transcriptID": "01ABC...",
  "revision": 13,
  "modifiedAt": "2026-02-10T18:27:00.000Z"
}
```

### POST /v1/captions/generate

Generate or regenerate captions for a transcript revision.

**Request:**
```json
{
  "transcriptID": "01ABC...",
  "format": "srt",
  "isForceRegenerate": false
}
```

**Response:**
```json
{
  "success": true,
  "transcriptID": "01ABC...",
  "transcriptRevision": 13,
  "format": "srt",
  "path": "/captions/CUST123/01ABC/rev-13.srt",
  "generatedAt": "2026-02-10T18:30:00.000Z",
  "isReusedExisting": false
}
```

### GET /v1/captions/:transcriptID

Get latest caption metadata per format.

---

## Caption Regeneration Rules

1. Captions are valid only when `caption.transcriptRevision === transcript.revision`.
2. If transcript revision changes, existing caption records become stale.
3. Stale captions are regenerated on-demand (first read) or via background job.
4. Caption output path includes revision to avoid accidental overwrite.

---

## Authoritative Caption Hint Workflow

1. If captions are supplied with `isAuthoritativeCaption = true`, ingest them as human-authored hints.
2. If no transcript is supplied, run normal media transcription to create provider transcript data.
3. Reconcile caption cues to provider segments and set per-utterance `reconciliationStatus`.
4. Prefer authoritative caption text when conflicts exist, then flag unresolved conflicts for review.
5. Preserve both provenance (`textSourceType`) and precedence (`isAuthoritativeText`) in each utterance.

---

## Implementation Tasks

### 3.1 Transcript Editing Infrastructure
- [ ] Add revision increment logic on utterance edit operations
- [ ] Add single-utterance edit service method
- [ ] Add bulk speaker rename service method
- [ ] Add input validation + authorization checks
- [ ] Add audit logging (`editor`, `changedFields`, `before/after`)

### 3.2 Caption Generation Service
- [ ] Create caption formatter module (`srt`, `vtt`)
- [ ] Build utterance-to-caption cue conversion
- [ ] Implement caption file writer
- [ ] Add metadata persistence for generated captions
- [ ] Add stale caption detection logic

### 3.3 Sync and Lifecycle
- [ ] Trigger caption invalidation after transcript edits
- [ ] Add optional async regeneration job
- [ ] Add endpoint to query freshness (`isStale`)
- [ ] Define retention policy for old revision caption files
- [ ] Add caption hint reconciliation worker (captions vs provider transcript)
- [ ] Add conflict queue for `reconciliationStatus = conflict`

### 3.4 Testing
- [ ] Unit tests for utterance edit and bulk rename
- [ ] Unit tests for SRT/VTT formatting edge cases
- [ ] Integration tests for edit -> revision bump -> caption regeneration
- [ ] Regression test for malformed cue timings

### 3.5 Documentation
- [ ] API examples for all new endpoints
- [ ] Operational notes for caption storage/cleanup
- [ ] Failure handling playbook (partial generation, stale metadata)

---

## Success Criteria

1. Single-utterance edits update modified fields and revision correctly
2. Bulk speaker rename updates all intended utterances only
3. SRT and VTT outputs are generated from current transcript revision
4. Stale captions are detected reliably after transcript edits
5. Regeneration latency is acceptable (<10s for typical meetings)
6. End-to-end tests pass for edit/caption lifecycle

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Accidental overwrite of original text | High | Enforce original vs modified field separation |
| Stale captions served after edits | High | Revision check before serving captions |
| Bulk rename affects wrong speaker labels | Medium | Require exact match + preview count endpoint |
| Caption generation failure mid-write | Medium | Atomic write temp file -> rename |
| Large transcript edit operations are slow | Medium | Batch updates + async job option |

---

## Related Documents

- `PLAN_PHASE_1.md` - ingestion foundation
- `PLAN_PHASE_2.md` - timeline generation consuming transcript revisions
- `PLAN_OVERALL.md` - phased roadmap
- `README.md` - product goals and outputs
