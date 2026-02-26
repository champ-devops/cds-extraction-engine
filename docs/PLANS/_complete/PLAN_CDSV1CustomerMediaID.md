# Plan: Canonical `externalMediaID` Migration to `CDSV1CustomerMediaID:*`

## Status
- Status: Planning (Ready for implementation)
- Requested: 2026-02-25
- Scope: Backend ingestion + polling + silence detection/extractions + compatibility migration

---

## Executive Summary

We will make `CDSV1CustomerMediaID:*` the single canonical media identity used by ingestion and downstream workflows.

At the same time, we will preserve path efficiency by storing a cached path in metadata:
- Canonical identity: `externalMediaID = CDSV1CustomerMediaID:<id>`
- Cached path: `externalMediaPath = CDSV1Path:<customer>/<location>/<file>.mp4` (or normalized equivalent)

This avoids path-drift identity bugs while reducing repeated CustomerAPI lookups.

---

## Decision (Hard Requirements)

1. All new transcript records must persist canonical `externalMediaID` as `CDSV1CustomerMediaID:*`.
2. All silence detection/extraction records must use the same canonical `externalMediaID`.
3. Polling/resume/finalize flows must continue using canonical `externalMediaID` and carry cached `externalMediaPath` when known.
4. Legacy IDs remain readable during migration (`CDSV1Path:*`, `CDSV1MediaID:*`), but new writes are canonical.

---

## Why This Change

Current path-based IDs (`CDSV1Path:*`) can drift when media paths change, causing:
- duplicate transcript/extraction records
- missed reuse of existing silence extraction data
- weaker idempotency for retries/resume

`CDSV1CustomerMediaID:*` is stable and authoritative, while `externalMediaPath` gives operational speed and traceability.

---

## Canonical Contract

## Accepted Input Forms

- `CDSV1CustomerMediaID:<positive-int>` (new canonical)
- `CDSV1MediaID:<positive-int>` (legacy alias)
- `CDSV1Path:<path>` (legacy)
- raw path (legacy convenience)

## Canonicalization Rules

1. `CDSV1CustomerMediaID:*` stays as-is.
2. `CDSV1MediaID:*` maps to `CDSV1CustomerMediaID:*` (same numeric value).
3. `CDSV1Path:*` and raw paths resolve to `customerMediaID` via CustomerAPI; canonicalized to `CDSV1CustomerMediaID:*`.
4. If path is known, store `externalMediaPath` in metadata.

## Persistence Rules

- `transcript.externalMediaID`: canonical only for new writes
- `transcript.providerMeta.externalMediaPath`: cached path
- silence extraction `externalMediaID`: canonical only for new writes
- silence extraction metadata: include cached `externalMediaPath` when available

---

## Affected Surfaces

1. Ingestion submit flow (`submitMediaForTranscription`)
2. Transcript create/reuse dedupe path
3. Media resolution helper path
4. Polling/resume payload propagation
5. Silence detection extraction creation/reuse/recreate
6. Route/API docs and tests
7. Backfill/migration utility

---

## Implementation Plan (Detailed)

## Phase 1: Canonical Identity Plumbing

### 1.1 Add canonical media identity resolver (new helper)

File:
- `backend/src/services/transcriptIngestion.js`

Implement helper(s):
- `parseExternalMediaIdentity(value)`
- `resolveCanonicalExternalMediaContext({ customerID, externalMediaID, mediaPath, cdsV1MediaID, ... })`
- `buildCanonicalExternalMediaID(customerMediaID)` -> `CDSV1CustomerMediaID:<id>`
- `buildExternalMediaPathValue(customerScopedPath)` -> `CDSV1Path:<path>`

Output structure (single source of truth):
- `canonicalExternalMediaID`
- `customerMediaID`
- `externalMediaPath`
- `legacyCandidates` (for compatibility lookups)
- `inputKind`

### 1.2 Preserve compatibility for existing builder

File:
- `backend/src/services/transcriptIngestion.js`

- Keep `buildCDSV1PathExternalMediaID` only for legacy compatibility references.
- Stop using it as the canonical writer path for new transcript identity.

### 1.3 CustomerAPI lookup helpers

File:
- `backend/src/services/customerApiData.js`

Add/confirm helper for lookup by customer media ID using legacy customer context:
- `getMediaByV1MediaID(...)` is already present and should be reused where IDs are numeric.

Add optional convenience wrapper if needed:
- `getMediaByCustomerMediaID(v2CustomerID, customerMediaID)` (internally resolves legacy customer and calls byMediaID endpoint).

---

## Phase 2: Transcript and Polling Identity Migration

### 2.1 Ingestion write path

File:
- `backend/src/services/transcriptIngestion.js`

Change:
- `effectiveExternalMediaID` must be computed from canonical resolver.
- For new writes, always use canonical `CDSV1CustomerMediaID:*`.
- Populate `providerMeta.externalMediaPath` when known.

### 2.2 Create/reuse dedupe logic

File:
- `backend/src/services/transcriptIngestion.js`

Change `createOrReuseTranscript` + `findTranscriptByExternalMediaID` flow:
- Primary query/match on canonical external ID.
- If not found, search compatibility candidates (legacy path/mediaID forms).
- If legacy record found, reuse and update metadata toward canonical values.
- Avoid duplicate creation for same provider/media.

### 2.3 Polling + resume payload

File:
- `backend/src/services/transcriptIngestion.js`
- `backend/src/services/transcriptionPoll.js` (if payload assumptions exist)
- `backend/src/services/transcriptionFinalize.js` (if providerMeta normalization needed)

Change:
- Ensure payload carries canonical `externalMediaID` and optional `externalMediaPath`.
- Ensure finalize does not drop `externalMediaPath`.

