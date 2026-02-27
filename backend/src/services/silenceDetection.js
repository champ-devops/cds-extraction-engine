import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Parse ffmpeg silencedetect output into normalized silence intervals.
 * @param {string} ffmpegOutput
 * @returns {{silenceIntervals: Array<{startMS:number,endMS:number,durationMS:number}>, totalSilenceMS:number}}
 */
export function parseSilenceDetectOutput(ffmpegOutput) {
  const silenceStartMatches = [...ffmpegOutput.matchAll(/silence_start:\s*([0-9]*\.?[0-9]+)/g)];
  const silenceEndMatches = [...ffmpegOutput.matchAll(/silence_end:\s*([0-9]*\.?[0-9]+)\s*\|\s*silence_duration:\s*([0-9]*\.?[0-9]+)/g)];

  const silenceIntervals = [];
  const intervalCount = Math.min(silenceStartMatches.length, silenceEndMatches.length);

  for (let i = 0; i < intervalCount; i++) {
    const startSecs = Number(silenceStartMatches[i][1]);
    const endSecs = Number(silenceEndMatches[i][1]);
    const durationSecs = Number(silenceEndMatches[i][2]);

    const startMS = Math.round(startSecs * 1000);
    const endMS = Math.round(endSecs * 1000);
    const durationMS = Math.round(durationSecs * 1000);

    if (Number.isFinite(startMS) && Number.isFinite(endMS) && Number.isFinite(durationMS) && endMS >= startMS) {
      silenceIntervals.push({ startMS, endMS, durationMS });
    }
  }

  const totalSilenceMS = silenceIntervals.reduce((sum, interval) => sum + interval.durationMS, 0);
  return { silenceIntervals, totalSilenceMS };
}

/**
 * Parse ffmpeg volumedetect output into key/value metadata.
 * @param {string} ffmpegOutput
 * @returns {Record<string, string|number>}
 */
export function parseVolumedetectOutput(ffmpegOutput) {
  const result = {};
  const lines = String(ffmpegOutput || '').split('\n');

  for (const line of lines) {
    const match = line.match(/\[Parsed_volumedetect_[^\]]+\]\s*([a-z0-9_]+):\s*(.+)\s*$/i);
    if (!match) {
      continue;
    }
    const key = String(match[1] || '').trim();
    const rawValue = String(match[2] || '').trim();
    if (!key || !rawValue) {
      continue;
    }

    if (key === 'n_samples' || key.startsWith('histogram_')) {
      const parsedNumber = Number(rawValue);
      result[key] = Number.isFinite(parsedNumber) ? parsedNumber : rawValue;
      continue;
    }

    result[key] = rawValue;
  }

  return result;
}

/**
 * Summarize silence interval durations for metadata.
 * @param {Array<{durationMS:number}>} silenceIntervals
 * @returns {{totalDetectedSilenceCount:number,minDetectedSilenceLengthMS:number,maxDetectedSilenceLengthMS:number}}
 */
export function summarizeSilenceIntervals(silenceIntervals = []) {
  if (!Array.isArray(silenceIntervals) || silenceIntervals.length === 0) {
    return {
      totalDetectedSilenceCount: 0,
      minDetectedSilenceLengthMS: 0,
      maxDetectedSilenceLengthMS: 0
    };
  }

  const detectedDurationsMS = silenceIntervals
    .map((interval) => Number(interval?.durationMS))
    .filter((durationMS) => Number.isFinite(durationMS) && durationMS >= 0);

  if (detectedDurationsMS.length === 0) {
    return {
      totalDetectedSilenceCount: 0,
      minDetectedSilenceLengthMS: 0,
      maxDetectedSilenceLengthMS: 0
    };
  }

  return {
    totalDetectedSilenceCount: detectedDurationsMS.length,
    minDetectedSilenceLengthMS: Math.min(...detectedDurationsMS),
    maxDetectedSilenceLengthMS: Math.max(...detectedDurationsMS)
  };
}

/**
 * Analyze silence in an audio file using ffmpeg silencedetect.
 * @param {string} audioPath
 * @param {{noiseDB?:number,minSilenceSecs?:number}} [options]
 * @returns {Promise<{silenceIntervals:Array<{startMS:number,endMS:number,durationMS:number}>, totalSilenceMS:number, mediaDurationMS:number, analyzedAt:string, isSilenceAnalyzed:boolean, volumedetectMeta:Record<string,string|number>, silenceAnalysisMeta:{noiseDB:number,minSilenceSecs:number,totalDetectedSilenceCount:number,minDetectedSilenceLengthMS:number,maxDetectedSilenceLengthMS:number,tool:string}}>}
 */
export async function analyzeSilence(audioPath, options = {}) {
  const noiseDB = Number(options.noiseDB ?? -35);
  const minSilenceSecs = Number(options.minSilenceSecs ?? 2);

  const { stderr } = await execFileAsync('ffmpeg', [
    '-hide_banner',
    '-vn',
    '-i', audioPath,
    '-af', `silencedetect=noise=${noiseDB}dB:d=${minSilenceSecs},volumedetect`,
    '-f', 'null',
    '-'
  ]);

  const { silenceIntervals, totalSilenceMS } = parseSilenceDetectOutput(stderr || '');
  const mediaDurationMS = extractAudioDurationMS(stderr || '');
  const detectedSilenceStats = summarizeSilenceIntervals(silenceIntervals);
  const volumedetectMeta = {
    ...parseVolumedetectOutput(stderr || ''),
    tool: 'ffmpeg:volumedetect'
  };
  const analyzedAt = new Date().toISOString();

  return {
    silenceIntervals,
    totalSilenceMS,
    mediaDurationMS,
    analyzedAt,
    isSilenceAnalyzed: true,
    volumedetectMeta,
    silenceAnalysisMeta: {
      noiseDB,
      minSilenceSecs,
      totalDetectedSilenceCount: detectedSilenceStats.totalDetectedSilenceCount,
      minDetectedSilenceLengthMS: detectedSilenceStats.minDetectedSilenceLengthMS,
      maxDetectedSilenceLengthMS: detectedSilenceStats.maxDetectedSilenceLengthMS,
      tool: 'ffmpeg:silencedetect'
    }
  };
}

function extractAudioDurationMS(ffmpegOutput) {
  const durationMatch = ffmpegOutput.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}\.?\d*)/);
  if (!durationMatch) {
    return 0;
  }

  const hours = Number(durationMatch[1]);
  const minutes = Number(durationMatch[2]);
  const seconds = Number(durationMatch[3]);
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

export default { analyzeSilence, parseSilenceDetectOutput, parseVolumedetectOutput, summarizeSilenceIntervals };
