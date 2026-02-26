import { expect } from 'chai';
import { detectFormat, parse, ProviderType } from '../src/parsers/index.js';

describe('Provider parsers', () => {
  it('detects and parses AssemblyAI response', () => {
    const sample = {
      id: 'aai-job-1',
      acoustic_model: 'assemblyai_default',
      language_model: 'assemblyai_default',
      status: 'completed',
      text: 'Call meeting to order',
      audio_duration: 5000,
      confidence: 0.9,
      utterances: [
        { speaker: 'A', text: 'Call meeting to order', start: 0, end: 5000, confidence: 0.9 }
      ]
    };

    expect(detectFormat(sample)).to.equal(ProviderType.ASSEMBLYAI);
    const parsed = parse(sample);

    expect(parsed.transcriptInfo.providerName).to.equal('ASSEMBLYAI');
    expect(parsed.transcriptInfo.providerJobID).to.equal('aai-job-1');
    expect(parsed.utterances).to.have.length(1);
    expect(parsed.utterances[0]).to.include({
      speakerOriginal: 'A',
      textOriginal: 'Call meeting to order',
      startMS: 0,
      endMS: 5000,
      textOriginalSource: 'AUTOGEN:ASSEMBLY'
    });
  });

  it('detects and parses DeepGram response with second-to-ms conversion', () => {
    const sample = {
      metadata: { request_id: 'dg-req-1', duration: 2.5, channels: 1 },
      results: {
        channels: [{ alternatives: [{ transcript: 'Budget approved', confidence: 0.88 }] }],
        utterances: [{ speaker: 0, transcript: 'Budget approved', start: 1.25, end: 2.5, confidence: 0.88 }]
      }
    };

    expect(detectFormat(sample)).to.equal(ProviderType.DEEPGRAM);
    const parsed = parse(sample);

    expect(parsed.transcriptInfo.providerName).to.equal('DEEPGRAM');
    expect(parsed.transcriptInfo.providerJobID).to.equal('dg-req-1');
    expect(parsed.transcriptInfo.audioDurationMS).to.equal(2500);
    expect(parsed.utterances).to.have.length(1);
    expect(parsed.utterances[0]).to.include({
      speakerOriginal: '0',
      textOriginal: 'Budget approved',
      startMS: 1250,
      endMS: 2500,
      textOriginalSource: 'AUTOGEN:DEEPGRAM'
    });
  });

  it('normalizes DeepGram utterance ranges when end is before start', () => {
    const sample = {
      metadata: { request_id: 'dg-req-2', duration: 5, channels: 1 },
      results: {
        channels: [{ alternatives: [{ transcript: 'Reversed timing test', confidence: 0.88 }] }],
        utterances: [{ speaker: 0, transcript: 'Reversed timing test', start: 4.9, end: 4.8, confidence: 0.88 }]
      }
    };

    const parsed = parse(sample);
    expect(parsed.utterances).to.have.length(1);
    expect(parsed.utterances[0].startMS).to.equal(4800);
    expect(parsed.utterances[0].endMS).to.equal(4900);
  });

  it('detects and parses Rev.ai transcript response', () => {
    const sample = {
      id: 'rev-job-1',
      monologues: [
        {
          speaker: 1,
          elements: [
            { type: 'text', value: 'Call', ts: 0.0, end_ts: 0.2, confidence: 0.9 },
            { type: 'text', value: 'to', ts: 0.21, end_ts: 0.3, confidence: 0.8 },
            { type: 'text', value: 'order', ts: 0.31, end_ts: 0.8, confidence: 0.85 }
          ]
        }
      ]
    };

    expect(detectFormat(sample)).to.equal(ProviderType.REVAI);
    const parsed = parse(sample);

    expect(parsed.transcriptInfo.providerName).to.equal('REVAI');
    expect(parsed.transcriptInfo.providerJobID).to.equal('rev-job-1');
    expect(parsed.utterances).to.have.length(1);
    expect(parsed.utterances[0]).to.include({
      speakerOriginal: '1',
      textOriginal: 'Call to order',
      startMS: 0,
      endMS: 800,
      textOriginalSource: 'AUTOGEN:REVAI'
    });
  });
});
