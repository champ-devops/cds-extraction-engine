# AGENTS (backend)

## Scope
- Applies to `/backend` and all subdirectories.
- Overrides root guidance when there is a conflict.

## Fastify Route Standards
- Use schema references/helpers for response schemas; do not handcraft repeated response objects in each route.
- Prefer model-driven schema generation where available to avoid route/model drift.
- Avoid `responseKey` wrappers when actual API responses are plain objects.
- For successful route responses, document and validate success status schemas (for example `200`, `201`) using shared schemas.

## Error Handling
- Keep error handling centralized (global Fastify error handler).
- Do not add route-level try/catch solely to remap validation errors already handled globally.
- Do not add per-route error schemas that conflict with centralized error behavior.

## Delete and State-Change Behavior
- Never assume delete/state-change success; verify operation result before sending success.
- Use shared response builders/schemas for delete operations instead of hardcoded payloads.
- Validate preconditions before state changes (for example already-deleted vs not-deleted cases).

## Sub-document Policy
- If a sub-document array contains stable `_id` values used as references, do not allow bulk replacement through generic parent update endpoints.
- Exclude those arrays from generic update schemas and guard at runtime with clear `400` errors.
- Manage such sub-documents via dedicated ID-addressable endpoints (list/create/update/delete/restore).
- Use soft-delete (`deletedAt`) where required and provide explicit "all" vs "active" list behavior.

## API Shape Conventions
- For endpoints that filter out soft-deleted items, use explicit `active*` route naming to make behavior obvious.
- Validate ULID fields with the existing ULID pattern where applicable.
- Maintain tenant safety: enforce `customerID` from auth/session context and prevent cross-tenant access.

## Test Standards
- Use `before` hooks for shared setup to avoid race conditions and flaky ordering dependencies.
- Use real ULIDs for synthetic IDs in tests.
- For partial update tests, capture "before" state and verify omitted fields remain unchanged.
- When tests create their own Fastify app instances, include the shared test error handler so validation behavior matches production.
- If production app uses custom content-type parsing (for example raw JSON body capture), replicate it in tests that depend on that behavior.

## Practical Rule
- Favor one source of truth for schemas and common response payloads; update shared utilities first, then wire routes/tests to them.
