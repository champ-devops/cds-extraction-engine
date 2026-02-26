import { expect } from 'chai';
import { isSRTFormat, isVTTFormat, parseCaptionFile, parseTimecode, toTimecode } from '../src/parsers/srt.js';

describe('SRT/VTT parser', () => {
  it('detects SRT format', () => {
    const content = `1
00:00:01,000 --> 00:00:02,500
Hello world`;
    expect(isSRTFormat(content)).to.equal(true);
    expect(isVTTFormat(content)).to.equal(false);
  });

  it('detects VTT format', () => {
    const content = `WEBVTT

00:00:01.000 --> 00:00:02.500
Hello world`;
    expect(isVTTFormat(content)).to.equal(true);
    expect(isSRTFormat(content)).to.equal(false);
  });

  it('parses SRT caption file with speaker extraction and html stripping', () => {
    const content = `1
00:00:01,000 --> 00:00:03,000
[Mayor]: <i>Hello &amp; welcome</i>

2
00:00:03,500 --> 00:00:05,000
>> Clerk: Roll call`;

    const parsed = parseCaptionFile(content, { captionerName: 'Manual', extractSpeakers: true });

    expect(parsed.transcriptInfo.providerName).to.equal('SRT');
    expect(parsed.transcriptInfo.audioDurationMS).to.equal(5000);
    expect(parsed.utterances).to.have.length(2);

    expect(parsed.utterances[0]).to.include({
      speakerOriginal: 'Mayor',
      textOriginal: 'Hello & welcome',
      startMS: 1000,
      endMS: 3000,
      textOriginalSource: 'HUMAN:MANUAL'
    });

    expect(parsed.utterances[1]).to.include({
      speakerOriginal: 'Clerk',
      textOriginal: 'Roll call',
      startMS: 3500,
      endMS: 5000,
      textOriginalSource: 'HUMAN:MANUAL'
    });
  });

  it('converts timecode both directions', () => {
    expect(parseTimecode('00:01:02,345')).to.equal(62345);
    expect(parseTimecode('00:01:02.345')).to.equal(62345);
    expect(toTimecode(62345)).to.equal('00:01:02,345');
  });

  it('labels VTT transcripts with provider VTT', () => {
    const content = `WEBVTT

00:00:01.000 --> 00:00:02.000
Hello from vtt`;
    const parsed = parseCaptionFile(content, { extractSpeakers: false });
    expect(parsed.transcriptInfo.providerName).to.equal('VTT');
  });
});
