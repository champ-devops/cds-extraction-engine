import { expect } from 'chai';
import { ingestCaptionFile, ingestProviderJSON, submitMediaForSilenceExtraction, submitMediaForTranscription } from '../src/services/transcriptIngestion.js';
import { __testables } from '../src/services/transcriptIngestion.js';
import { initializeConfig } from '../src/config/appConfig.js';

describe('Transcript ingestion service validations', () => {
  before(async () => {
    await initializeConfig();
  });

  it('rejects provider json ingest without customerID', async () => {
    const result = await ingestProviderJSON({}, { mediaID: 'm1' });
    expect(result.success).to.equal(false);
    expect(result.error).to.match(/customerID is required/i);
  });

  it('rejects caption ingest without media identifier', async () => {
    const result = await ingestCaptionFile('1\n00:00:00,000 --> 00:00:01,000\nTest', { customerID: 'c1' });
    expect(result.success).to.equal(false);
    expect(result.error).to.match(/Either mediaID or externalMediaID is required/i);
  });

  it('rejects media transcription without identifiers', async () => {
    const result = await submitMediaForTranscription({ customerID: 'c1' });
    expect(result.success).to.equal(false);
    expect(result.error).to.match(/One of transcriptID, mediaID, externalMediaID, cdsMediaID, cdsV1MediaID, mediaPath, or cdsV1EventID is required/i);
  });

  it('rejects media transcription without customerID', async () => {
    const result = await submitMediaForTranscription({ mediaPath: 'meeting123/meeting123.mp4' });
    expect(result.success).to.equal(false);
    expect(result.error).to.match(/customerID is required/i);
  });

  it('rejects silence extraction without identifiers', async () => {
    const result = await submitMediaForSilenceExtraction({ customerID: 'c1' });
    expect(result.success).to.equal(false);
    expect(result.error).to.match(/One of mediaID, externalMediaID, cdsMediaID, cdsV1MediaID, mediaPath, or cdsV1EventID is required/i);
  });

  it('rejects silence extraction without customerID', async () => {
    const result = await submitMediaForSilenceExtraction({ mediaPath: 'meeting123/meeting123.mp4' });
    expect(result.success).to.equal(false);
    expect(result.error).to.match(/customerID is required/i);
  });
});

