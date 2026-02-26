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
 * Analyze silence in an audio file using ffmpeg silencedetect.
 * @param {string} audioPath
 * @param {{noiseDB?:number,minSilenceSecs?:number}} [options]
 * @returns {Promise<{silenceIntervals:Array<{startMS:number,endMS:number,durationMS:number}>, totalSilenceMS:number, analyzedDurationMS:number, isSilenceAnalyzed:boolean, silenceAnalysisMeta:{noiseDB:number,minSilenceSecs:number,tool:string,analyzedAt:string}}>}
 */
export async function analyzeSilence(audioPath, options = {}) {
  const noiseDB = Number(options.noiseDB ?? -35);
  const minSilenceSecs = Number(options.minSilenceSecs ?? 2);

  const { stderr } = await execFileAsync('ffmpeg', [
    '-hide_banner',
    '-i', audioPath,
    '-af', `silencedetect=noise=${noiseDB}dB:d=${minSilenceSecs}`,
    '-f', 'null',
    '-'
  ]);

  const { silenceIntervals, totalSilenceMS } = parseSilenceDetectOutput(stderr || '');
  const analyzedDurationMS = extractAudioDurationMS(stderr || '');

  return {
    silenceIntervals,
    totalSilenceMS,
    analyzedDurationMS,
    isSilenceAnalyzed: true,
    silenceAnalysisMeta: {
      noiseDB,
      minSilenceSecs,
      tool: 'ffmpeg:silencedetect',
      analyzedAt: new Date().toISOString()
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

export default { analyzeSilence, parseSilenceDetectOutput };
