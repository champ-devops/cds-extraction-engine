import { expect } from 'chai';
import { reassembleChunkedProviderResponses } from '../src/services/chunkReassembly.js';

describe('Chunk reassembly service', () => {
  it('reassembles AssemblyAI chunk responses into original timeline', () => {
    const chunkMap = [
      { chunkIndex: 0, originalStartMS: 0, originalEndMS: 2000, chunkStartMS: 0, chunkEndMS: 2000, durationMS: 2000 },
      { chunkIndex: 1, originalStartMS: 4000, originalEndMS: 7000, chunkStartMS: 2000, chunkEndMS: 5000, durationMS: 3000 }
    ];

    const chunkResponses = [
      {
        chunkIndex: 0,
        response: {
          id: 'aai-c0',
          acoustic_model: 'assemblyai_default',
          language_model: 'assemblyai_default',
          status: 'completed',
          text: 'Call to order',
          audio_duration: 2000,
          confidence: 0.9,
          utterances: [{ speaker: 'A', text: 'Call to order', start: 0, end: 1500, confidence: 0.9 }]
        }
      },
      {
        chunkIndex: 1,
        response: {
          id: 'aai-c1',
          acoustic_model: 'assemblyai_default',
          language_model: 'assemblyai_default',
          status: 'completed',
          text: 'Budget discussion',
          audio_duration: 3000,
          confidence: 0.8,
          utterances: [{ speaker: 'B', text: 'Budget discussion', start: 100, end: 2000, confidence: 0.8 }]
        }
      }
    ];

    const result = reassembleChunkedProviderResponses({
      provider: 'ASSEMBLYAI',
      chunkResponses,
      chunkMap
    });

    expect(result.transcriptInfo.providerName).to.equal('ASSEMBLYAI');
    expect(result.transcriptInfo.providerJobID).to.equal('aai-c0');
    expect(result.transcriptInfo.providerMeta.isChunkedReassembly).to.equal(true);
    expect(result.transcriptInfo.providerMeta.providerJobIDs).to.deep.equal(['aai-c0', 'aai-c1']);
    expect(result.transcriptInfo.audioDurationMS).to.equal(7000);
    expect(result.utterances).to.have.length(2);
    expect(result.utterances[0]).to.include({ startMS: 0, endMS: 1500, chunkIndex: 0, segmentIndex: 0 });
    expect(result.utterances[1]).to.include({ startMS: 4100, endMS: 6000, chunkIndex: 1, segmentIndex: 1 });
  });

  it('reassembles DeepGram chunk responses and averages confidence', () => {
    const chunkMap = [
      { chunkIndex: 0, originalStartMS: 0, originalEndMS: 1000, chunkStartMS: 0, chunkEndMS: 1000, durationMS: 1000 },
      { chunkIndex: 1, originalStartMS: 2000, originalEndMS: 3000, chunkStartMS: 1000, chunkEndMS: 2000, durationMS: 1000 }
    ];

    const chunkResponses = [
      {
        chunkIndex: 0,
        response: {
          metadata: { request_id: 'dg-c0', duration: 1.0, channels: 1 },
          results: {
            channels: [{ alternatives: [{ transcript: 'A', confidence: 0.6 }] }],
            utterances: [{ speaker: 0, transcript: 'A', start: 0.1, end: 0.9, confidence: 0.6 }]
          }
        }
      },
      {
        chunkIndex: 1,
        response: {
          metadata: { request_id: 'dg-c1', duration: 1.0, channels: 1 },
          results: {
            channels: [{ alternatives: [{ transcript: 'B', confidence: 0.8 }] }],
            utterances: [{ speaker: 1, transcript: 'B', start: 0.2, end: 0.8, confidence: 0.8 }]
          }
        }
      }
    ];

    const result = reassembleChunkedProviderResponses({
      provider: 'DEEPGRAM',
      chunkResponses,
      chunkMap
    });

    expect(result.transcriptInfo.providerName).to.equal('DEEPGRAM');
    expect(result.transcriptInfo.overallConfidence).to.equal(0.7);
    expect(result.utterances[0]).to.include({ startMS: 100, endMS: 900, chunkIndex: 0 });
    expect(result.utterances[1]).to.include({ startMS: 2200, endMS: 2800, chunkIndex: 1 });
  });

  it('reassembles Rev.ai chunk responses', () => {
    const chunkMap = [
      { chunkIndex: 0, originalStartMS: 0, originalEndMS: 1000, chunkStartMS: 0, chunkEndMS: 1000, durationMS: 1000 },
      { chunkIndex: 1, originalStartMS: 1500, originalEndMS: 2500, chunkStartMS: 1000, chunkEndMS: 2000, durationMS: 1000 }
    ];
    const chunkResponses = [
      {
        chunkIndex: 0,
        response: {
          id: 'rev-c0',
          monologues: [
            { speaker: 0, elements: [{ type: 'text', value: 'Call', ts: 0.1, end_ts: 0.7, confidence: 0.9 }] }
          ]
        }
      },
      {
        chunkIndex: 1,
        response: {
          id: 'rev-c1',
          monologues: [
            { speaker: 1, elements: [{ type: 'text', value: 'Budget', ts: 0.2, end_ts: 0.8, confidence: 0.85 }] }
          ]
        }
      }
    ];

    const result = reassembleChunkedProviderResponses({
      provider: 'REVAI',
      chunkResponses,
      chunkMap
    });

    expect(result.transcriptInfo.providerName).to.equal('REVAI');
    expect(result.utterances).to.have.length(2);
    expect(result.utterances[0]).to.include({ startMS: 100, endMS: 700, chunkIndex: 0 });
    expect(result.utterances[1]).to.include({ startMS: 1700, endMS: 2300, chunkIndex: 1 });
  });

  it('throws on unsupported provider', () => {
    expect(() => reassembleChunkedProviderResponses({
      provider: 'UNKNOWN_PROVIDER',
      chunkResponses: [{ chunkIndex: 0, response: {} }],
      chunkMap: [{ chunkIndex: 0, originalStartMS: 0, originalEndMS: 1000, chunkStartMS: 0, chunkEndMS: 1000, durationMS: 1000 }]
    })).to.throw(/Unsupported provider/i);
  });

  it('deduplicates overlap utterances at chunk boundaries', () => {
    const chunkMap = [
      { chunkIndex: 0, originalStartMS: 0, originalEndMS: 3600000, chunkStartMS: 0, chunkEndMS: 3600000, durationMS: 3600000 },
      { chunkIndex: 1, originalStartMS: 3595000, originalEndMS: 7195000, chunkStartMS: 3600000, chunkEndMS: 7200000, durationMS: 3600000 }
    ];

    const chunkResponses = [
      {
        chunkIndex: 0,
        response: {
          id: 'aai-c0',
          acoustic_model: 'assemblyai_default',
          language_model: 'assemblyai_default',
          status: 'completed',
          text: 'boundary text',
          utterances: [{ speaker: 'A', text: 'boundary text', start: 3596000, end: 3599000, confidence: 0.7 }]
        }
      },
      {
        chunkIndex: 1,
        response: {
          id: 'aai-c1',
          acoustic_model: 'assemblyai_default',
          language_model: 'assemblyai_default',
          status: 'completed',
          text: 'boundary text',
          utterances: [{ speaker: 'A', text: 'boundary text', start: 1000, end: 4000, confidence: 0.9 }]
        }
      }
    ];

    const result = reassembleChunkedProviderResponses({
      provider: 'ASSEMBLYAI',
      chunkResponses,
      chunkMap
    });

    expect(result.utterances).to.have.length(1);
    expect(result.utterances[0].confidence).to.equal(0.9);
  });
});