---

## Phase 3: Silence Detection/Extraction Canonicalization (Mandatory)

### 3.1 Extraction lookup and creation

File:
- `backend/src/services/transcriptIngestion.js`

Functions affected:
- `resolveSilenceForTranscription`
- `findMostRecentSilenceExtraction`
- `createSilenceExtractionAndItems`

Required behavior:
- Use canonical `CDSV1CustomerMediaID:*` as primary key for extraction lookup/create.
- Include `externalMediaPath` in extraction metadata when available.
- Compatibility fallback: if canonical lookup misses, check legacy external ID candidates.
- On legacy hit, reuse extraction and opportunistically migrate identity fields.

### 3.2 Force recreate semantics

- `silenceForceRecreate=true` must operate on canonical-targeted extraction set and compatibility matches.
- Deletion/recreate should not create duplicate stale extraction chains across mixed ID formats.

---

## Phase 4: API/Schema/Docs Updates

### 4.1 Route schema

File:
- `backend/src/routes/ingest.js`

Update descriptions for `externalMediaID`:
- document accepted forms
- document canonical write behavior
- mention `externalMediaPath` caching behavior in details/providerMeta

### 4.2 Docs

Files:
- `README.md` (if ingestion examples exist)
- `docs/PLANS/*` references that assume `CDSV1Path` is canonical

Update request/response examples to canonical identity.

---

## Phase 5: Migration and Backfill

## 5.1 Dual-read / dual-accept rollout

- Deploy canonical writer + compatibility readers first.
- Keep legacy compatibility for at least one release window.

## 5.2 Backfill task

Create a one-time/backfill CLI job:
- Find transcript and extraction records with legacy external IDs.
- Resolve `customerMediaID` and write canonical ID.
- Preserve/set `externalMediaPath` metadata.
- Emit unresolved report for manual investigation.

## 5.3 Post-backfill tightening

Optional strict mode (future):
- reject new legacy `externalMediaID` formats at API boundary
- retain read compatibility as needed

---

## Testing Plan

## Unit Tests

File:
- `backend/tests/services.transcriptIngestion.test.js`

Add tests for:
- parse/normalize all external ID formats
- canonicalization to `CDSV1CustomerMediaID:*`
- invalid prefix/value handling
- compatibility candidate generation

## Service Tests

Add/update tests for:
- create/reuse transcript with mixed canonical + legacy existing records
- no duplicate transcript created during compatibility path
- providerMeta includes `externalMediaPath`

## Silence Tests

Add/update tests for:
- canonical extraction reuse path
- legacy fallback extraction reuse path
- force recreate across mixed ID formats
- extraction metadata includes `externalMediaPath`

## Route Tests

File:
- `backend/tests/routes.ingest.transcribeMedia.test.js`

Add scenarios:
- request with canonical `CDSV1CustomerMediaID:*`
- request with `CDSV1Path:*` canonicalized internally
- request with `CDSV1MediaID:*` alias behavior

## Regression Tests

- resume polling still works with canonical IDs
- event-based (`cdsV1EventID`) ingestion still resolves and writes canonical ID

---

## Rollout Sequence

1. Implement canonical resolver + tests.
2. Switch transcript create path to canonical writes.
3. Implement transcript compatibility reuse reads.
4. Implement silence extraction canonical writes + compatibility reuse reads.
5. Add `externalMediaPath` propagation everywhere metadata is assembled.
6. Deploy dual-read/write behavior.
7. Run backfill and monitor metrics.
8. Decide strict-mode timeline.

---

## Metrics and Observability

Track:
- canonical write rate: `% externalMediaID matching CDSV1CustomerMediaID:*`
- compatibility hit rate for legacy transcript reuse
- compatibility hit rate for legacy silence extraction reuse
- path->customerMediaID lookup failures
- duplicate transcript conflicts over time
- duplicate silence extraction creations over time

Add temporary structured logs during migration:
- `externalMediaIDCanonicalized`
- `legacyCompatibilityMatchFound`
- `externalMediaPathCached`

---

## Risks and Mitigations

1. Duplicate records during transition
- Mitigation: compatibility reuse before create + backfill.

2. Lookup dependency failures
- Mitigation: explicit failures, retry policy, and path cache reuse when available.

3. Performance overhead
- Mitigation: canonical ID fast path; cache path metadata; avoid repeated lookup when mediaID already known.

4. Partial migration inconsistency
- Mitigation: dual-read window + unresolved report + staged strict mode.

---

## Acceptance Criteria

1. New transcript ingestions write `externalMediaID` as `CDSV1CustomerMediaID:*`.
2. New silence detection/extraction records also write `externalMediaID` as `CDSV1CustomerMediaID:*`.
3. `externalMediaPath` is persisted in metadata when known and reused in downstream flow.
4. Existing legacy records are reusable without duplicate spikes.
5. Test suite includes canonical + legacy compatibility coverage and passes.
6. Backfill runbook and script exist with unresolved-case reporting.

---

## Execution Checklist

- [ ] Add canonical identity parser/resolver helpers.
- [ ] Wire canonical identity into `submitMediaForTranscription`.
- [ ] Wire `externalMediaPath` propagation into provider meta and job payload.
- [ ] Update transcript create/reuse compatibility logic.
- [ ] Update silence extraction create/reuse/recreate compatibility logic.
- [ ] Update route schema/docs for external ID forms.
- [ ] Add/update unit/service/route/silence tests.
- [ ] Create backfill script + dry-run mode + unresolved report.
- [ ] Deploy dual-read/write release.
- [ ] Run backfill and validate metrics.
- [ ] Decide strict-mode enforcement date.