describe('Transcript ingestion provider-scoped helpers', () => {
  it('resolves provider name from transcript info or text source', () => {
    expect(__testables.resolveProviderNameForCreate({ providerName: '  DEEPGRAM ' }, [])).to.equal('DEEPGRAM');
    expect(__testables.resolveProviderNameForCreate({}, [{ textOriginalSource: 'AUTOGEN:ASSEMBLYAI' }])).to.equal('ASSEMBLYAI');
    expect(__testables.resolveProviderNameForCreate({}, [{ textOriginalSource: 'HUMAN:MANUAL' }])).to.equal('HUMAN');
  });

  it('throws when provider name cannot be resolved', () => {
    expect(() => __testables.resolveProviderNameForCreate({}, [])).to.throw(/providerName is required/i);
  });

  it('throws when provider name is outside allowed enum', () => {
    expect(() => __testables.resolveProviderNameForCreate({ providerName: 'UNKNOWN_PROVIDER' }, [])).to.throw(/Unsupported providerName/i);
  });

  it('reuses transcripts using externalMediaID plus providerName', async () => {
    const transcript = { _id: 'TR1', externalMediaID: 'CDSV1Path:abc.mp4', providerName: 'DEEPGRAM' };
    const client = {
      listTranscripts: async (_customerID, query) => {
        expect(query.externalMediaID).to.equal('CDSV1Path:abc.mp4');
        expect(query.providerName).to.equal('DEEPGRAM');
        expect(query.direction).to.equal('STT');
        expect(query.variant).to.equal('EN');
        return [
          { _id: 'TR_OTHER', externalMediaID: 'CDSV1Path:abc.mp4', providerName: 'ASSEMBLYAI' },
          transcript
        ];
      }
    };

    const found = await __testables.findTranscriptByExternalMediaID({
      client,
      customerID: 'C1',
      externalMediaID: 'CDSV1Path:abc.mp4',
      providerName: 'DEEPGRAM'
    });

    expect(found).to.deep.equal(transcript);
  });

  it('creates finalized transcripts with explicit STT identity fields', async () => {
    let capturedPayload = null;
    const client = {
      createTranscript: async (_customerID, payload) => {
        capturedPayload = payload;
        return { _id: 'TRX1' };
      },
      createUtterances: async () => []
    };

    const result = await __testables.createTranscriptWithUtterances('C1', {
      client,
      mediaID: 'M1',
      externalMediaID: 'EXT1',
      transcriptInfo: {
        providerName: 'DEEPGRAM',
        textOriginal: 'hello world'
      },
      utterances: []
    });

    expect(result.success).to.equal(true);
    expect(capturedPayload.direction).to.equal('STT');
    expect(capturedPayload.variant).to.equal('EN');
  });

  it('creates running transcripts with explicit STT identity fields', async () => {
    let capturedPayload = null;
    const client = {
      createTranscript: async (_customerID, payload) => {
        capturedPayload = payload;
        return { _id: 'TRX2' };
      }
    };

    const transcript = await __testables.createOrReuseTranscript({
      client,
      customerID: 'C1',
      effectiveExternalMediaID: 'CDSV1Path:abc.mp4',
      provider: 'ASSEMBLYAI',
      cdsJobID: 'J1',
      cdsWorkerID: 'W1'
    });

    expect(transcript._id).to.equal('TRX2');
    expect(capturedPayload.direction).to.equal('STT');
    expect(capturedPayload.variant).to.equal('EN');
    expect(capturedPayload.cdsJobID).to.equal('J1');
  });

  it('reuses duplicate transcripts using STT identity filters', async () => {
    const transcript = { _id: 'TR3', externalMediaID: 'CDSV1Path:abc.mp4', providerName: 'REVAI' };
    const client = {
      createTranscript: async () => {
        const error = new Error('duplicate');
        error.statusCode = 409;
        throw error;
      },
      listTranscripts: async (_customerID, query) => {
        expect(query.externalMediaID).to.equal('CDSV1Path:abc.mp4');
        expect(query.providerName).to.equal('REVAI');
        expect(query.direction).to.equal('STT');
        expect(query.variant).to.equal('EN');
        return [transcript];
      }
    };

    const found = await __testables.createOrReuseTranscript({
      client,
      customerID: 'C1',
      effectiveExternalMediaID: 'CDSV1Path:abc.mp4',
      provider: 'REVAI',
      cdsJobID: 'J1',
      cdsWorkerID: 'W1'
    });

    expect(found).to.deep.equal(transcript);
  });

  it('preserves CDSV1MediaID external IDs without path prefix', () => {
    expect(__testables.buildCDSV1PathExternalMediaID('CDSV1MediaID:23246')).to.equal('CDSV1MediaID:23246');
    expect(__testables.buildCDSV1PathExternalMediaID('CDSV1CustomerMediaID:23246')).to.equal('CDSV1CustomerMediaID:23246');
    expect(__testables.buildCDSV1PathExternalMediaID('foo/bar.mp4')).to.equal('CDSV1Path:foo/bar.mp4');
  });

  it('normalizes canonical CDSV1CustomerMediaID external IDs', () => {
    expect(__testables.buildCDSV1CustomerMediaIDExternalMediaID(12345)).to.equal('CDSV1CustomerMediaID:12345');
    expect(__testables.buildCDSV1CustomerMediaIDExternalMediaID('42')).to.equal('CDSV1CustomerMediaID:42');
  });

  it('parses external media identity variants', () => {
    expect(__testables.parseExternalMediaIdentity('CDSV1CustomerMediaID:123').type).to.equal('customer-media-id');
    expect(__testables.parseExternalMediaIdentity('CDSV1MediaID:321').type).to.equal('media-id');
    expect(__testables.parseExternalMediaIdentity('CDSV1Path:a/b.mp4').type).to.equal('path');
    expect(__testables.parseExternalMediaIdentity('a/b.mp4').type).to.equal('raw-path');
  });

  it('resolves canonical external media context directly from customer media ID externalMediaID', async () => {
    const result = await __testables.resolveCanonicalExternalMediaContext({
      customerID: 'C1',
      externalMediaID: 'CDSV1CustomerMediaID:123',
      cdsV1MediaID: undefined,
      resolvedMediaPath: '2026-02/test.mp4',
      normalizedMp4Path: 'C1/2026-02/test.mp4'
    });
    expect(result.canonicalExternalMediaID).to.equal('CDSV1CustomerMediaID:123');
    expect(result.externalMediaPath).to.equal('CDSV1Path:2026-02/test.mp4');
    expect(result.compatibilityExternalMediaIDs).to.include('CDSV1Path:2026-02/test.mp4');
  });

  it('reuses duplicate transcripts when only legacy externalMediaID exists', async () => {
    const transcript = { _id: 'TR4', externalMediaID: 'CDSV1Path:abc.mp4', providerName: 'REVAI', providerMeta: {} };
    const queriedExternalMediaIDs = [];
    const client = {
      createTranscript: async () => {
        const error = new Error('duplicate');
        error.statusCode = 409;
        throw error;
      },
      listTranscripts: async (_customerID, query) => {
        queriedExternalMediaIDs.push(query.externalMediaID);
        if (query.externalMediaID === 'CDSV1Path:abc.mp4') {
          return [transcript];
        }
        return [];
      },
      updateTranscript: async () => ({ success: true })
    };

    const found = await __testables.createOrReuseTranscript({
      client,
      customerID: 'C1',
      effectiveExternalMediaID: 'CDSV1CustomerMediaID:42',
      compatibilityExternalMediaIDs: ['CDSV1Path:abc.mp4'],
      provider: 'REVAI',
      cdsJobID: 'J1',
      cdsWorkerID: 'W1',
      externalMediaPath: 'CDSV1Path:abc.mp4'
    });

    expect(found).to.deep.equal(transcript);
    expect(queriedExternalMediaIDs).to.deep.equal([
      'CDSV1CustomerMediaID:42',
      'CDSV1Path:abc.mp4'
    ]);
  });

  it('enables resume polling support for polling-backed providers', () => {
    expect(__testables.supportsProviderPolling('ASSEMBLYAI')).to.equal(true);
    expect(__testables.supportsProviderPolling('REVAI')).to.equal(true);
    expect(__testables.supportsProviderPolling('DEEPGRAM')).to.equal(false);
  });

  it('performs AI key hint extraction when cdsV1EventID + useAIKeyHintExtraction are supplied and keeps caller terms first', async () => {
    const buildEventKeyTermsCalls = [];
    const result = await __testables.resolveEventKeyHintAugmentation({
      requestedTranscriptID: undefined,
      cdsV1EventID: 1175,
      isAIKeyHintExtractionEnabled: true,
      customerID: 'WaldenTN',
      provider: 'DEEPGRAM',
      mediaID: undefined,
      externalMediaID: undefined,
      resolvedMediaPath: null,
      cdsV1MediaID: undefined,
      providerOptions: {
        keyTerms: ['BOMA', 'VeryLongCallerTerm' + 'x'.repeat(200)]
      },
      lookupLegacyCustomerIDByV2CustomerIDHandler: async (customerID) => {
        expect(customerID).to.equal('WaldenTN');
        return { legacyCustomerID: 69 };
      },
      buildEventMediaContextHandler: async () => ({
        mediaPath: '2026-02/test.mp4',
        eventWarnings: []
      }),
      buildEventKeyTermsHandler: async (v1CustomerID, cdsV1EventID) => {
        buildEventKeyTermsCalls.push({ v1CustomerID, cdsV1EventID });
        return {
          mediaPath: '2026-02/test.mp4',
          keyTerms: ['Resolution 25-267', 'BOMA', 'OHM Advisors'],
          keywordListJSON: ['Resolution 25-267', 'BOMA', 'OHM Advisors'],
          eventAndItemsRows: [
            { sourceType: 'EVENT', sourceID: '1175', title: 'Meeting', description: 'Desc', textOriginal: 'Meeting. Desc' }
          ],
          eventWarnings: [],
          aiHintDebug: {
            isLLMUsed: true,
            provider: 'openai',
            llmInputTexts: ['Agenda A', 'Agenda B'],
            llmInputCharCount: 16,
            llmUserPrompt: 'prompt-body'
          }
        };
      }
    });

    expect(buildEventKeyTermsCalls).to.deep.equal([{ v1CustomerID: 69, cdsV1EventID: 1175 }]);
    expect(result.resolvedMediaPath).to.equal('2026-02/test.mp4');
    expect(result.providerOptions.keyTerms).to.deep.equal(['BOMA', 'Resolution 25-267', 'OHM Advisors']);
    expect(result.eventHintWarnings).to.include('EVENT_HINTS_KEY_TERMS_TOO_LONG_FILTERED');
    expect(result.debug.isApplied).to.equal(true);
    expect(result.debug.finalKeyTermsFull).to.deep.equal(['BOMA', 'Resolution 25-267', 'OHM Advisors']);
    expect(result.debug.llmInputTexts).to.deep.equal(['Agenda A', 'Agenda B']);
    expect(result.debug.llmInputCharCount).to.equal(16);
    expect(result.debug.llmUserPrompt).to.equal('prompt-body');
    expect(result.debug.eventAndItemsRows).to.deep.equal([
      { sourceType: 'EVENT', sourceID: '1175', title: 'Meeting', description: 'Desc', textOriginal: 'Meeting. Desc' }
    ]);
    expect(result.debug.keywordListJSON).to.deep.equal(['Resolution 25-267', 'BOMA', 'OHM Advisors']);
  });

  it('does not run AI key hint extraction when useAIKeyHintExtraction is false', async () => {
    let keyTermsCalled = false;
    let mediaContextCalled = false;
    const result = await __testables.resolveEventKeyHintAugmentation({
      requestedTranscriptID: undefined,
      cdsV1EventID: 1175,
      isAIKeyHintExtractionEnabled: false,
      customerID: 'WaldenTN',
      provider: 'ASSEMBLYAI',
      mediaID: undefined,
      externalMediaID: undefined,
      resolvedMediaPath: 'already.mp4',
      cdsV1MediaID: undefined,
      providerOptions: {
        keyTerms: ['BOMA']
      },
      lookupLegacyCustomerIDByV2CustomerIDHandler: async () => ({ legacyCustomerID: 69 }),
      buildEventMediaContextHandler: async () => {
        mediaContextCalled = true;
        return { mediaPath: 'resolved.mp4', eventWarnings: [] };
      },
      buildEventKeyTermsHandler: async () => {
        keyTermsCalled = true;
        return { mediaPath: 'ignored.mp4', keyTerms: ['X'], eventWarnings: [] };
      }
    });

    expect(mediaContextCalled).to.equal(true);
    expect(keyTermsCalled).to.equal(false);
    expect(result.providerOptions.keyTerms).to.deep.equal(['BOMA']);
    expect(result.resolvedMediaPath).to.equal('already.mp4');
  });

  it('treats AI key hint extraction failure as fatal by default', async () => {
    const result = await __testables.resolveEventKeyHintAugmentation({
      requestedTranscriptID: undefined,
      cdsV1EventID: 1175,
      isAIKeyHintExtractionEnabled: true,
      customerID: 'WaldenTN',
      provider: 'ASSEMBLYAI',
      mediaID: undefined,
      externalMediaID: undefined,
      resolvedMediaPath: null,
      cdsV1MediaID: undefined,
      providerOptions: {
        keyTerms: ['BOMA']
      },
      lookupLegacyCustomerIDByV2CustomerIDHandler: async () => ({ legacyCustomerID: 69 }),
      buildEventMediaContextHandler: async () => ({
        mediaPath: '2026-02/test.mp4',
        eventWarnings: []
      }),
      buildEventKeyTermsHandler: async () => ({
        mediaPath: '2026-02/test.mp4',
        keyTerms: ['OHM Advisors'],
        eventWarnings: ['EVENT_HINTS_PROPER_NOUN_EXTRACTION_FAILED'],
        aiHintDebug: {
          isLLMUsed: false,
          provider: 'openai',
          failureReason: 'llm-call-failed',
          failureCode: 'llm-http-error',
          failureMessage: 'OpenAI request failed with status 500',
          failureDetails: { httpStatus: 500, provider: 'openai' }
        }
      })
    });

    expect(result.fatalError).to.not.equal(null);
    expect(result.fatalError.message).to.equal('OpenAI request failed with status 500 | details={"httpStatus":500,"provider":"openai"}');
    expect(result.fatalError.details.warningCode).to.equal('EVENT_HINTS_PROPER_NOUN_EXTRACTION_FAILED');
  });

  it('allows fallback when isAIKeyHintExtractionFailureFatal is false', async () => {
    const result = await __testables.resolveEventKeyHintAugmentation({
      requestedTranscriptID: undefined,
      cdsV1EventID: 1175,
      isAIKeyHintExtractionEnabled: true,
      isAIKeyHintExtractionFailureFatal: false,
      customerID: 'WaldenTN',
      provider: 'ASSEMBLYAI',
      mediaID: undefined,
      externalMediaID: undefined,
      resolvedMediaPath: null,
      cdsV1MediaID: undefined,
      providerOptions: {
        keyTerms: ['BOMA']
      },
      lookupLegacyCustomerIDByV2CustomerIDHandler: async () => ({ legacyCustomerID: 69 }),
      buildEventMediaContextHandler: async () => ({
        mediaPath: '2026-02/test.mp4',
        eventWarnings: []
      }),
      buildEventKeyTermsHandler: async () => ({
        mediaPath: '2026-02/test.mp4',
        keyTerms: ['OHM Advisors'],
        eventWarnings: ['EVENT_HINTS_PROPER_NOUN_EXTRACTION_FAILED'],
        aiHintDebug: {
          isLLMUsed: false,
          provider: 'openai',
          failureMessage: 'OpenAI request failed with status 500'
        }
      })
    });

    expect(result.fatalError).to.equal(null);
    expect(result.eventHintWarnings).to.include('EVENT_HINTS_PROPER_NOUN_EXTRACTION_FAILED');
    expect(result.providerOptions.keyTerms).to.deep.equal(['BOMA', 'OHM Advisors']);
  });

  it('stripHintDebugFromProviderMeta removes hint payload before transcript persistence', () => {
    const result = __testables.stripHintDebugFromProviderMeta({
      id: 'JOB1',
      status: 'queued',
      hintDebug: {
        keyTerms: ['BOMA']
      }
    });

    expect(result).to.deep.equal({
      id: 'JOB1',
      status: 'queued'
    });
  });

  it('createOrReplaceEventAndItemsExtraction recreates KEYWORD_EXTRACTION targeted to EVENT_AND_ITEMS', async () => {
    const deletedExtractionIDs = [];
    let createdExtractionPayload = null;
    let listQuery = null;
    const result = await __testables.createOrReplaceEventAndItemsExtraction({
      client: {
        listExtractions: async (_customerID, query) => {
          listQuery = query;
          return [{ _id: 'EX-OLD', updatedAt: '2026-02-24T00:00:00.000Z' }];
        },
        hardDeleteExtractionAndItems: async (_customerID, extractionID) => {
          deletedExtractionIDs.push(extractionID);
        },
        createExtraction: async (_customerID, payload) => {
          createdExtractionPayload = payload;
          return { _id: 'EX-NEW' };
        },
        createExtractionItems: async () => {
          throw new Error('createExtractionItems should not be called');
        }
      },
      customerID: 'C1',
      mediaID: 'M1',
      externalMediaID: 'CDSV1CustomerMediaID:42',
      compatibilityExternalMediaIDs: [],
      cdsV1EventID: 1175,
      processingDurationMS: 4321,
      eventAndItemsRows: [
        { sourceType: 'EVENT', sourceID: '1175', title: 'Meeting', description: 'Desc', textOriginal: 'Meeting. Desc' },
        { sourceType: 'AGENDA_ITEM', sourceID: '2001', title: 'Item One', description: 'Detail', textOriginal: 'Item One. Detail' }
      ],
      keywordListJSON: ['BOMA', 'Resolution 25-267'],
      eventWarnings: [],
      cdsJobID: 'JOB-EVT-1'
    });

    expect(deletedExtractionIDs).to.deep.equal(['EX-OLD']);
    expect(listQuery.extractionKind).to.equal('KEYWORD_EXTRACTION');
    expect(listQuery.v1TargetClassName).to.equal('EVENT_AND_ITEMS');
    expect(listQuery.v1TargetID).to.equal(1175);
    expect(createdExtractionPayload.extractionKind).to.equal('KEYWORD_EXTRACTION');
    expect(createdExtractionPayload.offsetUnit).to.equal('NONE');
    expect(createdExtractionPayload.providerName).to.equal('HEURISTIC');
    expect(createdExtractionPayload.providerMeta).to.deep.equal({
      llmInputWordCount: 0
    });
    expect(createdExtractionPayload.cdsJobID).to.equal('JOB-EVT-1');
    expect(createdExtractionPayload.v1TargetClassName).to.equal('EVENT_AND_ITEMS');
    expect(createdExtractionPayload.v1TargetID).to.equal(1175);
    expect(createdExtractionPayload.processingDurationMS).to.equal(4321);
    expect(createdExtractionPayload.extractionData).to.deep.equal({
      keywordListJSON: ['BOMA', 'Resolution 25-267'],
      aiHintMeta: {
        isAIHintEnabled: false,
        isAIHintApplied: false,
        isAIUsed: false,
        aiProvider: '',
        aiFailureReason: '',
        aiFailureCode: '',
        eventKeyTermCount: 0,
        callerKeyTermCount: 0,
        finalKeyTermCount: 0
      }
    });
    expect(result.extractionID).to.equal('EX-NEW');
    expect(result.itemCount).to.equal(0);
  });

  it('stores AI hint metadata in KEYWORD_EXTRACTION extractionData', async () => {
    let createdExtractionPayload = null;
    await __testables.createOrReplaceEventAndItemsExtraction({
      client: {
        listExtractions: async () => [],
        hardDeleteExtractionAndItems: async () => {},
        createExtraction: async (_customerID, payload) => {
          createdExtractionPayload = payload;
          return { _id: 'EX-AI' };
        },
        createExtractionItems: async () => []
      },
      customerID: 'C1',
      cdsV1EventID: 1175,
      keywordListJSON: ['Resolution 25-267'],
      aiHintDebug: {
        isEnabled: true,
        isApplied: true,
        isLLMUsed: true,
        llmProvider: 'openai',
        llmInputTexts: [
          'One two three',
          'Alpha beta'
        ],
        llmFailureReason: '',
        llmFailureCode: '',
        eventKeyTermCount: 17,
        callerKeyTermCount: 12,
        finalKeyTermCount: 29
      }
    });

    expect(createdExtractionPayload.providerName).to.equal('OPENAI');
    expect(createdExtractionPayload.providerMeta).to.deep.equal({
      llmInputWordCount: 5
    });
    expect(createdExtractionPayload.extractionData.aiHintMeta).to.deep.equal({
      isAIHintEnabled: true,
      isAIHintApplied: true,
      isAIUsed: true,
      aiProvider: 'openai',
      aiFailureReason: '',
      aiFailureCode: '',
      eventKeyTermCount: 17,
      callerKeyTermCount: 12,
      finalKeyTermCount: 29
    });
  });

  it('uses HEURISTIC providerName when AI hint extraction falls back after LLM failure', async () => {
    let createdExtractionPayload = null;
    await __testables.createOrReplaceEventAndItemsExtraction({
      client: {
        listExtractions: async () => [],
        hardDeleteExtractionAndItems: async () => {},
        createExtraction: async (_customerID, payload) => {
          createdExtractionPayload = payload;
          return { _id: 'EX-HEURISTIC' };
        },
        createExtractionItems: async () => []
      },
      customerID: 'C1',
      cdsV1EventID: 1175,
      keywordListJSON: ['Resolution 25-267'],
      aiHintDebug: {
        isEnabled: true,
        isApplied: true,
        isLLMUsed: false,
        llmProvider: 'openai',
        llmInputTexts: ['Fallback terms still start from this text']
      }
    });

    expect(createdExtractionPayload.providerName).to.equal('HEURISTIC');
    expect(createdExtractionPayload.providerMeta).to.deep.equal({
      llmInputWordCount: 7
    });
  });
});

