# Overall Project Plan: CDS Automated Minutes

## Executive Summary

This document outlines the phased approach to building the CDS Automated Minutes system. The goal is to leverage AI to produce meeting minutes for public meetings based on agenda items, transcripts, and eventually votes and attachments.

The project is divided into phases to allow for incremental delivery of value while building toward the complete system.

---

## Vision

Transform the municipal meeting minutes process from a labor-intensive manual task into an AI-assisted workflow that:
- Automatically transcribes meeting audio/video
- Aligns transcript utterances to agenda items
- Generates summaries at multiple granularities
- Produces accessible audio descriptions
- Supports multiple output formats for clerk workflows

---

## Phase Overview

| Phase | Focus | Primary Deliverable | Dependencies |
|-------|-------|---------------------|--------------|
| **Phase 1** | Transcript Ingestion | Working `/ingest` endpoints for all 3 paths | CoreAPI connection |
| **Phase 1.5** | Silence Detection Preprocessing | Mandatory silence map + optional non-silent chunking per media file | Phase 1 Path 2 media acquisition |
| **Phase 2** | AI Timeline Generation | Agenda-to-timestamp alignment via AI | Phase 1 + Agenda data |
| **Phase 3** | Transcript Editing + Captions | Editable transcript + generated SRT/VTT with re-generation | Phase 1 |
| **Phase 4** | Summary Generation | Per-item and meeting-wide summaries | Phase 2 + Phase 3 |
| **Phase 5** | Minutes Output Modes | All 5 display formats for clerks | Phase 4 |
| **Phase 6** | Accessibility Audio | Silence detection + audio description track | Phase 1 + Phase 5 |
| **Phase 7** | Additional AI Providers | DeepSeek, Kimi, Gemini, Ollama support | Phase 2 |
| **Phase 8** | Voting & Attachments | Integration with voting system and attachments | Phase 4 |

---

## Phase 1: Transcript Ingestion (CURRENT)

**Goal**: Establish the foundation for all transcript-related operations.

**Scope**:
- Path 1: Provider JSON Import (AssemblyAI, DeepGram)
- Path 2: Media-Based Transcription (async)
- Path 3: Caption File Import (SRT/VTT)
- CoreAPI client integration for persistence
- Parser library for multiple provider formats

**Detailed Plan**: See `PLAN_PHASE_1.md`

---

## Phase 1.5: Silence Detection Preprocessing

**Goal**: Run silence detection on every transcription media file before provider submission to improve reliability, quality, and downstream accessibility data.

**Scope**:
- Analyze each AAC file using configurable silence thresholds
- Persist silence intervals (startMS/endMS/durationMS) as metadata linked to transcript/media
- Optionally split into non-silent chunks for provider submission
- Re-map chunk-relative transcription timestamps back to original full-media timeline

**Key Decisions**:
- Silence analysis is mandatory for every file (even when not chunking)
- Keep chunking configurable per provider/customer while preserving a single canonical timeline
- Re-timing correctness is a hard requirement before timeline/summaries generation

**Estimated Effort**: Medium

---

## Phase 2: AI Timeline Generation

**Goal**: Automatically align agenda items to transcript timestamps using AI.

**Scope**:
- Provider adapter interface (OpenAI, Claude initially)
- Prompt builder with meeting context
- Response parser with structured output validation
- Timeline generation endpoint (`POST /v1/timeline/generate`)
- Job queue for async processing
- Output validation rules
- Confidence scoring

**Key Decisions**:
- Start with "Agenda-Guided Search" chunking strategy (Option C from PLAN_AI_INTERPOLATION.md)
- Initial providers: OpenAI GPT-4o and Anthropic Claude 3.5/4
- Confidence threshold: 0.7 for auto-accept

**Estimated Effort**: Medium-High

---

## Phase 3: Transcript Editing + Captions

**Goal**: Support human correction of diarized transcripts and keep closed captions synchronized with transcript edits.

