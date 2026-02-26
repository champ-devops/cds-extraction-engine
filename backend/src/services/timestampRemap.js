/**
 * Build non-silent chunk map and remap chunk-relative timestamps back to original media timeline.
 */

/**
 * @typedef {{startMS:number,endMS:number,durationMS?:number}} SilenceInterval
 * @typedef {{startMS:number,endMS:number,durationMS:number}} NonSilentRange
 * @typedef {{chunkIndex:number,originalStartMS:number,originalEndMS:number,chunkStartMS:number,chunkEndMS:number,durationMS:number}} ChunkMapEntry
 */

/**
 * Normalize and merge overlapping silence intervals.
 * @param {SilenceInterval[]} silenceIntervals
 * @returns {SilenceInterval[]}
 */
export function normalizeSilenceIntervals(silenceIntervals = []) {
  const sorted = [...silenceIntervals]
    .filter(i => Number.isFinite(i.startMS) && Number.isFinite(i.endMS) && i.endMS >= i.startMS)
    .sort((a, b) => a.startMS - b.startMS);

  if (sorted.length === 0) {
    return [];
  }

  const merged = [];
  let current = { startMS: sorted[0].startMS, endMS: sorted[0].endMS };

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    if (next.startMS <= current.endMS) {
      current.endMS = Math.max(current.endMS, next.endMS);
      continue;
    }
    merged.push({
      startMS: current.startMS,
      endMS: current.endMS,
      durationMS: current.endMS - current.startMS
    });
    current = { startMS: next.startMS, endMS: next.endMS };
  }

  merged.push({
    startMS: current.startMS,
    endMS: current.endMS,
    durationMS: current.endMS - current.startMS
  });

  return merged;
}

/**
 * Build non-silent ranges as complement of silence intervals over analyzed duration.
 * @param {{silenceIntervals:SilenceInterval[], analyzedDurationMS:number, minChunkDurationMS?:number}} params
 * @returns {NonSilentRange[]}
 */
export function buildNonSilentRanges(params) {
  const { silenceIntervals, analyzedDurationMS, minChunkDurationMS = 500 } = params;
  const durationMS = Math.max(0, Number(analyzedDurationMS || 0));
  if (durationMS === 0) {
    return [];
  }

  const normalizedSilence = normalizeSilenceIntervals(silenceIntervals || []).map(i => ({
    startMS: Math.max(0, Math.min(durationMS, i.startMS)),
    endMS: Math.max(0, Math.min(durationMS, i.endMS))
  }));

  const ranges = [];
  let cursorMS = 0;

  for (const interval of normalizedSilence) {
    if (interval.startMS > cursorMS) {
      const startMS = cursorMS;
      const endMS = interval.startMS;
      const durationMSRange = endMS - startMS;
      if (durationMSRange >= minChunkDurationMS) {
        ranges.push({ startMS, endMS, durationMS: durationMSRange });
      }
    }
    cursorMS = Math.max(cursorMS, interval.endMS);
  }

  if (cursorMS < durationMS) {
    const startMS = cursorMS;
    const endMS = durationMS;
    const durationMSRange = endMS - startMS;
    if (durationMSRange >= minChunkDurationMS) {
      ranges.push({ startMS, endMS, durationMS: durationMSRange });
    }
  }

  return ranges;
}

/**
 * Build cumulative chunk map from non-silent ranges.
 * @param {NonSilentRange[]} nonSilentRanges
 * @returns {ChunkMapEntry[]}
 */
export function buildChunkMap(nonSilentRanges) {
  let runningChunkMS = 0;
  return nonSilentRanges.map((range, index) => {
    const chunkStartMS = runningChunkMS;
    const chunkEndMS = chunkStartMS + range.durationMS;
    runningChunkMS = chunkEndMS;
    return {
      chunkIndex: index,
      originalStartMS: range.startMS,
      originalEndMS: range.endMS,
      chunkStartMS,
      chunkEndMS,
      durationMS: range.durationMS
    };
  });
}

/**
 * High-level helper: build chunk map directly from silence intervals.
 * @param {{silenceIntervals:SilenceInterval[], analyzedDurationMS:number, minChunkDurationMS?:number}} params
 * @returns {ChunkMapEntry[]}
 */
export function buildChunkMapFromSilence(params) {
  const ranges = buildNonSilentRanges(params);
  return buildChunkMap(ranges);
}

/**
 * Plan segment submission from chunk map with max-segment guardrails.
 * @param {{chunkMap:ChunkMapEntry[], isChunkingEnabled:boolean, maxSegmentCount:number, maxSegmentDurationSecs?:number, segmentOverlapSecs?:number}} params
 * @returns {{segmentCount:number,isChunkingEnabled:boolean,submissionChunks:ChunkMapEntry[]}}
 */
