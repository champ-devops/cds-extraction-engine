import { expect } from 'chai';
import { parseSilenceDetectOutput, parseVolumedetectOutput } from '../src/services/silenceDetection.js';

describe('Silence detection parser', () => {
  it('parses silence intervals from ffmpeg silencedetect output', () => {
    const ffmpegOutput = `
Duration: 00:10:00.00, start: 0.000000, bitrate: 128 kb/s
[silencedetect @ 0x123] silence_start: 2.000
[silencedetect @ 0x123] silence_end: 5.500 | silence_duration: 3.500
[silencedetect @ 0x123] silence_start: 15.250
[silencedetect @ 0x123] silence_end: 16.000 | silence_duration: 0.750
`;

    const result = parseSilenceDetectOutput(ffmpegOutput);
    expect(result.silenceIntervals).to.deep.equal([
      { startMS: 2000, endMS: 5500, durationMS: 3500 },
      { startMS: 15250, endMS: 16000, durationMS: 750 }
    ]);
    expect(result.totalSilenceMS).to.equal(4250);
  });

  it('ignores malformed intervals and returns empty result when no pairs exist', () => {
    const ffmpegOutput = `
[silencedetect @ 0x123] silence_start: abc
[silencedetect @ 0x123] something_else: 4.1
`;

    const result = parseSilenceDetectOutput(ffmpegOutput);
    expect(result.silenceIntervals).to.deep.equal([]);
    expect(result.totalSilenceMS).to.equal(0);
  });

  it('parses volumedetect output into metadata keys/values', () => {
    const ffmpegOutput = `
[Parsed_volumedetect_0 @ 0x560641287a80] n_samples: 834295808
[Parsed_volumedetect_0 @ 0x560641287a80] mean_volume: -40.3 dB
[Parsed_volumedetect_0 @ 0x560641287a80] max_volume: -3.7 dB
[Parsed_volumedetect_0 @ 0x560641287a80] histogram_3db: 80
[Parsed_volumedetect_0 @ 0x560641287a80] histogram_4db: 61
[Parsed_volumedetect_0 @ 0x560641287a80] histogram_21db: 375479
`;

    const result = parseVolumedetectOutput(ffmpegOutput);
    expect(result).to.deep.equal({
      n_samples: 834295808,
      mean_volume: '-40.3 dB',
      max_volume: '-3.7 dB',
      histogram_3db: 80,
      histogram_4db: 61,
      histogram_21db: 375479
    });
  });
});