**Scope**:
- Transcript editing APIs (single utterance and bulk speaker rename)
- Caption hint ingestion with authoritative human-caption flag
- Preserve `textOriginal`/`speakerOriginal` while writing edits to `textModified`/`speakerModified`
- Track transcript revision/version metadata to support downstream consistency
- Caption generation endpoint for SRT/VTT from current transcript revision
- Caption cache/invalidation strategy based on transcript `modifiedAt` (or revision)
- Filesystem storage and retrieval for generated captions

**Key Decisions**:
- Treat transcript edits as first-class data (not destructive overwrite)
- If captions are provided, mark them as authoritative and use them as hints during reconciliation
- If transcript is not provided, generate transcript from media via normal provider flow
- Regenerate captions when transcript revision changes
- Expose caption metadata (`format`, `generatedAt`, `transcriptRevision`) for audit/debugging

**Estimated Effort**: Medium

**Detailed Plan**: See `PLAN_PHASE_3_TRANSCRIPT_EDITING_CAPTIONS.md`

---

## Phase 4: Summary Generation

**Goal**: Generate readable summaries from aligned transcript segments.

**Scope**:
- Per-agenda-item summaries
- Meeting-wide summary (key themes, decisions, next steps)
- Summary generation endpoint
- Configurable verbosity levels
- Human review/edit capability

**Key Decisions**:
- Reuse AI provider infrastructure from Phase 2
- Store summaries with version history for human edits

**Estimated Effort**: Medium

---

## Phase 5: Minutes Output Modes

**Goal**: Provide all 5 display formats required by clerks.

**Scope**:
- Clerk Minutes (blank template)
- Action Minutes (votes only - placeholder until Phase 8)
- Summary Minutes (mini-summaries with optional votes)
- Full Transcript (speech-to-text by timestamp)
- Hybrid (configurable combination)
- Export formats (PDF, DOCX, HTML)

**Key Decisions**:
- Template-based generation for flexibility
- Clerk can select active format in UI

**Estimated Effort**: Medium

---

## Phase 6: Accessibility Audio

**Goal**: Improve accessibility with audio descriptions of silence and agenda context.

**Scope**:
- Silence detection in media
- Text-to-speech generation for descriptions
- Audio track generation (mp4/aac)
- Configurable options:
  - Silence descriptions ("There is silence now for the next 2 minutes...")
  - Agenda item announcements at timestamps
  - Attachment descriptions

**Key Decisions**:
- TTS provider selection (likely cloud-based)
- Silence threshold configuration

**Estimated Effort**: Medium

---

## Phase 7: Additional AI Providers

**Goal**: Expand AI provider options for cost/performance optimization.

**Scope**:
- DeepSeek provider
- Kimi (Moonshot) provider
- Google Gemini provider
- Ollama/local model provider
- Provider comparison tooling
- Customer-configurable provider selection

**Key Decisions**:
- Maintain consistent interface across providers
- Allow per-customer provider configuration

**Estimated Effort**: Low-Medium (per provider)

---

## Phase 8: Voting & Attachments Integration

**Goal**: Complete the minutes experience with votes and attachment context.

**Scope**:
- Voting system API integration
- Vote data in Action Minutes
- Agenda attachment metadata
- Attachment context in AI prompts (improves matching accuracy)
- Attachment descriptions in accessibility audio

**Key Decisions**:
- API contract with voting system
- Attachment storage/retrieval strategy