describe('Provider option builders — hint text / key terms', () => {
  before(async () => {
    await initializeConfig();
  });

  // --- normalizeCommonTranscriptionOptions ---
  describe('normalizeCommonTranscriptionOptions', () => {
    it('accepts valid hintBoostParam and returns it lowercased', () => {
      const result = __testables.normalizeCommonTranscriptionOptions({ hintBoostParam: 'high' });
      expect(result.hintBoostParam).to.equal('high');
      expect(result.hintBoostParamInvalid).to.equal(false);
    });

    it('lowercases hintBoostParam before validation', () => {
      const result = __testables.normalizeCommonTranscriptionOptions({ hintBoostParam: 'HIGH' });
      expect(result.hintBoostParam).to.equal('high');
      expect(result.hintBoostParamInvalid).to.equal(false);
    });

    it('marks invalid hintBoostParam and returns undefined for the value', () => {
      const result = __testables.normalizeCommonTranscriptionOptions({ hintBoostParam: 'extreme' });
      expect(result.hintBoostParam).to.equal(undefined);
      expect(result.hintBoostParamInvalid).to.equal(true);
    });

    it('leaves hintBoostParam and hintBoostParamInvalid undefined when not provided', () => {
      const result = __testables.normalizeCommonTranscriptionOptions({});
      expect(result.hintBoostParam).to.equal(undefined);
      expect(result.hintBoostParamInvalid).to.equal(false);
    });

    it('sanitizes key terms by removing file extensions and punctuation', () => {
      const result = __testables.normalizeCommonTranscriptionOptions({
        keyTerms: ['September 25.pdf', 'OHM, Advisors!', '!!!']
      });
      expect(result.keyTerms).to.deep.equal(['September 25', 'OHM Advisors']);
    });
  });

  // --- buildAssemblyAIProviderOptions ---
  describe('buildAssemblyAIProviderOptions', () => {
    it('SLAM-1 + terms: sets keyterms_prompt, no warnings', () => {
      const result = __testables.buildAssemblyAIProviderOptions({ keyTerms: ['council', 'bylaw'] });
      expect(result.payload.keyterms_prompt).to.deep.equal(['council', 'bylaw']);
      expect(result.payload.word_boost).to.equal(undefined);
      expect(result.providerWarnings).to.deep.equal([]);
    });

    it('SLAM-1 explicit model + terms: sets keyterms_prompt', () => {
      const result = __testables.buildAssemblyAIProviderOptions({ model: 'slam-1', keyTerms: ['motion'] });
      expect(result.payload.keyterms_prompt).to.deep.equal(['motion']);
      expect(result.providerWarnings).to.deep.equal([]);
    });

    it('SLAM-1 + >100 terms: truncates to 100 and warns', () => {
      const terms = Array.from({ length: 120 }, (_, i) => `term${i}`);
      const result = __testables.buildAssemblyAIProviderOptions({ keyTerms: terms });
      expect(result.payload.keyterms_prompt).to.have.lengthOf(100);
      expect(result.providerWarnings).to.include('ASSEMBLYAI_KEY_TERMS_TRUNCATED_TO_100');
    });

    it('filters AssemblyAI terms over 100 characters', () => {
      const longTerm = `prefix-${'x'.repeat(120)}`;
      const result = __testables.buildAssemblyAIProviderOptions({ keyTerms: ['short', longTerm] });
      expect(result.payload.keyterms_prompt).to.deep.equal(['short']);
      expect(result.providerWarnings).to.include('ASSEMBLYAI_KEY_TERMS_TOO_LONG_FILTERED');
    });

    it('non-SLAM-1 model + terms: uses word_boost and warns', () => {
      const result = __testables.buildAssemblyAIProviderOptions({ model: 'best', keyTerms: ['council'] });
      expect(result.payload.word_boost).to.deep.equal(['council']);
      expect(result.payload.keyterms_prompt).to.equal(undefined);
      expect(result.providerWarnings).to.include('ASSEMBLYAI_KEY_TERMS_USING_WORD_BOOST_FALLBACK');
    });

    it('non-SLAM-1 + terms + valid hintBoostParam: sets boost_param', () => {
      const result = __testables.buildAssemblyAIProviderOptions({ model: 'best', keyTerms: ['council'], hintBoostParam: 'high' });
      expect(result.payload.boost_param).to.equal('high');
      expect(result.providerWarnings).to.include('ASSEMBLYAI_KEY_TERMS_USING_WORD_BOOST_FALLBACK');
      expect(result.providerWarnings).to.not.include('ASSEMBLYAI_INVALID_HINT_BOOST_PARAM');
    });

    it('invalid hintBoostParam: emits warning and omits boost_param', () => {
      const result = __testables.buildAssemblyAIProviderOptions({ model: 'best', keyTerms: ['council'], hintBoostParam: 'extreme' });
      expect(result.payload.boost_param).to.equal(undefined);
      expect(result.providerWarnings).to.include('ASSEMBLYAI_INVALID_HINT_BOOST_PARAM');
    });

    it('no terms: no word_boost, no keyterms_prompt, no key-term warnings', () => {
      const result = __testables.buildAssemblyAIProviderOptions({});
      expect(result.payload.word_boost).to.equal(undefined);
      expect(result.payload.keyterms_prompt).to.equal(undefined);
      expect(result.providerWarnings).to.not.include('ASSEMBLYAI_KEY_TERMS_USING_WORD_BOOST_FALLBACK');
      expect(result.providerWarnings).to.not.include('ASSEMBLYAI_KEY_TERMS_TRUNCATED_TO_100');
    });
  });

  // --- buildDeepGramProviderOptions ---
  describe('buildDeepGramProviderOptions', () => {
    it('nova-3 + short terms: passes all through with no warnings', () => {
      const result = __testables.buildDeepGramProviderOptions({ model: 'nova-3', keyTerms: ['council', 'bylaw'] });
      expect(result.keyTerms).to.deep.equal(['council', 'bylaw']);
      expect(result.providerWarnings).to.deep.equal([]);
    });

    it('nova-3 + a term >100 chars: filters it and warns', () => {
      const longTerm = 'a'.repeat(101);
      const result = __testables.buildDeepGramProviderOptions({ model: 'nova-3', keyTerms: ['council', longTerm] });
      expect(result.keyTerms).to.deep.equal(['council']);
      expect(result.providerWarnings).to.include('DEEPGRAM_KEY_TERMS_TOO_LONG_FILTERED');
      expect(result.providerWarnings).to.not.include('DEEPGRAM_KEY_TERMS_TRUNCATED_TO_100');
    });

    it('nova-3 + mix of short and long terms: only long ones removed', () => {
      const longTerm = 'b'.repeat(101);
      const result = __testables.buildDeepGramProviderOptions({ model: 'nova-3', keyTerms: ['short', longTerm, 'alsoShort'] });
      expect(result.keyTerms).to.deep.equal(['short', 'alsoShort']);
      expect(result.providerWarnings).to.include('DEEPGRAM_KEY_TERMS_TOO_LONG_FILTERED');
    });

    it('nova-3 + many valid terms: truncates to safe cap and warns', () => {
      const terms = Array.from({ length: 120 }, (_, i) => `term${i}`);
      const result = __testables.buildDeepGramProviderOptions({ model: 'nova-3', keyTerms: terms });
      expect(result.keyTerms).to.have.lengthOf(50);
      expect(result.providerWarnings).to.include('DEEPGRAM_KEY_TERMS_TRUNCATED_TO_SAFE_CAP');
    });

    it('unsupported model + terms: warns unsupported, returns no keyTerms', () => {
      const result = __testables.buildDeepGramProviderOptions({ model: 'nova-2', keyTerms: ['council'] });
      expect(result.keyTerms).to.deep.equal([]);
      expect(result.providerWarnings).to.include('DEEPGRAM_KEY_TERMS_UNSUPPORTED_FOR_MODEL');
    });

    it('sanitizes Deepgram key terms', () => {
      const result = __testables.buildDeepGramProviderOptions({
        model: 'nova-3',
        keyTerms: ['September 25.pdf', '!!!', 'OHM, Advisors!']
      });
      expect(result.keyTerms).to.deep.equal(['September 25', 'OHM Advisors']);
    });

    it('truncates Deepgram key terms by total query size', () => {
      const terms = Array.from({ length: 100 }, (_, i) => `LongTerm${i} ${'x'.repeat(40)}`);
      const result = __testables.buildDeepGramProviderOptions({
        model: 'nova-3',
        keyTerms: terms
      });
      expect(result.keyTerms.length).to.be.lessThan(100);
      expect(result.providerWarnings).to.include('DEEPGRAM_KEY_TERMS_TOTAL_CHARS_TRUNCATED');
    });
  });

  // --- buildRevAIProviderOptions ---
  describe('buildRevAIProviderOptions', () => {
    it('terms within 255 chars: returns customVocabularies with phrases, no warnings', () => {
      const result = __testables.buildRevAIProviderOptions({ keyTerms: ['council', 'bylaw'] });
      expect(result.customVocabularies).to.deep.equal([{ phrases: ['council', 'bylaw'] }]);
      expect(result.providerWarnings).to.deep.equal([]);
    });

    it('a term >255 chars: filtered out with warning', () => {
      const longTerm = 'x'.repeat(256);
      const result = __testables.buildRevAIProviderOptions({ keyTerms: ['council', longTerm] });
      expect(result.customVocabularies).to.deep.equal([{ phrases: ['council'] }]);
      expect(result.providerWarnings).to.include('REVAI_KEY_TERM_PHRASE_TOO_LONG_FILTERED');
    });

    it('all terms >255 chars: customVocabularies empty, emits REVAI_IGNORED_KEY_TERMS', () => {
      const longTerm = 'y'.repeat(256);
      const result = __testables.buildRevAIProviderOptions({ keyTerms: [longTerm] });
      expect(result.customVocabularies).to.deep.equal([]);
      expect(result.providerWarnings).to.include('REVAI_KEY_TERM_PHRASE_TOO_LONG_FILTERED');
      expect(result.providerWarnings).to.include('REVAI_IGNORED_KEY_TERMS');
    });

    it('no terms: customVocabularies is empty array, no warnings', () => {
      const result = __testables.buildRevAIProviderOptions({});
      expect(result.customVocabularies).to.deep.equal([]);
      expect(result.providerWarnings).to.deep.equal([]);
    });

    it('deduplication is applied before 255-char check (duplicates removed by normalize)', () => {
      const result = __testables.buildRevAIProviderOptions({ keyTerms: ['council', 'council', 'bylaw'] });
      expect(result.customVocabularies).to.deep.equal([{ phrases: ['council', 'bylaw'] }]);
    });
  });
});

