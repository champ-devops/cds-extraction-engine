# Plan: Multi-Provider Transcript Coalescing for Higher-Quality Captions

## Overview

Question: can we improve transcript and caption quality by running multiple speech-to-text providers and selecting the best word/utterance at each time span?

Short answer: yes, this is technically feasible. Whether it is worthwhile depends on measured quality lift vs added cost/latency/complexity.

This plan defines a staged feasibility evaluation and an implementation path that only proceeds if quality gains exceed clear thresholds.

**Status**: Planning

## Goals

1. Quantify transcript quality lift from multi-provider coalescing vs best single provider baseline.
2. Quantify downstream caption quality lift (readability, timing stability, error severity).
3. Establish operational impact (cost, latency, failure modes, maintenance burden).
4. Make a clear go/no-go decision using predefined acceptance thresholds.

## Non-Goals

1. Building a full transcript editor UI in this phase.
2. Solving speaker diarization identity matching across providers beyond practical baseline mapping.
3. Replacing all existing provider-specific ingestion paths immediately.

## Hypothesis

A weighted consensus approach (token/utterance alignment + confidence/source weighting + language-model tie-breaks) will reduce critical word errors enough to justify extra provider calls for selected high-value meetings.

## Feasibility Summary

### Technical feasibility

Feasible with current architecture by adding:
1. Multi-provider fan-out submission and result collection.
2. A normalized intermediate token timeline.
3. A coalescing engine to produce an authoritative merged transcript.

### Operational feasibility

Feasible if introduced behind feature flags and scoped to:
1. Pilot customers and/or meeting classes.
2. Asynchronous processing only (no strict real-time path).
3. Explicit fallback to a single provider on partial failure.

### Economic feasibility

Unknown until measured. Cost is expected to increase near-linearly with number of providers, while quality lift is likely sub-linear. This must be validated with representative meeting data.

## Proposed Approach

## 1) Normalize Provider Outputs

Create a shared token/utterance schema from AssemblyAI, Deepgram, Rev.ai, and any future provider:
1. `startTimeMS`, `endTimeMS`, `text`, `confidence`, `speakerLabel`, `provider`.
2. Optional token-level alternatives when available.
3. Consistent punctuation and number normalization rules.

## 2) Time + Text Alignment Layer

For overlapping utterance windows:
1. Align tokens by timestamp first, edit-distance second.
2. Build candidate sets for each aligned token slot.
3. Preserve punctuation and casing decisions separately from lexical token selection.

## 3) Coalescing Strategy (MVP)

Use deterministic weighted voting per aligned token slot:
1. Provider weight (`providerQualityWeight`) tuned from historical benchmark set.
2. Per-token confidence weight when provider emits token confidence.
3. Penalty for improbable token timing jumps.
4. Tie-break with lightweight language-model scoring only when needed.

If alignment confidence is low for a span:
1. Keep best baseline provider span unchanged.
2. Mark span metadata for later human review tooling.

## 4) Caption Generation Rules

Generate captions from merged transcript with existing caption constraints:
1. Cue length and CPS limits.
2. Stable line breaks.
3. Timing smoothing to avoid flicker.

## Evaluation Framework

## Datasets

1. Gold set: 30 to 50 meetings with human-corrected references (different accents, room acoustics, crosstalk, agenda styles).
2. Shadow set: 100+ production meetings without human references for operational metrics only.

## Metrics

### Transcript quality

1. WER and CER vs reference.
2. Proper noun accuracy (names, streets, ordinance IDs).
3. Numeric accuracy (votes, amounts, dates).
4. Critical error rate (errors that materially change meaning).

### Caption quality

1. Reading speed violations (CPS breaches).
2. Timing drift and overlap defects.
3. Human reviewer MOS score for readability.

### System metrics

1. End-to-end processing latency per meeting.
2. Cost per meeting and per transcript minute.
3. Failure rate and fallback invocation rate.

## Decision Gates (Worthwhile Criteria)

