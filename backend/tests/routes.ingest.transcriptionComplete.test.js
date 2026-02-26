import { expect } from 'chai';
import Fastify from 'fastify';
import ingestRoutes from '../src/routes/ingest.js';

describe('POST /v1/ingest/transcription-complete', () => {
  async function buildApp(overrides = {}) {
    const app = Fastify();
    await app.register(ingestRoutes, {
      prefix: '/v1/ingest',
      ...overrides
    });
    await app.ready();
    return app;
  }

  it('returns 400 when providerResponse is missing for non-chunked finalize', async () => {
    const app = await buildApp({
      finalizeTranscription: async () => ({ success: true })
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/ingest/transcription-complete?customerID=CUST1',
      payload: {
        transcriptID: 'TR1',
        provider: 'ASSEMBLYAI'
      }
    });

    expect(response.statusCode).to.equal(400);
    const body = JSON.parse(response.body);
    expect(body.success).to.equal(false);
    expect(body.error).to.match(/providerResponse is required/i);

    await app.close();
  });

  it('returns 400 when chunkResponses are provided without chunkMap', async () => {
    const app = await buildApp({
      finalizeTranscription: async () => ({ success: true })
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/ingest/transcription-complete?customerID=CUST2',
      payload: {
        transcriptID: 'TR2',
        provider: 'DEEPGRAM',
        chunkResponses: [
          { chunkIndex: 0, response: { metadata: { request_id: 'dg-c0' }, results: { channels: [{ alternatives: [{ transcript: 'A' }] }] } } }
        ]
      }
    });

    expect(response.statusCode).to.equal(400);
    const body = JSON.parse(response.body);
    expect(body.success).to.equal(false);
    expect(body.error).to.match(/chunkMap is required/i);

    await app.close();
  });

  it('returns 200 and finalize result for single provider response', async () => {
    let argsReceived = null;
    const app = await buildApp({
      finalizeTranscription: async (args) => {
        argsReceived = args;
        return {
          success: true,
          transcriptID: 'TR3',
          utteranceCount: 7
        };
      },
      getCoreApiClient: () => ({ mocked: true })
    });

    const providerResponse = {
      id: 'aai-job-1',
      acoustic_model: 'assemblyai_default',
      language_model: 'assemblyai_default',
      status: 'completed',
      text: 'Call to order',
      audio_duration: 2,
      confidence: 0.95,
      utterances: [{ speaker: 'A', text: 'Call to order', start: 0, end: 1000, confidence: 0.95 }]
    };

    const response = await app.inject({
      method: 'POST',
      url: '/v1/ingest/transcription-complete?customerID=CUST3',
      payload: {
        transcriptID: 'TR3',
        provider: 'ASSEMBLYAI',
        providerResponse
      }
    });

    expect(response.statusCode).to.equal(200);
    const body = JSON.parse(response.body);
    expect(body).to.deep.equal({
      success: true,
      transcriptID: 'TR3',
      utteranceCount: 7
    });
    expect(argsReceived.customerID).to.equal('CUST3');
    expect(argsReceived.transcriptID).to.equal('TR3');
    expect(argsReceived.provider).to.equal('ASSEMBLYAI');
    expect(argsReceived.providerResponse).to.deep.equal(providerResponse);
    expect(argsReceived.coreApiClient).to.deep.equal({ mocked: true });

    await app.close();
  });

  it('returns 200 and finalize result for chunked provider responses', async () => {
    let argsReceived = null;
    const app = await buildApp({
      finalizeTranscription: async (args) => {
        argsReceived = args;
        return {
          success: true,
          transcriptID: 'TR4',
          utteranceCount: 19
        };
      },
      getCoreApiClient: () => ({ mocked: true })
    });

    const chunkResponses = [
      {
        chunkIndex: 0,
        response: {
          metadata: { request_id: 'dg-c0' },
          results: { channels: [{ alternatives: [{ transcript: 'A' }] }] }
        }
      }
    ];
    const chunkMap = [
      { chunkIndex: 0, originalStartMS: 0, originalEndMS: 1000, chunkStartMS: 0, chunkEndMS: 1000, durationMS: 1000 }
    ];

    const response = await app.inject({
      method: 'POST',
      url: '/v1/ingest/transcription-complete?customerID=CUST4',
      payload: {
        transcriptID: 'TR4',
        provider: 'DEEPGRAM',
        chunkResponses,
        chunkMap
      }
    });

    expect(response.statusCode).to.equal(200);
    const body = JSON.parse(response.body);
    expect(body).to.deep.equal({
      success: true,
      transcriptID: 'TR4',
      utteranceCount: 19
    });
    expect(argsReceived.chunkResponses).to.deep.equal(chunkResponses);
    expect(argsReceived.chunkMap).to.deep.equal(chunkMap);
    expect(argsReceived.providerResponse).to.equal(undefined);

    await app.close();
  });

  it('accepts REVAI provider for finalize payload', async () => {
    let argsReceived = null;
    const app = await buildApp({
      finalizeTranscription: async (args) => {
        argsReceived = args;
        return { success: true, transcriptID: 'TR5', utteranceCount: 2 };
      },
      getCoreApiClient: () => ({ mocked: true })
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/ingest/transcription-complete?customerID=CUST5',
      payload: {
        transcriptID: 'TR5',
        provider: 'REVAI',
        providerResponse: {
          id: 'rev-5',
          monologues: [
            { speaker: 0, elements: [{ type: 'text', value: 'Hello', ts: 0.1, end_ts: 0.5, confidence: 0.9 }] }
          ]
        }
      }
    });

    expect(response.statusCode).to.equal(200);
    expect(argsReceived.provider).to.equal('REVAI');

    await app.close();
  });
});
