# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Commands

All commands run from `./backend/`. If `nvm` is needed:

```bash
cd ./backend && source ~/.nvm/nvm.sh && npm test
```

| Task | Command (from `./backend/`) |
|---|---|
| Run all tests | `npm test` |
| Run a single test | `npm test -- --grep "description text"` |
| Dev server (hot reload) | `npm run dev` |
| Production server | `npm start` |

Test files live in `backend/tests/` and are named `<scope>.<name>.test.js`
(e.g., `services.transcriptIngestion.test.js`, `parsers.srt.test.js`).

---

## Architecture

### Three Ingestion Paths

All three enter through `backend/src/routes/ingest.js` and are handled by `backend/src/services/transcriptIngestion.js`:

1. **`POST /ingest/provider-json`** — Import a completed transcript JSON from AssemblyAI, Deepgram, or Rev.ai. Runs synchronously: parse → normalize → persist.

2. **`POST /ingest/caption-file`** — Import an SRT or VTT caption file. Same synchronous flow.

3. **`POST /ingest/transcribe-media`** — Download media → extract AAC → optionally chunk → submit to provider → queue a poll job (for AssemblyAI and Rev.ai) or finalize inline (Deepgram returns synchronously).

### Job Queue

The service uses `@champds/cds-job-queue`. The worker (`backend/src/queue/worker.js`) listens for jobs on the queue and dispatches to service functions. The key async job type is `transcription-poll`, which is processed by `backend/src/services/transcriptionPoll.js`. Polls check provider status; on completion they call through to `transcriptionFinalize.js`.

### Chunked Audio Pipeline

When silence-based chunking is enabled, `backend/src/services/silenceDetection.js` uses ffmpeg to find silence intervals. The audio is split into segments, each submitted to the provider independently. On finalization, `backend/src/services/timestampRemap.js` builds a chunk map and `backend/src/services/chunkReassembly.js` merges provider responses back into a single normalized transcript with corrected timestamps.

### Parser Layer

`backend/src/parsers/index.js` auto-detects provider format and routes to the appropriate parser:
- `assemblyai.js` — detects via `acoustic_model` + `language_model` fields
- `deepgram.js` — detects via `metadata` + `results.channels`
- `revai.js` — detects via `monologues` array
- `srt.js` — handles both SRT and VTT

All parsers normalize output to the same utterance shape: `{ speakerOriginal, textOriginal, startMS, endMS, confidence, segmentIndex, textOriginalSource }`.

Time units: AssemblyAI returns milliseconds. Deepgram and Rev.ai return seconds — parsers multiply by 1000.

### Provider Option Builders

In `transcriptIngestion.js`, each provider has a `buildXxxProviderOptions(options)` function that maps internal options (e.g., `keyTerms`, `isDiarizationEnabled`, `speakerCountExpected`) to provider-specific API fields. Provider capabilities that don't apply emit named warning strings (e.g., `REVAI_IGNORED_SPEAKER_COUNT_HINTS`) rather than throwing.

---

## Key Conventions

These supplement `AGENTS.md` (root and `backend/`) which also applies.

**ES Modules**: `backend/` uses `"type": "module"`. All `.js` files use `import`/`export`. The test setup file is `.cjs` (required by mocha's `--require`).

**Config loading**: Config is read from `{CDS_PROJECT_NAME}.{CDS_RELEASEMODE}.appConfig.json`. The default is `cds-extraction-engine.development.appConfig.json`. Override with `CDS_CONFIG_PATH`. Config sections stay one level deep (e.g., `config.transcription.assemblyai.apiKey`). Missing required config throws at startup — no partial configs.

**Provider names**: Always uppercase: `ASSEMBLYAI`, `DEEPGRAM`, `REVAI`, `SRT`, `VTT`. `textOriginalSource` values are prefixed: `AUTOGEN:ASSEMBLYAI`, `AUTOGEN:DEEPGRAM`, etc.

**Warning codes**: Named `SCREAMING_SNAKE_CASE` strings returned in `providerWarnings[]` arrays. Never silent failures — always emit a warning code when a caller option is ignored or truncated.

**Fastify routes**:
- Route schemas document only success response codes (200, 201). Do NOT add error response schemas — errors are handled by the centralized global error handler.
- Use shared schema references; do not hardcode response shapes inline in routes.
- ULID pattern: `^[0-9A-HJKMNP-TV-Z]{26}$`

**Tests**:
- Framework: Mocha + Chai (`expect` style)
- Use `before()` hooks for shared setup, never per-test setup of shared state
- Tests that create their own Fastify instances must call `setupTestErrorHandler(app)` (from `tests/utils/testErrorHandler.js`) so validation errors return 400 instead of 500
- Use real `ulid()` values for synthetic IDs in tests

**Naming** (see `AGENTS.md` for full rules): booleans start with `is`; time durations use `*MS` suffix internally (env vars may use `*_SECS`); env vars are `SCREAMING_SNAKE_CASE`.
