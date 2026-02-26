import { expect } from 'chai';
import {
  normalizeSilenceIntervals,
  buildNonSilentRanges,
  buildChunkMapFromSilence,
  planSegmentSubmission,
  remapMSFromChunk,
  remapUtteranceFromChunk
} from '../src/services/timestampRemap.js';

describe('Timestamp remap utility', () => {
  it('normalizes and merges overlapping silence intervals', () => {
    const normalized = normalizeSilenceIntervals([
      { startMS: 5000, endMS: 7000 },
      { startMS: 1000, endMS: 2000 },
      { startMS: 6500, endMS: 9000 }
    ]);

    expect(normalized).to.deep.equal([
      { startMS: 1000, endMS: 2000, durationMS: 1000 },
      { startMS: 5000, endMS: 9000, durationMS: 4000 }
    ]);
  });

  it('builds non-silent ranges from silence + duration', () => {
    const ranges = buildNonSilentRanges({
      silenceIntervals: [
        { startMS: 2000, endMS: 4000 },
        { startMS: 7000, endMS: 8000 }
      ],
      analyzedDurationMS: 10000
    });

    expect(ranges).to.deep.equal([
      { startMS: 0, endMS: 2000, durationMS: 2000 },
      { startMS: 4000, endMS: 7000, durationMS: 3000 },
      { startMS: 8000, endMS: 10000, durationMS: 2000 }
    ]);
  });

  it('builds chunk map and remaps chunk-relative timestamps to original timeline', () => {
    const chunkMap = buildChunkMapFromSilence({
      silenceIntervals: [
        { startMS: 2000, endMS: 4000 },
        { startMS: 7000, endMS: 8000 }
      ],
      analyzedDurationMS: 10000
    });

    expect(chunkMap).to.have.length(3);
    expect(chunkMap[0]).to.include({ chunkIndex: 0, originalStartMS: 0, originalEndMS: 2000, chunkStartMS: 0, chunkEndMS: 2000 });
    expect(chunkMap[1]).to.include({ chunkIndex: 1, originalStartMS: 4000, originalEndMS: 7000, chunkStartMS: 2000, chunkEndMS: 5000 });
    expect(chunkMap[2]).to.include({ chunkIndex: 2, originalStartMS: 8000, originalEndMS: 10000, chunkStartMS: 5000, chunkEndMS: 7000 });

    expect(remapMSFromChunk(chunkMap, 1, 250)).to.equal(4250);

    const remappedUtterance = remapUtteranceFromChunk(chunkMap, {
      chunkIndex: 2,
      startMS: 100,
      endMS: 900
    });
    expect(remappedUtterance).to.deep.equal({ startMS: 8100, endMS: 8900 });
  });

  it('throws when remapping out-of-bounds chunk-relative timestamps', () => {
    const chunkMap = buildChunkMapFromSilence({
      silenceIntervals: [{ startMS: 1000, endMS: 2000 }],
      analyzedDurationMS: 3000
    });

    expect(() => remapMSFromChunk(chunkMap, 0, 5000)).to.throw(/out of range/i);
  });

  it('clamps tiny boundary drift when remapping chunk-relative timestamps', () => {
    const chunkMap = buildChunkMapFromSilence({
      silenceIntervals: [{ startMS: 1000, endMS: 2000 }],
      analyzedDurationMS: 3000
    });

    // chunk 0 duration is 1000ms; allow small rounding drift above boundary.
    expect(remapMSFromChunk(chunkMap, 0, 1019)).to.equal(1000);
  });

  it('clamps Deepgram-like boundary drift on long chunks', () => {
    const chunkMap = [
      {
        chunkIndex: 0,
        originalStartMS: 0,
        originalEndMS: 3600000,
        chunkStartMS: 0,
        chunkEndMS: 3600000,
        durationMS: 3600000
      }
    ];

    // Seen in production: provider returns ~1.165s over a 1-hour chunk boundary.
    expect(remapMSFromChunk(chunkMap, 0, 3601165)).to.equal(3600000);
  });

  it('plans chunk submission and enforces max segment count', () => {
    const chunkMap = buildChunkMapFromSilence({
      silenceIntervals: [
        { startMS: 1000, endMS: 1500 },
        { startMS: 2000, endMS: 2500 }
      ],
      analyzedDurationMS: 4000
    });

    const plan = planSegmentSubmission({
      chunkMap,
      isChunkingEnabled: true,
      maxSegmentCount: 5
    });
    expect(plan.segmentCount).to.equal(chunkMap.length);
    expect(plan.submissionChunks).to.have.length(chunkMap.length);

    expect(() => planSegmentSubmission({
      chunkMap,
      isChunkingEnabled: true,
      maxSegmentCount: 1
    })).to.throw(/exceeds configured maxSegmentCount/i);
  });

  it('splits large chunks by max duration and applies overlap', () => {
    const chunkMap = [
      { chunkIndex: 0, originalStartMS: 0, originalEndMS: 9000000, chunkStartMS: 0, chunkEndMS: 9000000, durationMS: 9000000 }
    ];

    const plan = planSegmentSubmission({
      chunkMap,
      isChunkingEnabled: true,
      maxSegmentCount: 10,
      maxSegmentDurationSecs: 3600,
      segmentOverlapSecs: 5
    });

    expect(plan.segmentCount).to.equal(3);
    expect(plan.submissionChunks[0]).to.include({ originalStartMS: 0, originalEndMS: 3600000 });
    expect(plan.submissionChunks[1]).to.include({ originalStartMS: 3595000, originalEndMS: 7195000 });
    expect(plan.submissionChunks[2]).to.include({ originalStartMS: 7190000, originalEndMS: 9000000 });
  });

  it('uses submission chunk map indexes after split', () => {
    const chunkMap = [
      { chunkIndex: 0, originalStartMS: 0, originalEndMS: 8000000, chunkStartMS: 0, chunkEndMS: 8000000, durationMS: 8000000 }
    ];

    const plan = planSegmentSubmission({
      chunkMap,
      isChunkingEnabled: true,
      maxSegmentCount: 10,
      maxSegmentDurationSecs: 3600,
      segmentOverlapSecs: 5
    });

    expect(plan.submissionChunks.map(c => c.chunkIndex)).to.deep.equal([0, 1, 2]);
  });
});
