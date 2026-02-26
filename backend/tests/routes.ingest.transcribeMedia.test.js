import { expect } from 'chai';
import Fastify from 'fastify';
import ingestRoutes from '../src/routes/ingest.js';

describe('POST /v1/ingest/transcribe-media', () => {
  async function buildApp(overrides = {}) {
    const app = Fastify();
    await app.register(ingestRoutes, {
      prefix: '/v1/ingest',
      ...overrides
    });
    await app.ready();
    return app;
  }

  it('returns 400 when mediaID/externalMediaID/mediaPath/cdsV1EventID are all missing', async () => {
    const app = await buildApp({
      submitMediaForTranscription: async () => ({ success: true })
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/ingest/transcribe-media?customerID=CUST1',
      payload: { provider: 'ASSEMBLYAI' }
    });

    expect(response.statusCode).to.equal(400);
    const body = JSON.parse(response.body);
    expect(body.success).to.equal(false);
    expect(body.error).to.match(/One of mediaID, externalMediaID, mediaPath, or cdsV1EventID is required/i);

    await app.close();
  });

  it('returns 202 and payload when transcription submission succeeds', async () => {
    let receivedArgs = null;
    const app = await buildApp({
      submitMediaForTranscription: async (args) => {
        receivedArgs = args;
        return {
          success: true,
          transcriptID: 'TR1',
          coreApiJobID: 'JOB1',
          providerJobID: 'PROV1',
          mediaSource: 'dfw',
          audioExtracted: true
        };
      }
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/ingest/transcribe-media?customerID=CUST2',
      payload: {
        mediaPath: 'meeting123/meeting123.mp4',
        provider: 'DEEPGRAM',
        options: { speakerLabels: false }
      }
    });

    expect(response.statusCode).to.equal(202);
    const body = JSON.parse(response.body);
    expect(body).to.include({
      success: true,
      transcriptID: 'TR1',
      coreApiJobID: 'JOB1',
      providerJobID: 'PROV1',
      mediaSource: 'dfw',
      audioExtracted: true
    });

    expect(receivedArgs).to.deep.equal({
      customerID: 'CUST2',
      mediaID: undefined,
      externalMediaID: undefined,
      mediaPath: 'meeting123/meeting123.mp4',
      cdsV1EventID: undefined,
      provider: 'DEEPGRAM',
      options: {
        speakerLabels: false,
        punctuate: true,
        languageCode: 'en',
        isAIKeyHintExtractionFailureFatal: true
      }
    });

    await app.close();
  });

  it('returns 400 when transcription submission fails', async () => {
    const app = await buildApp({
      submitMediaForTranscription: async () => ({
        success: false,
        error: 'DFW download failed (404)'
      })
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/ingest/transcribe-media?customerID=CUST3',
      payload: {
        externalMediaID: 'meeting-abc',
        provider: 'ASSEMBLYAI'
      }
    });

    expect(response.statusCode).to.equal(400);
    const body = JSON.parse(response.body);
    expect(body.success).to.equal(false);
    expect(body.error).to.match(/DFW download failed/i);

    await app.close();
  });

  it('forwards common provider options without rejecting request', async () => {
    let receivedArgs = null;
    const app = await buildApp({
      submitMediaForTranscription: async (args) => {
        receivedArgs = args;
        return {
          success: true,
          transcriptID: 'TRX',
          providerJobID: 'PROVX'
        };
      }
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/ingest/transcribe-media?customerID=CUST4',
      payload: {
        mediaPath: 'meeting123/meeting123.mp4',
        provider: 'DEEPGRAM',
        options: {
          isDiarizationEnabled: true,
          speakerCountExpected: 4,
          keyTerms: ['Wastwater', 'MOU'],
          silenceForceRecreate: true
        }
      }
    });

    expect(response.statusCode).to.equal(202);
    expect(receivedArgs?.options).to.deep.equal({
      speakerLabels: true,
      isDiarizationEnabled: true,
      speakerCountExpected: 4,
      keyTerms: ['Wastwater', 'MOU'],
      silenceForceRecreate: true,
      punctuate: true,
      languageCode: 'en',
      isAIKeyHintExtractionFailureFatal: true
    });

    await app.close();
  });

  it('accepts REVAI provider in schema and forwards payload', async () => {
    let receivedArgs = null;
    const app = await buildApp({
      submitMediaForTranscription: async (args) => {
        receivedArgs = args;
        return {
          success: true,
          transcriptID: 'TR-REV',
          providerJobID: 'REV-1'
        };
      }
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/ingest/transcribe-media?customerID=CUST5',
      payload: {
        mediaPath: 'meeting123/meeting123.mp4',
        provider: 'REVAI'
      }
    });

    expect(response.statusCode).to.equal(202);
    expect(receivedArgs.provider).to.equal('REVAI');

    await app.close();
  });

  it('accepts cdsV1EventID-only request when useAIKeyHintExtraction is enabled', async () => {
    let receivedArgs = null;
    const app = await buildApp({
      submitMediaForTranscription: async (args) => {
        receivedArgs = args;
        return {
          success: true,
          transcriptID: 'TR-EVENT-1',
          details: {}
        };
      }
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/ingest/transcribe-media?customerID=CUST6',
      payload: {
        cdsV1EventID: 1175,
        provider: 'ASSEMBLYAI',
        options: {
          keyTerms: ['BOMA'],
          useAIKeyHintExtraction: true
        }
      }
    });

    expect(response.statusCode).to.equal(202);
    expect(receivedArgs.cdsV1EventID).to.equal(1175);
    expect(receivedArgs.options.keyTerms).to.deep.equal(['BOMA']);
    expect(receivedArgs.options.useAIKeyHintExtraction).to.equal(true);

    await app.close();
  });

  it('accepts cdsV1EventID without useAIKeyHintExtraction and forwards request', async () => {
    let receivedArgs = null;
    const app = await buildApp({
      submitMediaForTranscription: async (args) => {
        receivedArgs = args;
        return { success: true, transcriptID: 'TR-EVENT-2', details: {} };
      }
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/ingest/transcribe-media?customerID=CUST7',
      payload: {
        cdsV1EventID: 88,
        provider: 'ASSEMBLYAI',
        options: {
          useAIKeyHintExtraction: false
        }
      }
    });

    expect(response.statusCode).to.equal(202);
    expect(receivedArgs.cdsV1EventID).to.equal(88);
    expect(receivedArgs.options.useAIKeyHintExtraction).to.equal(false);

    await app.close();
  });
});