**Estimated Effort**: Medium

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────-────┐
│                           CDS Automated Minutes                              │
├─────────────────────────────────────────────────────────────────────-────────┤
│                                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                    │
│  │   Ingest     │    │   Timeline   │    │   Summary    │                    │
│  │   Service    │───>│   Service    │───>│   Service    │                    │
│  │  (Phase 1)   │    │  (Phase 2)   │    │  (Phase 4)   │                    │
│  └──────────────┘    └──────────────┘    └──────────────┘                    │
│         │                   │                   │                            │
│         v                   v                   v                            │
│  ┌──────────────────────────────────────────────────────────────────┐        │
│  │                         CoreAPI                                  │        │
│  │  transcripts | transcriptUtterances | timeline | summaries       │        │
│  │  transcriptRevisions | captionMetadata                           │        │
│  └──────────────────────────────────────────────────────────────────┘        │
│         │                   │                   │                            │
│         v                   v                   v                            │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                    │
│  │   Minutes    │    │ Accessibility│    │    PlayAPI   │                    │
│  │   Output     │    │    Audio     │    │  (Agenda +   │                    │
│  │  (Phase 5)   │    │  (Phase 6)   │    │   Events)    │                    │
│  └──────────────┘    └──────────────┘    └──────────────┘                    │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────-───┘
```

---

## Data Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Media     │     │ Transcription│    │  Transcript │     │  Utterances │
│   File      │────>│   Provider   │───>│   Ingest    │────>│   CoreAPI   │
│             │     │ (AssemblyAI/ │    │   Service   │     │   Storage   │
│             │     │  DeepGram)   │    │             │     │             │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                                                                   │
                                                                   v
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Agenda    │     │   Timeline  │     │    AI       │     │  Timeline   │
│   Items     │────>│  Generation │<────│  Provider   │────>│   Entries   │
│  (PlayAPI)  │     │   Service   │     │ (GPT/Claude)│     │   CoreAPI   │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                                                                   │
                                                                   v
                                        ┌─────────────┐     ┌─────────────┐
                                        │   Summary   │     │   Minutes   │
                                        │  Generation │────>│   Output    │
                                        │             │     │   Formats   │
                                        └─────────────┘     └─────────────┘
```

---

## Technology Stack

| Component | Technology | Notes |
|-----------|------------|-------|
| Runtime | Node.js | Current codebase |
| Framework | Fastify | Current codebase |
| Database | MongoDB via CoreAPI | Existing infrastructure |
| Transcription | AssemblyAI, DeepGram | Initial providers |
| AI Models | OpenAI, Anthropic | Initial providers |
| Job Queue | TBD | Bull/BullMQ recommended |
| TTS | TBD | For accessibility audio |

---

## Success Metrics

| Phase | Metric | Target |
|-------|--------|--------|
| Phase 1 | Transcripts ingested successfully | 95%+ |
| Phase 2 | Timeline accuracy (vs human baseline) | 85%+ |
| Phase 2 | Items requiring human correction | <20% |
| Phase 3 | Caption freshness after transcript edit | 100% regenerated before publish |
| Phase 3 | Bulk speaker rename correctness | 99%+ utterances updated as requested |
| Phase 4 | Summary quality (clerk approval) | 80%+ |
| Phase 5 | Minutes generation time | <30 seconds |
| Phase 6 | Accessibility track accuracy | 95%+ |

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| AI hallucination in timestamps | High | Validation rules, confidence thresholds, human review |
| Provider API changes | Medium | Adapter pattern, version pinning |
| Long meetings exceed context limits | Medium | Chunking strategies (sliding window, agenda-guided) |
| Cost of AI API calls | Medium | Local model option, caching, smart chunking |
| Transcript quality varies | Medium | Multiple provider support, quality scoring |

---

## Next Steps

1. Complete Phase 1 implementation (see `PLAN_PHASE_1.md`)
2. Finalize transcript revision model needed by timeline, summaries, and captions
3. Validate end-to-end flow with sample meeting data
4. Begin Phase 2 design with production transcript data
5. Establish baseline metrics for timeline accuracy

---

## Related Documents

- `PLAN_PHASE_1.md` - Detailed Phase 1 implementation plan
- `PLAN_PHASE_3_TRANSCRIPT_EDITING_CAPTIONS.md` - Transcript editing and caption lifecycle plan
- `PLAN_AI_INTERPOLATION.md` - AI interpolation design document
- `API-ENDPOINTS.md` - API documentation
- `PROVIDER-FORMATS.md` - Transcription provider format details
