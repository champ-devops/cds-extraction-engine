# Plan: CustomerAPI Read-Only Integration

## Overview

Add first-class support for CHAMP CustomerAPI as a read-only data source in the transcript ingestion service.  
This plan uses the installed packages:
- `@champds/customerapi-client`
- `@champds/cds-constants-customerapi`

Primary objective: safely fetch CustomerAPI media metadata only, while using CoreAPI as the source of truth for v1->v2 customer translation.

---

## Goals

1. Add a centralized CustomerAPI client wrapper in backend code.
2. Integrate CustomerAPI config into strict startup validation.
3. Expose reusable read-only service methods for downstream workflows.
4. Add connection test coverage (CLI + health routes) for CustomerAPI.
5. Keep all CustomerAPI usage explicitly read-only with guardrails.
6. Update job-queue media input handling to support `cdsMediaID` or `cdsV1MediaID`.
7. Use CoreAPI `legacyCustomerID` mapping for v1->v2 customer resolution.

---

## Non-Goals

- No CustomerAPI write endpoints (`POST` mutations to remote state).
- No broad refactor of existing CoreAPI/transcription flows.
- No schema migrations tied to CustomerAPI in this phase.

---

## Current Findings

From installed package analysis and your example importer:

1. `@champds/customerapi-client` provides:
   - `doGet({ path, queryJSON })`
   - `doPost({ path, queryJSON, body })`
2. Auth/header behavior is already handled by the package:
   - `Authorization: Bearer <token>`
   - `X-CDS-Auth-Hint: STATIC`
3. Sample known read-only paths from your importer:
   - `/customer/all/ALPHA`
   - `/credential/all`
4. Additional read path required for media lookup:
   - `/media/byMediaID/{cdsV1MediaID}?customerID={v1CustomerID}`
5. `@champds/cds-constants-customerapi` exposes masks/constants (event/media/auth flags) that can be used to avoid magic numbers.
6. CoreAPI customer records expose `legacyCustomerID` and `customerID`, enabling v1->v2 mapping without CustomerAPI customer-list lookups.

---

## Proposed Architecture

### 1. Config Integration

Add a required `customerAPI` section in app config parsing.

Required by `@champds/customerapi-client` constructor:
- `HOSTNAME` (string)
- `PORT` (number)
- `API_TOKEN` (string)

Optional:
- `IS_FORCE_SSL` (boolean)
- `TIMEOUT_CONNECT_MS` (number)

Implementation target:
- `backend/src/config/appConfig.js`

Runtime expectation:
- preserve the raw `customerAPI` shape expected by the package (`HOSTNAME`, `PORT`, `API_TOKEN`, optional `IS_FORCE_SSL`, `TIMEOUT_CONNECT_MS`) when constructing the client.

### 2. Backend Client Wrapper

Create a local wrapper around `@champds/customerapi-client` to normalize error handling and enforce read-only usage:

- `backend/src/clients/customerApiClient.js`

Responsibilities:
- Construct package client from validated config.
- Provide `requestGet(path, query)` helper.
- Reject/omit mutation helpers at this layer.
- Normalize thrown errors into service-friendly error objects.

### 3. CustomerAPI Service Layer

Create service helpers for reusable business reads:

- `backend/src/services/customerApiData.js`

Initial methods:
- `listCustomersAlpha()`
- `listCredentials()`
- `getCustomerLookupMaps()` (by `customerID`, `customerAccessID`)
- `getCustomerByV1CustomerID(v1CustomerID)`
- `getMediaByV1MediaID(v1CustomerID, cdsV1MediaID)`

Optional second-step methods (only if needed by current workflows):
- event/media metadata fetchers that map external IDs to meeting context.

### 3.1 Job Queue Payload Migration (Media Resolution)

Replace the current payload assumption (`mediaPath`) with:
- `cdsMediaID` (current-system media ID), or
- `cdsV1MediaID` (legacy v1 media ID)

Resolution rules:

1. If `cdsMediaID` is present:
   - resolve media via existing CoreAPI logic (no CustomerAPI lookup required).
2. If `cdsV1MediaID` is present:
   - read queue `customerID` as integer v1 `customerID`.
   - call CoreAPI customers admin list and find customer where `legacyCustomerID === <queue customerID>`.
   - use CoreAPI `customerID` as v2 customerID (source of truth for this service).
   - call `GET /media/byMediaID/{cdsV1MediaID}?customerID={v2CustomerID}`.
   - use `customerNameInternal` as the first path segment when building/scoping media file paths for DFW/local media lookup.
   - build media source info from response fields:
     - `mediaFileLocation`
     - `mediaFileName`
     - optional metadata (`customerEventID`, `mediaClassID`, `lengthSeconds`, etc.)
3. If neither ID is present:
   - fail fast with validation error.
4. If both IDs are present:
   - prefer `cdsMediaID`; log that `cdsV1MediaID` was ignored.