describe('Hint debug unification', () => {
  it('exposes a single providerSubmission keyTerms field', () => {
    const unified = __testables.buildUnifiedHintDebug({
      aiHintDebug: {
        isEnabled: true,
        isApplied: true,
        llmProvider: 'openai',
        finalKeyTermCount: 2,
        finalKeyTermsFull: ['A', 'B']
      },
      providerHintDebug: {
        requestedKeyTermCount: 3,
        requestedKeyTermsOriginal: ['September 25.pdf', 'OHM Advisors', '10-20-2025.pdf'],
        requestedKeyTermsSanitized: ['September 25', 'OHM Advisors'],
        keyTermCount: 0,
        keyTerms: [],
        keyTermsPreview: [],
        didRetryWithoutKeyTerms: true
      },
      optionWarnings: ['DEEPGRAM_RETRIED_WITHOUT_KEY_TERMS_AFTER_400']
    });

    expect(unified.providerSubmission.requestedKeyTermCount).to.equal(3);
    expect(unified.providerSubmission.keyTerms).to.deep.equal([]);
    expect(unified.providerSubmission.didRetryWithoutKeyTerms).to.equal(true);
    expect(unified.providerSubmission).to.not.have.property('requestedKeyTerms');
    expect(unified.providerSubmission).to.not.have.property('submittedKeyTerms');
    expect(unified.extraction.finalKeyTermCount).to.equal(2);
    expect(unified.extraction).to.not.have.property('finalKeyTerms');
  });

  it('falls back to sanitized requested terms when submitted terms are absent', () => {
    const unified = __testables.buildUnifiedHintDebug({
      providerHintDebug: {
        requestedKeyTermCount: 2,
        requestedKeyTermsSanitized: ['September 25', 'OHM Advisors']
      }
    });

    expect(unified.providerSubmission.keyTerms).to.deep.equal(['September 25', 'OHM Advisors']);
    expect(unified.providerSubmission.keyTermCount).to.equal(2);
  });

  it('exposes aiRequest failure reason when llm is not used', () => {
    const unified = __testables.buildUnifiedHintDebug({
      aiHintDebug: {
        isEnabled: true,
        isApplied: true,
        isLLMUsed: false,
        llmFailureReason: 'llm-call-failed',
        llmFailureCode: 'llm-http-error',
        llmFailureMessage: 'OpenAI request failed with status 401',
        llmFailureDetails: { httpStatus: 401, provider: 'openai' }
      }
    });

    expect(unified.aiRequest.isLLMUsed).to.equal(false);
    expect(unified.aiRequest.failureReason).to.equal('llm-call-failed');
    expect(unified.aiRequest.failureCode).to.equal('llm-http-error');
    expect(unified.aiRequest.failureMessage).to.match(/status 401/i);
    expect(unified.aiRequest.failureDetails).to.deep.equal({ httpStatus: 401, provider: 'openai' });
  });
});