Proceed beyond pilot only if all are true:
1. At least 15% relative WER reduction vs best single-provider baseline on gold set.
2. At least 25% reduction in critical meaning-changing errors.
3. Caption readability score improvement of at least 0.3 MOS.
4. P95 processing latency increase remains within agreed SLA budget.
5. Added cost is acceptable for target tier (or can be gated to premium/high-value workflows).

If thresholds are not met, keep single-provider baseline and retain only reusable improvements (normalization + evaluation tooling).

## Implementation Plan

### Phase A: Benchmark Harness

1. Add evaluator module for WER/CER, proper-noun and numeric scoring.
2. Add repeatable provider-run orchestration on fixed audio corpus.
3. Produce baseline report by provider and meeting type.

Deliverable: benchmark report and calibrated per-provider quality weights.

### Phase B: Coalescing MVP

1. Implement normalized token timeline contract in `shared/`.
2. Implement alignment + weighted-vote coalescer in `backend/src/`.
3. Emit coalescing provenance metadata (winning provider per span, confidence).
4. Add single-provider fallback behavior.

Deliverable: merged transcript output for offline jobs.

### Phase C: Caption Validation

1. Feed merged transcript into existing caption generation path.
2. Compare caption defect metrics vs baseline.
3. Add regression tests for punctuation/timing stability.

Deliverable: caption quality comparison report.

### Phase D: Controlled Production Pilot

1. Feature flag: `isMultiProviderCoalescingEnabled` at customer/job level.
2. Roll out to limited pilot cohort.
3. Monitor quality, cost, latency, and incident rate weekly.

Deliverable: go/no-go recommendation and rollout policy.

## Architecture and Data Contract Additions

1. Add transcript variant model:
   - `variantType`: `RAW_PROVIDER` | `COALESCED`
   - `sourceProviders`: string[]
   - `isAuthoritative`: boolean
2. Add per-utterance provenance:
   - `selectedProvider`
   - `selectionScore`
   - `alternativeCandidates`
3. Persist evaluation artifacts separately from production transcript records.

## Risks and Mitigations

1. Misalignment across providers causes hallucinated merges.
   - Mitigation: conservative merge thresholds + span-level fallback to baseline provider.
2. Higher cost without meaningful quality gain.
   - Mitigation: strict decision gates and early stop after Phase B/C if gains are weak.
3. Increased pipeline latency.
   - Mitigation: async-only execution, provider timeout budgets, partial-result fallback.
4. Hard-to-debug outputs.
   - Mitigation: provenance metadata and deterministic scoring logs.
5. Vendor API variability.
   - Mitigation: provider adapters + schema normalization boundaries.

## Testing Strategy

1. Unit tests for alignment and token voting edge cases (insertions, deletions, crosstalk).
2. Contract tests for each provider parser to normalized token schema.
3. Integration tests for fallback behavior on provider timeout/failure.
4. Snapshot tests for caption output stability.

## Rollout Recommendation Model

If pilot succeeds, default policy should be selective, not universal:
1. Enable for meetings where quality risk is high (poor audio, legal sensitivity, high public visibility).
2. Keep single-provider mode for low-risk/low-budget workflows.
3. Allow customer-tier-based opt-in.

## Acceptance Criteria

1. Benchmark harness runs reproducibly and publishes comparable baseline/coalesced reports.
2. Coalescing output is deterministic for same inputs/config.
3. Pilot demonstrates threshold improvements defined in Decision Gates.
4. On failure or low confidence, system cleanly falls back without blocking publication.
5. Documentation updated for configuration, operations, and support troubleshooting.

## Open Questions

1. Which provider pair/set gives best quality-per-dollar for municipality meeting audio?
2. Should coalescing run pre- or post-speaker diarization normalization?
3. Should language-model tie-breaks be disabled for strict determinism in some customers?
4. What customer tiers can absorb added transcription costs?

## Immediate Next Step

Start Phase A with a representative gold dataset and baseline report. Make go/no-go on Phase B contingent on measurable cross-provider complementarity (not just small aggregate WER changes).