describe('POST /v1/ingest/extract-silence', () => {
  async function buildApp(overrides = {}) {
    const app = Fastify();
    await app.register(ingestRoutes, {
      prefix: '/v1/ingest',
      ...overrides
    });
    await app.ready();
    return app;
  }

  it('returns 400 when media identifiers are missing', async () => {
    const app = await buildApp({
      getCoreApiClient: () => ({
        submitJob: async () => ({ jobID: 'JOB-IGNORE' })
      })
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/ingest/extract-silence?customerID=CUST10',
      payload: {}
    });

    expect(response.statusCode).to.equal(400);
    const body = JSON.parse(response.body);
    expect(body.success).to.equal(false);
    expect(body.error).to.match(/One of mediaID, cdsMediaID, cdsV1MediaID, cdsV1EventID, externalMediaID, or mediaPath is required/i);

    await app.close();
  });

  it('submits EXTRACT_SILENCE_MEDIA job and returns 202', async () => {
    let submittedJob = null;
    const app = await buildApp({
      getCoreApiClient: () => ({
        submitJob: async (_customerID, payload) => {
          submittedJob = payload;
          return { jobID: 'JOB-SIL-1' };
        }
      })
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/ingest/extract-silence?customerID=CUST11',
      payload: {
        externalMediaID: 'CDSV1Path:meeting/abc.mp4',
        options: {
          silenceNoiseDB: -33,
          silenceMinSecs: 4,
          silenceForceRecreate: true
        }
      }
    });

    expect(response.statusCode).to.equal(202);
    const body = JSON.parse(response.body);
    expect(body.success).to.equal(true);
    expect(body.jobID).to.equal('JOB-SIL-1');
    expect(submittedJob.scope).to.equal('extraction:silence:media');
    expect(submittedJob.payload).to.deep.equal({
      customerID: 'CUST11',
      mediaID: undefined,
      cdsMediaID: undefined,
      cdsV1MediaID: undefined,
      cdsV1EventID: undefined,
      externalMediaID: 'CDSV1Path:meeting/abc.mp4',
      mediaPath: undefined,
      options: {
        silenceNoiseDB: -33,
        silenceMinSecs: 4,
        silenceForceRecreate: true
      }
    });

    await app.close();
  });

  it('accepts cdsV1EventID-only silence extraction requests', async () => {
    let submittedJob = null;
    const app = await buildApp({
      getCoreApiClient: () => ({
        submitJob: async (_customerID, payload) => {
          submittedJob = payload;
          return { jobID: 'JOB-SIL-2' };
        }
      })
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/ingest/extract-silence?customerID=CUST12',
      payload: {
        cdsV1EventID: 1175
      }
    });

    expect(response.statusCode).to.equal(202);
    const body = JSON.parse(response.body);
    expect(body.success).to.equal(true);
    expect(body.jobID).to.equal('JOB-SIL-2');
    expect(submittedJob.scope).to.equal('extraction:silence:media');
    expect(submittedJob.payload.cdsV1EventID).to.equal(1175);

    await app.close();
  });
});