describe('Provider option warning details', () => {
  it('captures LLM failure message for proper noun extraction failures', () => {
    const details = __testables.buildProviderOptionWarningDetails({
      optionWarnings: ['EVENT_HINTS_PROPER_NOUN_EXTRACTION_FAILED'],
      aiHintDebug: {
        llmFailureReason: 'llm-call-failed',
        llmFailureCode: 'llm-http-error',
        llmFailureMessage: 'OpenAI request failed with status 401',
        llmFailureDetails: { httpStatus: 401, provider: 'openai' }
      }
    });

    expect(details.EVENT_HINTS_PROPER_NOUN_EXTRACTION_FAILED).to.equal(
      'OpenAI request failed with status 401 | details={"httpStatus":401,"provider":"openai"}'
    );
  });

  it('falls back to reason+code when LLM failure message is missing', () => {
    const details = __testables.buildProviderOptionWarningDetails({
      optionWarnings: ['EVENT_HINTS_PROPER_NOUN_EXTRACTION_FAILED'],
      aiHintDebug: {
        llmFailureReason: 'missing-api-key',
        llmFailureCode: 'openai-key-missing',
        llmFailureMessage: ''
      }
    });

    expect(details.EVENT_HINTS_PROPER_NOUN_EXTRACTION_FAILED).to.equal(
      'AI proper-noun extraction failed (missing-api-key, openai-key-missing)'
    );
  });
});

