import { expect } from 'chai';
import { buildFinalizedTranscriptPayload, persistFinalizedTranscript, finalizeTranscription } from '../src/services/transcriptionFinalize.js';

describe('Transcription finalize service', () => {
  it('builds payload from single provider response', () => {
    const payload = buildFinalizedTranscriptPayload({
      provider: 'ASSEMBLYAI',
      providerResponse: {
        id: 'aai-job-1',
        acoustic_model: 'assemblyai_default',
        language_model: 'assemblyai_default',
        status: 'completed',
        text: 'Hello world',
        audio_duration: 2,
        confidence: 0.93,
        utterances: [
          { speaker: 'A', text: 'Hello world', start: 0, end: 1200, confidence: 0.93 }
        ]
      }
    });

    expect(payload.transcriptInfo.providerName).to.equal('ASSEMBLYAI');
    expect(payload.utterances).to.have.length(1);
    expect(payload.utterances[0].textOriginal).to.equal('Hello world');
  });

  it('throws when chunkResponses are provided without chunkMap', () => {
    expect(() => buildFinalizedTranscriptPayload({
      provider: 'ASSEMBLYAI',
      chunkResponses: [{ chunkIndex: 0, response: {} }]
    })).to.throw(/chunkMap is required/i);
  });

  it('persists finalized transcript and utterances', async () => {
    const calls = {
      updateTranscript: null,
      createUtterances: null
    };
    const coreApiClient = {
      updateTranscript: async (...args) => {
        calls.updateTranscript = args;
        return { ok: true };
      },
      createUtterances: async (...args) => {
        calls.createUtterances = args;
        return [{ _id: 'u1' }];
      }
    };

    const result = await persistFinalizedTranscript({
      customerID: 'CUST1',
      transcriptID: 'TR1',
      finalizedPayload: {
        transcriptInfo: {
          providerName: 'ASSEMBLYAI',
          providerJobID: 'aai-job-1',
          providerMeta: {},
          textOriginal: 'Call to order'
        },
        utterances: [
          {
            speakerOriginal: 'A',
            textOriginal: 'Call to order',
            startMS: 0,
            endMS: 1200,
            confidence: 0.95
          }
        ]
      },
      coreApiClient
    });

    expect(result.success).to.equal(true);
    expect(result.utteranceCount).to.equal(1);
    expect(calls.updateTranscript[0]).to.equal('CUST1');
    expect(calls.updateTranscript[1]).to.equal('TR1');
    expect(calls.updateTranscript[2]).to.include({
      providerName: 'ASSEMBLYAI',
      providerJobID: 'aai-job-1',
      status: 'COMPLETE'
    });
    expect(calls.createUtterances[0]).to.equal('CUST1');
    expect(calls.createUtterances[1]).to.equal('TR1');
    expect(calls.createUtterances[2]).to.have.length(1);
  });

  it('rejects finalize persistence when providerName is outside allowed enum', async () => {
    const coreApiClient = {
      updateTranscript: async () => ({ ok: true }),
      createUtterances: async () => [{ _id: 'u1' }]
    };

    try {
      await persistFinalizedTranscript({
        customerID: 'CUSTX',
        transcriptID: 'TRX',
        finalizedPayload: {
          transcriptInfo: {
            providerName: 'UNKNOWN_PROVIDER',
            providerJobID: 'unknown-1',
            providerMeta: {},
            textOriginal: 'x'
          },
          utterances: []
        },
        coreApiClient
      });
      throw new Error('Expected persistFinalizedTranscript to throw');
    } catch (error) {
      expect(String(error?.message || '')).to.match(/Unsupported providerName/i);
    }
  });

  it('finalizes chunked responses end-to-end', async () => {
    const calls = {
      updateTranscript: null,
      createUtterances: null
    };
    const coreApiClient = {
      updateTranscript: async (...args) => {
        calls.updateTranscript = args;
        return { ok: true };
      },
      createUtterances: async (...args) => {
        calls.createUtterances = args;
        return args[2];
      }
    };
    const chunkMap = [
      { chunkIndex: 0, originalStartMS: 0, originalEndMS: 1000, chunkStartMS: 0, chunkEndMS: 1000, durationMS: 1000 },
      { chunkIndex: 1, originalStartMS: 2000, originalEndMS: 3000, chunkStartMS: 1000, chunkEndMS: 2000, durationMS: 1000 }
    ];

    const result = await finalizeTranscription({
      customerID: 'CUST2',
      transcriptID: 'TR2',
      provider: 'DEEPGRAM',
      chunkResponses: [
        {
          chunkIndex: 0,
          response: {
            metadata: { request_id: 'dg-c0', duration: 1.0, channels: 1 },
            results: {
              channels: [{ alternatives: [{ transcript: 'A', confidence: 0.7 }] }],
              utterances: [{ speaker: 0, transcript: 'A', start: 0.1, end: 0.9, confidence: 0.7 }]
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
      ],
      chunkMap,
      coreApiClient
    });

    expect(result.success).to.equal(true);
    expect(result.utteranceCount).to.equal(2);
    expect(calls.updateTranscript[2].providerName).to.equal('DEEPGRAM');
    expect(calls.createUtterances[2][1]).to.include({ startMS: 2200, endMS: 2800 });
  });

  it('preserves existing job and worker metadata during finalize persistence', async () => {
    const calls = {
      updateTranscript: null
    };
    const coreApiClient = {
      getTranscript: async () => ({
        providerMeta: {
          cdsJobID: 'JOB-OLD',
          cdsWorkerID: 'WORKER-OLD',
          poll: { status: 'processing' }
        }
      }),
      updateTranscript: async (...args) => {
        calls.updateTranscript = args;
        return { ok: true };
      },
      createUtterances: async () => []
    };

    await persistFinalizedTranscript({
      customerID: 'CUST3',
      transcriptID: 'TR3',
      finalizedPayload: {
        transcriptInfo: {
          providerName: 'ASSEMBLYAI',
          providerJobID: 'aai-job-3',
          providerMeta: {
            status: 'completed'
          },
          textOriginal: 'Approved'
        },
        utterances: []
      },
      executionContext: {
        cdsJobID: 'JOB-NEW',
        cdsWorkerID: 'WORKER-NEW'
      },
      coreApiClient
    });

    expect(calls.updateTranscript[2].providerMeta).to.include({
      cdsJobID: 'JOB-NEW',
      cdsWorkerID: 'WORKER-NEW',
      status: 'completed'
    });
    expect(calls.updateTranscript[2].cdsJobID).to.equal('JOB-NEW');
  });
});