Implementation targets:
- `backend/src/queue/jobQueueRuntime.js` (payload validation + dispatch)
- `backend/src/services/transcriptIngestion.js` (media resolution branch)
- `backend/src/services/customerApiData.js` (lookup helpers)

### 4. Constants Adapter

Add a single import surface for constants:

- `backend/src/constants/customerApiConstants.js` (or `shared/` if later needed by frontend)

Purpose:
- Re-export selected constants used by backend logic.
- Keep masks centralized and discoverable.

### 5. Connectivity + Health

Extend connection testing:

- `backend/src/utils/connectionTester.js`
- `backend/src/cli/test-connections.js`
- `backend/src/routes/health.js`

Add:
- `testCustomerAPIConnection()` using a lightweight GET endpoint.
- CLI flag: `--customerapi`
- route: `GET /connections/customerapi`
- include CustomerAPI in `testAllConnections()`.

---

## Read-Only Guardrails

1. Do not expose package `doPost` from local wrapper.
2. Name service methods with read semantics only (`get/list/find`).
3. Add unit test asserting mutation methods are unavailable.
4. Document allowed endpoint patterns in code comments and this plan.

---

## Implementation Phases

### Phase A: Foundation
- [ ] Add strict config parsing for `customerAPI`.
- [ ] Add backend client wrapper `customerApiClient.js`.
- [ ] Add constants adapter file.

### Phase B: Service Integration
- [ ] Add `customerApiData.js` read methods for known datasets.
- [ ] Add mapping helpers for legacy IDs vs `customerAccessID`.
- [ ] Add mapping helper for `v1 customerID (integer) -> customerAccessID/customerNameInternal`.
- [ ] Add media lookup helper for `cdsV1MediaID` via `/media/byMediaID/{id}`.
- [ ] Add internal call sites where dataset lookup is required.

### Phase B.1: Queue Payload Migration
- [ ] Update queue payload schema to accept `cdsMediaID` or `cdsV1MediaID` instead of `mediaPath`.
- [ ] Add validation rule: exactly one of `cdsMediaID` or `cdsV1MediaID` is preferred (allow both but prefer `cdsMediaID`).
- [ ] Add legacy-media resolution flow using CustomerAPI lookups.
- [ ] Keep downstream transcription flow unchanged after media is resolved.

### Phase C: Observability
- [ ] Add CustomerAPI connection tester function.
- [ ] Add CLI support (`--customerapi` and all-services summary).
- [ ] Add health route for CustomerAPI.

### Phase D: Validation
- [ ] Unit tests for config parse success/failure.
- [ ] Unit tests for client wrapper error normalization.
- [ ] Unit tests for read-only guardrails.
- [ ] Optional integration test against mocked CustomerAPI responses.

---

## Testing Strategy

1. Config tests:
   - fail startup when required `customerAPI` keys are missing/invalid.
2. Client tests:
   - valid GET returns parsed JSON payload.
   - non-2xx response returns structured error.
3. Service tests:
   - customer lookup maps build correctly from sample payloads.
   - integer v1 `customerID` resolves to current customer identity.
   - media lookup by `cdsV1MediaID` returns expected media file fields.
4. Connection tests:
   - explicit pass/fail messages in CLI and health endpoint output.
5. Queue payload tests:
   - accepts `cdsMediaID` only.
   - accepts `cdsV1MediaID` only.
   - rejects when neither is supplied.
   - deterministic behavior when both are supplied.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| CustomerAPI outage/latency | Medium | timeouts + explicit connection checks + clear error surface |
| Shape drift in CustomerAPI responses | Medium | normalize in service layer + add payload validation |
| Accidental write usage | High | wrapper exposes GET-only methods + tests |
| Config mismatch between environments | Medium | strict startup validation in `appConfig.js` |
| Customer mapping miss (v1 `customerID` not found) | High | fail fast with explicit error including requested v1 customerID |
| Legacy media missing for valid customer | High | return actionable not-found error and stop job early |

---

## Success Criteria

1. Service starts only when valid CustomerAPI config is present.
2. CustomerAPI connectivity is visible in health + CLI checks.
3. Backend code can fetch known datasets through one centralized read-only service.
4. No write/mutation CustomerAPI call path exists in this integration phase.
5. Queue jobs can resolve media when given `cdsMediaID` or `cdsV1MediaID`.
6. Legacy v1 flow correctly uses queue `customerID` as integer v1 key and maps to current customer identity via `/customer/all/ALPHA`.
7. CustomerAPI usage is limited to media lookup calls; customer translation uses CoreAPI `legacyCustomerID` mapping.

---

## Suggested First Endpoints to Support

Based on your provided importer usage:

1. `GET /customer/all/ALPHA`
2. `GET /credential/all`
3. `GET /media/byMediaID/{cdsV1MediaID}?customerID={v1CustomerID}`

These provide the minimal datasets needed for legacy-media retrieval plus v1-to-current customer mapping workflows.