describe('Silence interval helpers', () => {
  it('filters silence intervals by minimum duration seconds', () => {
    const intervals = [
      { startMS: 0, endMS: 999, durationMS: 999 },
      { startMS: 1000, endMS: 3000, durationMS: 2000 },
      { startMS: 3500, endMS: 9000, durationMS: 5500 }
    ];
    const filtered = __testables.filterSilenceIntervalsByMinSecs(intervals, 2);
    expect(filtered).to.deep.equal([
      { startMS: 1000, endMS: 3000, durationMS: 2000 },
      { startMS: 3500, endMS: 9000, durationMS: 5500 }
    ]);
  });

  it('sums total silence duration in milliseconds', () => {
    const intervals = [
      { durationMS: 500 },
      { durationMS: 1200 },
      { durationMS: 300 }
    ];
    expect(__testables.sumSilenceDurationMS(intervals)).to.equal(2000);
    expect(__testables.sumSilenceDurationMS([])).to.equal(0);
  });
});

describe('Silence extraction reuse/recreate', () => {
  it('reuses existing silence extraction when present and force recreate is false', async () => {
    let analyzeCalls = 0;
    const client = {
      listExtractions: async () => ([{
        _id: 'EX1',
        extractionKind: 'SILENCE_DETECTION',
        extractionData: {
          mediaDurationMS: 9000,
          analyzedAt: '2026-02-24T00:00:00.000Z',
          volumedetectMeta: {
            n_samples: 834295808,
            mean_volume: '-40.3 dB',
            max_volume: '-3.7 dB',
            histogram_21db: 375479,
            tool: 'ffmpeg:volumedetect'
          },
          silenceIntervals: [
            { startMS: 1000, endMS: 3000, durationMS: 2000 },
            { startMS: 5000, endMS: 7000, durationMS: 2000 }
          ],
          silenceAnalysisMeta: {
            noiseDB: -35,
            minSilenceSecs: 1,
            tool: 'ffmpeg:silencedetect'
          }
        }
      }]),
      hardDeleteExtractionAndItems: async () => {
        throw new Error('unexpected hard delete');
      },
      createExtraction: async () => {
        throw new Error('unexpected createExtraction');
      },
      createExtractionItems: async () => {
        throw new Error('unexpected createExtractionItems');
      }
    };

    const result = await __testables.resolveSilenceForTranscription({
      client,
      customerID: 'C1',
      mediaID: 'M1',
      externalMediaID: 'CDSV1Path:m1.mp4',
      audioPath: '/tmp/test.aac',
      silenceNoiseDB: -35,
      silenceDetectMinSecs: 1,
      silenceMinSecs: 2,
      silenceMinSecsToSave: 2,
      isSilenceForceRecreate: false,
      analyzeSilenceHandler: async () => {
        analyzeCalls += 1;
        return {};
      }
    });

    expect(analyzeCalls).to.equal(0);
    expect(result.debug.source).to.equal('existing');
    expect(result.debug.isReusedExisting).to.equal(true);
    expect(result.debug.extractionID).to.equal('EX1');
    expect(result.silenceAnalysis.mediaDurationMS).to.equal(9000);
    expect(result.silenceAnalysis.analyzedAt).to.equal('2026-02-24T00:00:00.000Z');
    expect(result.silenceAnalysis.silenceAnalysisMeta.totalDetectedSilenceCount).to.equal(2);
    expect(result.silenceAnalysis.silenceAnalysisMeta.minDetectedSilenceLengthMS).to.equal(2000);
    expect(result.silenceAnalysis.silenceAnalysisMeta.maxDetectedSilenceLengthMS).to.equal(2000);
    expect(result.silenceAnalysis.volumedetectMeta).to.deep.equal({
      n_samples: 834295808,
      mean_volume: '-40.3 dB',
      max_volume: '-3.7 dB',
      histogram_21db: 375479,
      tool: 'ffmpeg:volumedetect'
    });
    expect(result.savedSilenceIntervals).to.deep.equal([
      { startMS: 1000, endMS: 3000, durationMS: 2000 },
      { startMS: 5000, endMS: 7000, durationMS: 2000 }
    ]);
  });

  it('generates new silence extraction data when no existing extraction is found', async () => {
    let createExtractionPayload = null;
    const client = {
      listExtractions: async () => [],
      hardDeleteExtractionAndItems: async () => {
        throw new Error('unexpected hard delete');
      },
      createExtraction: async (_customerID, payload) => {
        createExtractionPayload = payload;
        return { _id: 'EX2' };
      },
      createExtractionItems: async () => {
        throw new Error('unexpected createExtractionItems');
      }
    };

    const result = await __testables.resolveSilenceForTranscription({
      client,
      customerID: 'C1',
      mediaID: 'M1',
      externalMediaID: 'CDSV1Path:m1.mp4',
      audioPath: '/tmp/test.aac',
      silenceNoiseDB: -35,
      silenceDetectMinSecs: 1,
      silenceMinSecs: 2,
      silenceMinSecsToSave: 2,
      isSilenceForceRecreate: false,
      cdsJobID: 'JOB-SILENCE-1',
      analyzeSilenceHandler: async () => ({
        silenceIntervals: [{ startMS: 2500, endMS: 6000, durationMS: 3500 }],
        totalSilenceMS: 3500,
        mediaDurationMS: 20000,
        isSilenceAnalyzed: true,
        volumedetectMeta: {
          n_samples: 834295808,
          mean_volume: '-40.3 dB',
          max_volume: '-3.7 dB',
          histogram_3db: 80,
          histogram_4db: 61
        },
        silenceAnalysisMeta: {
          noiseDB: -35,
          minSilenceSecs: 1,
          tool: 'ffmpeg:silencedetect'
        }
      })
    });

    expect(result.debug.source).to.equal('generated');
    expect(result.debug.extractionID).to.equal('EX2');
    expect(createExtractionPayload.extractionKind).to.equal('SILENCE_DETECTION');
    expect(createExtractionPayload.cdsJobID).to.equal('JOB-SILENCE-1');
    expect(createExtractionPayload.offsetUnit).to.equal('MS');
    expect(createExtractionPayload.processingDurationMS).to.be.a('number');
    expect(createExtractionPayload.processingDurationMS).to.be.at.least(0);
    expect(createExtractionPayload.extractionData.mediaDurationMS).to.equal(20000);
    expect(createExtractionPayload.extractionData.analyzedAt).to.be.a('string');
    expect(createExtractionPayload.extractionData.silenceAnalysisMeta.totalDetectedSilenceCount).to.equal(1);
    expect(createExtractionPayload.extractionData.silenceAnalysisMeta.minDetectedSilenceLengthMS).to.equal(3500);
    expect(createExtractionPayload.extractionData.silenceAnalysisMeta.maxDetectedSilenceLengthMS).to.equal(3500);
    expect(createExtractionPayload.extractionData.volumedetectMeta.n_samples).to.equal(834295808);
    expect(createExtractionPayload.extractionData.volumedetectMeta.mean_volume).to.equal('-40.3 dB');
    expect(createExtractionPayload.extractionData.volumedetectMeta.max_volume).to.equal('-3.7 dB');
    expect(createExtractionPayload.extractionData.volumedetectMeta.histogram_3db).to.equal(80);
    expect(createExtractionPayload.extractionData.volumedetectMeta.histogram_4db).to.equal(61);
    expect(createExtractionPayload.extractionData.volumedetectMeta.tool).to.equal('ffmpeg:volumedetect');
    expect(createExtractionPayload.extractionData.silenceIntervals).to.deep.equal([
      { startMS: 2500, endMS: 6000, durationMS: 3500 }
    ]);
  });

  it('force recreates silence extraction when silenceForceRecreate is true', async () => {
    const deletedExtractionIDs = [];
    const client = {
      listExtractions: async (_customerID, query) => {
        if (query.v1TargetClassName === 'MEDIA' && query.v1TargetID === 12345) {
          return [{ _id: 'EX-OLD-CANONICAL' }];
        }
        return [{ _id: 'EX-OLD-LEGACY' }];
      },
      hardDeleteExtractionAndItems: async (_customerID, extractionID) => {
        deletedExtractionIDs.push(extractionID);
      },
      createExtraction: async () => ({ _id: 'EX-NEW' }),
      createExtractionItems: async () => []
    };

    const result = await __testables.resolveSilenceForTranscription({
      client,
      customerID: 'C1',
      mediaID: 'M1',
      externalMediaID: 'CDSV1CustomerMediaID:12345',
      compatibilityExternalMediaIDs: ['CDSV1Path:m1.mp4'],
      externalMediaPath: 'CDSV1Path:m1.mp4',
      audioPath: '/tmp/test.aac',
      silenceNoiseDB: -35,
      silenceDetectMinSecs: 1,
      silenceMinSecs: 2,
      silenceMinSecsToSave: 2,
      isSilenceForceRecreate: true,
      analyzeSilenceHandler: async () => ({
        silenceIntervals: [],
        totalSilenceMS: 0,
        mediaDurationMS: 20000,
        isSilenceAnalyzed: true,
        silenceAnalysisMeta: {
          noiseDB: -35,
          minSilenceSecs: 1,
          tool: 'ffmpeg:silencedetect'
        }
      })
    });

    expect(deletedExtractionIDs).to.deep.equal(['EX-OLD-CANONICAL', 'EX-OLD-LEGACY']);
    expect(result.debug.source).to.equal('recreated');
    expect(result.debug.isForceRecreate).to.equal(true);
    expect(result.debug.reusedExtractionID).to.equal('EX-OLD-CANONICAL');
    expect(result.debug.extractionID).to.equal('EX-NEW');
  });

  it('stores externalMediaPath in silence extraction metadata', async () => {
    let createExtractionPayload = null;
    const client = {
      listExtractions: async () => [],
      hardDeleteExtractionAndItems: async () => {},
      createExtraction: async (_customerID, payload) => {
        createExtractionPayload = payload;
        return { _id: 'EX3' };
      },
      createExtractionItems: async () => []
    };

    await __testables.resolveSilenceForTranscription({
      client,
      customerID: 'C1',
      mediaID: 'M1',
      externalMediaID: 'CDSV1CustomerMediaID:999',
      externalMediaPath: 'CDSV1Path:m1.mp4',
      audioPath: '/tmp/test.aac',
      silenceNoiseDB: -35,
      silenceDetectMinSecs: 1,
      silenceMinSecs: 2,
      silenceMinSecsToSave: 2,
      isSilenceForceRecreate: false,
      analyzeSilenceHandler: async () => ({
        silenceIntervals: [],
        totalSilenceMS: 0,
        mediaDurationMS: 1000,
        isSilenceAnalyzed: true,
        volumedetectMeta: {},
        silenceAnalysisMeta: { noiseDB: -35, minSilenceSecs: 1, tool: 'ffmpeg' }
      })
    });

    expect(createExtractionPayload.extractionData.externalMediaPath).to.equal('CDSV1Path:m1.mp4');
    expect(createExtractionPayload.extractionData.silenceAnalysisMeta.totalDetectedSilenceCount).to.equal(0);
    expect(createExtractionPayload.extractionData.silenceAnalysisMeta.minDetectedSilenceLengthMS).to.equal(0);
    expect(createExtractionPayload.extractionData.silenceAnalysisMeta.maxDetectedSilenceLengthMS).to.equal(0);
    expect(createExtractionPayload.extractionData.mediaDurationMS).to.equal(1000);
    expect(createExtractionPayload.processingDurationMS).to.be.a('number');
    expect(createExtractionPayload.extractionData.volumedetectMeta.tool).to.equal('ffmpeg:volumedetect');
    expect(createExtractionPayload.extractionData.analyzedAt).to.be.a('string');
  });
});