export function planSegmentSubmission(params) {
  const {
    chunkMap,
    isChunkingEnabled,
    maxSegmentCount,
    maxSegmentDurationSecs = 3600,
    segmentOverlapSecs = 5
  } = params;
  const safeMaxSegmentCount = Math.max(1, Number(maxSegmentCount || 1));
  const maxSegmentDurationMS = Math.max(1, Math.round(Number(maxSegmentDurationSecs || 3600) * 1000));
  const segmentOverlapMS = Math.max(0, Math.round(Number(segmentOverlapSecs || 0) * 1000));
  const effectiveOverlapMS = Math.min(segmentOverlapMS, Math.max(0, maxSegmentDurationMS - 1));

  if (!isChunkingEnabled) {
    return {
      segmentCount: 1,
      isChunkingEnabled: false,
      submissionChunks: []
    };
  }

  if (!Array.isArray(chunkMap) || chunkMap.length === 0) {
    throw new Error('Chunking enabled but no non-silent chunks were generated');
  }

  const orderedInputChunks = [...chunkMap]
    .filter(chunk => Number.isFinite(chunk.originalStartMS) && Number.isFinite(chunk.originalEndMS) && chunk.originalEndMS > chunk.originalStartMS)
    .sort((a, b) => a.originalStartMS - b.originalStartMS);

  const splitChunks = [];
  for (const baseChunk of orderedInputChunks) {
    const baseDurationMS = baseChunk.originalEndMS - baseChunk.originalStartMS;
    if (baseDurationMS <= maxSegmentDurationMS) {
      splitChunks.push({
        originalStartMS: baseChunk.originalStartMS,
        originalEndMS: baseChunk.originalEndMS,
        durationMS: baseDurationMS
      });
      continue;
    }

    let segmentStartMS = baseChunk.originalStartMS;
    while (segmentStartMS < baseChunk.originalEndMS) {
      const segmentEndMS = Math.min(segmentStartMS + maxSegmentDurationMS, baseChunk.originalEndMS);
      splitChunks.push({
        originalStartMS: segmentStartMS,
        originalEndMS: segmentEndMS,
        durationMS: segmentEndMS - segmentStartMS
      });

      if (segmentEndMS >= baseChunk.originalEndMS) {
        break;
      }
      const nextStartMS = segmentEndMS - effectiveOverlapMS;
      segmentStartMS = nextStartMS > segmentStartMS ? nextStartMS : segmentEndMS;
    }
  }

  if (splitChunks.length > safeMaxSegmentCount) {
    throw new Error(`Segment count ${splitChunks.length} exceeds configured maxSegmentCount ${safeMaxSegmentCount}`);
  }

  let runningChunkMS = 0;
  const submissionChunks = splitChunks.map((chunk, index) => {
    const chunkStartMS = runningChunkMS;
    const chunkEndMS = chunkStartMS + chunk.durationMS;
    runningChunkMS = chunkEndMS;
    return {
      chunkIndex: index,
      originalStartMS: chunk.originalStartMS,
      originalEndMS: chunk.originalEndMS,
      chunkStartMS,
      chunkEndMS,
      durationMS: chunk.durationMS
    };
  });

  return {
    segmentCount: submissionChunks.length,
    isChunkingEnabled: true,
    submissionChunks
  };
}

/**
 * Remap chunk-relative timestamp to original media timeline.
 * @param {ChunkMapEntry[]} chunkMap
 * @param {number} chunkIndex
 * @param {number} chunkRelativeMS
 * @returns {number}
 */
export function remapMSFromChunk(chunkMap, chunkIndex, chunkRelativeMS) {
  const entry = chunkMap.find(c => c.chunkIndex === chunkIndex);
  if (!entry) {
    throw new Error(`Chunk index not found: ${chunkIndex}`);
  }
  if (!Number.isFinite(chunkRelativeMS)) {
    throw new Error(`Chunk-relative timestamp out of range for chunk ${chunkIndex}: ${chunkRelativeMS}`);
  }

  // Providers sometimes return timestamps with codec/rounding drift near chunk boundaries.
  // Deepgram can drift by ~1s on long chunks, so allow a small safety window and clamp.
  const boundaryToleranceMS = 2000;
  const minAllowedMS = 0 - boundaryToleranceMS;
  const maxAllowedMS = entry.durationMS + boundaryToleranceMS;
  if (chunkRelativeMS < minAllowedMS || chunkRelativeMS > maxAllowedMS) {
    throw new Error(`Chunk-relative timestamp out of range for chunk ${chunkIndex}: ${chunkRelativeMS}`);
  }

  const clampedRelativeMS = Math.max(0, Math.min(entry.durationMS, Math.round(chunkRelativeMS)));
  return entry.originalStartMS + clampedRelativeMS;
}

/**
 * Remap an utterance-like object with chunk-relative times.
 * @param {ChunkMapEntry[]} chunkMap
 * @param {{chunkIndex:number,startMS:number,endMS:number}} utterance
 * @returns {{startMS:number,endMS:number}}
 */
export function remapUtteranceFromChunk(chunkMap, utterance) {
  const startMS = remapMSFromChunk(chunkMap, utterance.chunkIndex, utterance.startMS);
  const endMS = remapMSFromChunk(chunkMap, utterance.chunkIndex, utterance.endMS);
  if (endMS < startMS) {
    throw new Error(`Remapped utterance has invalid range: ${startMS}..${endMS}`);
  }
  return { startMS, endMS };
}

export default {
  normalizeSilenceIntervals,
  buildNonSilentRanges,
  buildChunkMap,
  buildChunkMapFromSilence,
  planSegmentSubmission,
  remapMSFromChunk,
  remapUtteranceFromChunk
};
