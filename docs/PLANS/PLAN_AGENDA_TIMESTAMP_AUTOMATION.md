# Plan: Agenda Timestamp Automation (AI Multi-Provider)

## Overview

### Goal
Automatically map meeting agenda items to transcript timestamp ranges with a confidence score, using AI and a provider strategy similar to STT orchestration.

### Inputs (initial contract)
- `customerID`
- `cdsV1EventID`
- Optional override: `providerName` (`OPENAI`, `ANTHROPIC`, `DEEPSEEK`)

### Required data resolution
From `customerID + cdsV1EventID`, resolve:
1. `cdsMediaID` for the event media to process
2. Agenda items (title + description + ordering)
3. Transcript utterances (`extractionItems`) for the same `cdsMediaID`

### Output
A persisted mapping of agenda items to one or more timestamp spans:
- `agendaItemID`
- `startOffsetMS`
- `endOffsetMS`
- `confidence` (0..1)
- `evidenceUtteranceIDs` (for explainability and QA)

## Scope

### In scope
- Async job model similar to STT jobs
- Multi-provider AI adapter layer for OpenAI, Anthropic, DeepSeek
- Confidence scoring, validation, and persistence
- Human-review queue for low-confidence mappings
- Baseline support for repeated/revisited agenda items

### Out of scope (first pass)
- UI redesign for timeline editing
- Full model fine-tuning pipeline before baseline ships
- Attachment/vote-aware reasoning (can be added later)

## Proposed Job Contract

### Endpoint
- `POST /v1/timeline/jobs`

### Request body (initial)
```json
{
  "customerID": "string",
  "cdsV1EventID": "number",
  "providerName": "OPENAI",
  "options": {
    "isMultiProviderEnabled": true,
    "isHumanReviewRequiredOnLowConfidence": true,
    "minimumAutoAcceptConfidence": 0.75
  }
}
```

### Job states
- `QUEUED`
- `RUNNING`
- `COMPLETE`
- `FAILED`
- `REQUIRES_REVIEW`

### Result shape
```json
{
  "jobID": "ulid",
  "status": "COMPLETE",
  "timeline": [
    {
      "agendaItemID": "string",
      "startOffsetMS": 123456,
      "endOffsetMS": 234567,
      "confidence": 0.88,
      "confidenceLevel": "HIGH",
      "evidenceUtteranceIDs": ["u1", "u2"],
      "providerAttribution": {
        "selectedProvider": "OPENAI",
        "candidateProviders": ["OPENAI", "ANTHROPIC", "DEEPSEEK"]
      }
    }
  ]
}
```

## System Design

### 1) Data preparation
1. Resolve event/media context from Core API.
2. Fetch agenda items and normalize text (`title + description`).
3. Fetch utterances for the resolved `cdsMediaID`.
4. Build canonical utterance timeline (`startOffsetMS`, `endOffsetMS`, text, speaker if available).

### 2) Candidate window retrieval (agenda-guided)
For each agenda item:
1. Compute lexical matches (BM25/keyword overlap).
2. Compute semantic matches (embedding similarity on utterance windows).
3. Produce top candidate windows with coverage metadata.

This reduces token cost and improves precision by avoiding full-transcript prompting for every item.

### 3) AI inference layer (multi-provider)
Provider adapters:
- `openai`
- `anthropic`
- `deepseek`

Execution modes:
1. `SINGLE_PROVIDER` (cost-efficient default)
2. `FALLBACK` (retry with alternate provider on error/invalid schema)
3. `ENSEMBLE` (run 2-3 providers, then consensus)

Prompt contract:
- Agenda item text
- Candidate utterance windows
- Instructions to return strict JSON with timestamp spans and evidence utterance IDs

### 4) Consensus and confidence
If `ENSEMBLE`:
1. Compare provider spans by overlap IoU and evidence agreement.
2. Score with weighted blend:
   - Retrieval score
   - Provider self-confidence
   - Cross-provider agreement
   - Structural validity checks
3. Select best span(s), set `confidence`.

Confidence levels:
- `HIGH`: `confidence >= 0.85`
- `MEDIUM`: `0.70 <= confidence < 0.85`
- `LOW`: `< 0.70`

### 5) Validation and persistence
Validation rules:
1. `startOffsetMS < endOffsetMS`
2. Offsets within transcript bounds
3. Agenda order is mostly monotonic (allow controlled revisits)
4. No impossible overlap patterns unless flagged as revisit

Persistence:
- Store results as timeline extraction/items tied to transcript revision and `cdsMediaID`.
- Store provenance metadata (`selectedProvider`, alternatives, confidence factors).

## Historical Human Data Strategy

You already have years of human-entered timestamps; this is high-value supervision data.

### Phase A: Build labeled dataset (recommended first)
1. Collect historical meetings with:
   - agenda items
   - transcript utterances
   - human timestamp mappings
2. Normalize into a training/eval schema.
3. Split by municipality/time period into train/validation/test.

### Phase B: Use data before fine-tuning
1. Few-shot retrieval: inject similar historical examples into prompts.
2. Calibration model: train a lightweight scorer for confidence calibration and auto-accept thresholds.
3. Benchmark providers by real municipal data.

### Phase C: Optional fine-tuning
Only after baseline metrics stabilize:
1. Fine-tune a model for structured span extraction if net quality lift justifies ops cost.
2. Keep multi-provider fallback for resilience and vendor change tolerance.

## Phased Delivery

### Phase 1: MVP single-provider + fallback
- Implement job API and worker orchestration
- Implement data fetch + candidate retrieval + strict JSON parsing
- Support one primary provider and one fallback
- Persist timeline + confidence + evidence

Acceptance:
- End-to-end job completes for target events
- At least 80% agenda-item coverage on internal validation set

### Phase 2: Ensemble + confidence gating
- Add multi-provider consensus mode
- Add `REQUIRES_REVIEW` state for low confidence
- Add reviewer-facing reason codes

Acceptance:
- Reduce low-confidence false positives vs Phase 1 baseline
- Stable job success rate with provider outages

### Phase 3: Historical-data optimization
- Build benchmark harness and scorecards
- Add few-shot retrieval from historical examples
- Add calibration model for confidence quality

Acceptance:
- Demonstrable precision/recall lift on held-out historical data
- Reduced manual correction rate

## Metrics

### Quality
- Agenda item coverage (% mapped)
- Mean span IoU vs human labels
- Precision/recall for "item discussed vs not discussed"
- Manual correction rate per meeting

### Reliability
- Job success rate
- Schema-parse failure rate by provider
- Fallback invocation rate

### Cost and latency
- Cost per processed meeting
- P50/P95 job duration
- Token usage by provider and phase

## Risks and Mitigations

1. Long meetings exceed context limits.
- Mitigation: retrieval-first chunking + windowed prompting.

2. Provider JSON drift/hallucinated schema.
- Mitigation: strict schema validator + automatic retry/fallback.

3. Low confidence despite valid output.
- Mitigation: human-review queue and confidence calibration.

4. Inconsistent agenda semantics across municipalities.
- Mitigation: historical-example retrieval scoped by customer/event type.

## Recommended Immediate Next Steps

1. Confirm the exact persisted destination for timeline outputs (existing extraction kind vs new kind).
2. Define the first benchmark set (for example 50 meetings across 5 customers with human timestamps).
3. Implement Phase 1 with `OPENAI` primary and `ANTHROPIC` fallback, then add DeepSeek in Phase 2 ensemble mode.
