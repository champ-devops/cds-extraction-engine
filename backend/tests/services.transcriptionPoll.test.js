import { expect } from 'chai';
import { processTranscriptionPollJob } from '../src/services/transcriptionPoll.js';

describe('Transcription poll service', () => {
  it('returns processing while provider job is not completed', async () => {
    const updates = [];
    const result = await processTranscriptionPollJob({
      payload: {
        customerID: 'CUST1',
        transcriptID: 'TR1',
        provider: 'ASSEMBLYAI',
        providerJobID: 'JOB1'
      }
    }, {
      coreApiClient: {
        updateTranscript: async (...args) => {
          updates.push(args);
          return { ok: true };
        }
      },
      fetchAssemblyAITranscript: async () => ({ status: 'processing' })
    });

    expect(result.success).to.equal(true);
    expect(result.status).to.equal('processing');
    expect(result.isFinal).to.equal(false);
    expect(updates).to.have.length(1);
    expect(updates[0][2].status).to.equal('RUNNING');
  });

  it('returns failed when provider reports error', async () => {
    const updates = [];
    const result = await processTranscriptionPollJob({
      payload: {
        customerID: 'CUST2',
        transcriptID: 'TR2',
        provider: 'ASSEMBLYAI',
        providerJobID: 'JOB2'
      }
    }, {
      coreApiClient: {
        updateTranscript: async (...args) => {
          updates.push(args);
          return { ok: true };
        }
      },
      fetchAssemblyAITranscript: async () => ({ status: 'error' })
    });

    expect(result.success).to.equal(false);
    expect(result.status).to.equal('failed');
    expect(result.isFinal).to.equal(true);
    expect(updates).to.have.length(1);
    expect(updates[0][2].status).to.equal('FAILED');
  });

  it('finalizes completed single-job polling response', async () => {
    let finalizeArgs = null;
    const result = await processTranscriptionPollJob({
      payload: {
        customerID: 'CUST3',
        transcriptID: 'TR3',
        provider: 'ASSEMBLYAI',
        providerJobID: 'JOB3'
      }
    }, {
      coreApiClient: {
        updateTranscript: async () => ({ ok: true })
      },
      fetchAssemblyAITranscript: async () => ({ status: 'completed', id: 'JOB3' }),
      finalizeTranscriptionHandler: async (args) => {
        finalizeArgs = args;
        return { success: true, transcriptID: 'TR3', utteranceCount: 10 };
      }
    });

    expect(result.success).to.equal(true);
    expect(result.status).to.equal('completed');
    expect(result.isFinal).to.equal(true);
    expect(finalizeArgs.providerResponse).to.deep.equal({ status: 'completed', id: 'JOB3' });
    expect(finalizeArgs.chunkResponses).to.equal(undefined);
  });

  it('finalizes completed multi-job polling response as chunked', async () => {
    let finalizeArgs = null;
    const chunkMap = [
      { chunkIndex: 0, originalStartMS: 0, originalEndMS: 1000, chunkStartMS: 0, chunkEndMS: 1000, durationMS: 1000 },
      { chunkIndex: 1, originalStartMS: 2000, originalEndMS: 3000, chunkStartMS: 1000, chunkEndMS: 2000, durationMS: 1000 }
    ];
    const responseByJobID = {
      J0: { status: 'completed', id: 'J0' },
      J1: { status: 'completed', id: 'J1' }
    };

    const result = await processTranscriptionPollJob({
      payload: {
        customerID: 'CUST4',
        transcriptID: 'TR4',
        provider: 'ASSEMBLYAI',
        providerJobIDs: ['J0', 'J1'],
        chunkMap
      }
    }, {
      coreApiClient: {
        updateTranscript: async () => ({ ok: true })
      },
      fetchAssemblyAITranscript: async ({ providerJobID }) => responseByJobID[providerJobID],
      finalizeTranscriptionHandler: async (args) => {
        finalizeArgs = args;
        return { success: true, transcriptID: 'TR4', utteranceCount: 25 };
      }
    });

    expect(result.success).to.equal(true);
    expect(result.status).to.equal('completed');
    expect(result.isFinal).to.equal(true);
    expect(finalizeArgs.providerResponse).to.equal(undefined);
    expect(finalizeArgs.chunkMap).to.deep.equal(chunkMap);
    expect(finalizeArgs.chunkResponses).to.deep.equal([
      { chunkIndex: 0, response: { status: 'completed', id: 'J0' } },
      { chunkIndex: 1, response: { status: 'completed', id: 'J1' } }
    ]);
  });

  it('finalizes immediately when inline providerResponse is provided', async () => {
    let finalizeArgs = null;
    const result = await processTranscriptionPollJob({
      payload: {
        customerID: 'CUST5',
        transcriptID: 'TR5',
        provider: 'DEEPGRAM',
        providerResponse: {
          metadata: { request_id: 'dg-1' },
          results: { channels: [{ alternatives: [{ transcript: 'hello' }] }] }
        }
      }
    }, {
      coreApiClient: {
        updateTranscript: async () => ({ ok: true })
      },
      finalizeTranscriptionHandler: async (args) => {
        finalizeArgs = args;
        return { success: true, transcriptID: 'TR5', utteranceCount: 5 };
      }
    });

    expect(result.success).to.equal(true);
    expect(result.status).to.equal('completed');
    expect(result.isFinal).to.equal(true);
    expect(finalizeArgs.provider).to.equal('DEEPGRAM');
    expect(finalizeArgs.providerResponse).to.be.an('object');
  });

  it('threads cds job and worker IDs into transcript updates and finalize execution context', async () => {
    const updates = [];
    let finalizeArgs = null;
    const coreApiClient = {
      getTranscript: async () => ({
        providerMeta: {
          cdsJobID: 'EXISTING-JOB',
          cdsWorkerID: 'EXISTING-WORKER'
        }
      }),
      updateTranscript: async (...args) => {
        updates.push(args);
        return { ok: true };
      }
    };

    const processingResult = await processTranscriptionPollJob({
      payload: {
        customerID: 'CUST6',
        transcriptID: 'TR6',
        provider: 'ASSEMBLYAI',
        providerJobID: 'JOB6',
        cdsJobID: 'JOB-NEW',
        cdsWorkerID: 'WORKER-NEW'
      }
    }, {
      coreApiClient,
      fetchAssemblyAITranscript: async () => ({ status: 'processing' })
    });

    expect(processingResult.status).to.equal('processing');
    expect(updates[0][2].cdsJobID).to.equal('JOB-NEW');
    expect(updates[0][2].providerMeta).to.include({
      cdsJobID: 'JOB-NEW',
      cdsWorkerID: 'WORKER-NEW'
    });

    const completedResult = await processTranscriptionPollJob({
      payload: {
        customerID: 'CUST7',
        transcriptID: 'TR7',
        provider: 'ASSEMBLYAI',
        providerJobID: 'JOB7',
        cdsJobID: 'JOB-FINAL',
        cdsWorkerID: 'WORKER-FINAL'
      }
    }, {
      coreApiClient: {
        updateTranscript: async () => ({ ok: true })
      },
      fetchAssemblyAITranscript: async () => ({ status: 'completed', id: 'JOB7' }),
      finalizeTranscriptionHandler: async (args) => {
        finalizeArgs = args;
        return { success: true, transcriptID: 'TR7', utteranceCount: 1 };
      }
    });

    expect(completedResult.status).to.equal('completed');
    expect(finalizeArgs.executionContext).to.deep.equal({
      cdsJobID: 'JOB-FINAL',
      cdsWorkerID: 'WORKER-FINAL'
    });
  });

  it('returns processing for Rev.ai in-progress jobs', async () => {
    const updates = [];
    const result = await processTranscriptionPollJob({
      payload: {
        customerID: 'CUST8',
        transcriptID: 'TR8',
        provider: 'REVAI',
        providerJobID: 'REV-JOB-1'
      }
    }, {
      coreApiClient: {
        updateTranscript: async (...args) => {
          updates.push(args);
          return { ok: true };
        }
      },
      fetchRevAIJobStatus: async () => ({ id: 'REV-JOB-1', status: 'in_progress' }),
      fetchRevAITranscript: async () => {
        throw new Error('should not fetch transcript while in progress');
      }
    });

    expect(result.success).to.equal(true);
    expect(result.status).to.equal('processing');
    expect(result.isFinal).to.equal(false);
    expect(updates).to.have.length(1);
    expect(updates[0][2].status).to.equal('RUNNING');
  });

  it('finalizes Rev.ai transcribed jobs by fetching transcript payload', async () => {
    let finalizeArgs = null;
    const result = await processTranscriptionPollJob({
      payload: {
        customerID: 'CUST9',
        transcriptID: 'TR9',
        provider: 'REVAI',
        providerJobID: 'REV-JOB-2'
      }
    }, {
      coreApiClient: {
        updateTranscript: async () => ({ ok: true })
      },
      fetchRevAIJobStatus: async () => ({ id: 'REV-JOB-2', status: 'transcribed' }),
      fetchRevAITranscript: async () => ({
        monologues: [
          {
            speaker: 0,
            elements: [{ type: 'text', value: 'approved', ts: 0, end_ts: 0.5, confidence: 0.9 }]
          }
        ]
      }),
      finalizeTranscriptionHandler: async (args) => {
        finalizeArgs = args;
        return { success: true, transcriptID: 'TR9', utteranceCount: 1 };
      }
    });

    expect(result.success).to.equal(true);
    expect(result.status).to.equal('completed');
    expect(result.isFinal).to.equal(true);
    expect(finalizeArgs.provider).to.equal('REVAI');
    expect(finalizeArgs.providerResponse.id).to.equal('REV-JOB-2');
    expect(finalizeArgs.providerResponse.monologues).to.be.an('array');
  });
});
