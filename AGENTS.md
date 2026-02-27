# AGENTS

## Scope
- This file applies to the entire repository.
- More specific rules in nested `AGENTS.md` files override this file for their directory trees.

## Project Context
- Product domain: agenda management + video/meeting publishing for municipalities.
- `Event` is a meeting with agenda items, media, attachments, timeline, and minute items.
- `MyDot` is the customer-facing management area.
- `PlayDot` is the public-facing viewing area.
- `Customer` and `Publisher` are synonymous.

## Repository Focus
- Service goal: ingest transcripts and support automated minute generation workflows.
- Backend app code lives in `backend/src/`.
- Frontend app code will live in `frontend/`.
- Cross-app contracts/utilities should live in `shared/`.
- API and architecture docs are in `README.md` and `docs/`.
- Core API reference docs in `./docs/core-api` are a strict read-only resource for integration guidance.
- The Core API spec source is `./docs/core-api/openapi-spec-coreapi.json` (read-only).

## Engineering Defaults
- Prefer centralized helpers over ad-hoc duplicated objects.
- Keep response/data contracts consistent with existing shared schema/util functions.
- Before adding new fields/helpers, check for existing equivalents and reuse them; do not duplicate semantics under a new name.
- Keep naming consistent across code and config.
- Boolean fields and flags must start with `is` (example: `isAuthoritative`).
- Abbreviation casing rule:
  - If abbreviation appears after the first character, use all caps (example: `thisIsAAC`).
  - If abbreviation appears at the beginning of an identifier, use lowercase (example: `aacIsGood`).
- Runtime/internal time durations/values use `*MS` suffix.
- Environment variables may use `*_SECS` for operator readability; convert to `*MS` internally at runtime.
- TTL fields use `*TTL` (and `*TTLMS` where unit precision is needed).
- Environment variables use `SCREAMING_SNAKE_CASE`.
- App config keys also use `SCREAMING_SNAKE_CASE`.
- For ports, use `SERVER_PORT` naming (not generic `PORT`/`port`).
- Keep line width readable; target about 160 chars max unless existing file style differs.

## Local Commands and Fallbacks
- Run backend tests directly: `cd ./backend && source ~/.nvm/nvm.sh && npm test`
- Install backend dependencies: `cd ./backend && source ~/.nvm/nvm.sh && npm install`
- Install frontend dependencies: `cd ./frontend && source ~/.nvm/nvm.sh && npm install`
- If dependency install fails due to DNS/network restrictions, report the blocker explicitly and continue with static validation + file-level review, noting tests were not run.

## Config and Delivery Notes
- Runtime config is expected from `{project}.{mode}.appConfig.json`.
- Config should stay one-level deep with root sections (example: `SERVER`, `CORE_API`, `ASSEMBLYAI`, `DEEPGRAM`, `MEDIA`).
- Do not "search" across multiple potential config key aliases at runtime.
- If required config fields are missing or invalid, throw an error and terminate startup.
- CI/CD and deployment details are maintained in workflow files and docs; prefer updating docs when changing pipeline behavior.
- Treat secrets/tokens as build or runtime secrets only; do not hardcode credentials.

## Decision Rule
- For backend implementation details (routes, schemas, tests), follow `backend/AGENTS.md`.
