/**
 * Transcript Ingestion API Routes
 * 
 * Provides endpoints for the three ingestion paths:
 * 1. POST /ingest/provider-json - Import from provider JSON (AssemblyAI, DeepGram)
 * 2. POST /ingest/caption-file - Import from SRT/VTT caption file
 * 3. POST /ingest/transcribe-media - Submit media to provider + queue polling (async)
 */

import { ingestProviderJSON, ingestCaptionFile, submitMediaForTranscription, JobScopes } from '../services/transcriptIngestion.js';
import { getCoreApiClient } from '../clients/coreApiClient.js';
import { finalizeTranscription } from '../services/transcriptionFinalize.js';

/**
 * Register ingestion routes
 * @param {import('fastify').FastifyInstance} fastify - Fastify instance
 */
export default async function ingestRoutes(fastify, opts = {}) {
  const submitMediaForTranscriptionHandler = opts.submitMediaForTranscription || submitMediaForTranscription;
  const getCoreApiClientHandler = opts.getCoreApiClient || getCoreApiClient;
  const finalizeTranscriptionHandler = opts.finalizeTranscription || finalizeTranscription;

  // ==================== Path 1: Provider JSON Import ====================

  fastify.post('/provider-json', {
    schema: {
      tags: ['Transcript Ingestion'],
      summary: 'Import transcript from provider JSON',
      description: `
Import a transcript from a transcription provider's JSON response (AssemblyAI, DeepGram, or Rev.ai).
The provider format will be auto-detected, or can be specified explicitly.

**Required:** customerID (query param) and one of mediaID, externalMediaID, or mediaPath in the body.

**Example payload:**
\`\`\`json
{
  "mediaID": "01ABCDEF...",
  "content": { /* AssemblyAI or DeepGram JSON response */ }
}
\`\`\`
      `,
      querystring: {
        type: 'object',
        required: ['customerID'],
        properties: {
          customerID: { type: 'string', description: 'Customer ID' }
        }
      },
      body: {
        type: 'object',
        required: ['content'],
        properties: {
          mediaID: { type: 'string', description: 'Media ID (ULID)' },
          cdsJobID: { type: 'string', description: 'Producer job ID to persist on created extraction/transcript.' },
          cdsWorkerID: { type: 'string', description: 'Producer worker ID to persist in providerMeta.' },
          externalMediaID: {
            type: 'string',
            description: 'External media ID (CDSV1CustomerMediaID:<id> preferred; also accepts CDSV1MediaID:<id> or CDSV1Path:<path>).'
          },
          content: {
            type: 'object',
            description: 'Provider JSON response (AssemblyAI or DeepGram format)',
            additionalProperties: true
          },
          provider: {
            type: 'string',
            enum: ['ASSEMBLYAI', 'DEEPGRAM', 'REVAI'],
            description: 'Force specific provider (auto-detected if omitted)'
          }
        }
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            transcriptID: { type: 'string' },
            utteranceCount: { type: 'number' },
            details: { type: 'object' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { customerID } = request.query;
    const { mediaID, externalMediaID, content, provider, cdsJobID, cdsWorkerID } = request.body;

    const result = await ingestProviderJSON(content, {
      customerID,
      mediaID,
      externalMediaID,
      provider,
      ...(cdsJobID ? { cdsJobID } : {}),
      ...(cdsWorkerID ? { cdsWorkerID } : {})
    });

    if (result.success) {
      return reply.status(201).send(result);
    } else {
      return reply.status(400).send(result);
    }
  });

  // ==================== Path 3: Caption File Import ====================

  fastify.post('/caption-file', {
    schema: {
      tags: ['Transcript Ingestion'],
      summary: 'Import transcript from caption file (SRT/VTT)',
      description: `
Import a transcript from an SRT or VTT caption file.
The format will be auto-detected from the content.

Speaker detection: If enabled, will attempt to extract speaker names from common patterns
like "[Speaker Name]:", ">>Speaker:", etc.

**Required:** customerID (query param) and either mediaID or externalMediaID in the body.

**Example payload:**
\`\`\`json
{
  "mediaID": "01ABCDEF...",
  "content": "1\\n00:00:02,160 --> 00:00:17,200\\n[Mayor]: The meeting will come to order.\\n\\n2\\n...",
  "captionerName": "3PLAYMEDIA",
  "extractSpeakers": true
}
\`\`\`
      `,
      querystring: {
        type: 'object',
        required: ['customerID'],
        properties: {
          customerID: { type: 'string', description: 'Customer ID' }
        }
      },
      body: {
        type: 'object',
        required: ['content'],
        properties: {
          mediaID: { type: 'string', description: 'Media ID (ULID)' },
          cdsJobID: { type: 'string', description: 'Producer job ID to persist on created extraction/transcript.' },
          cdsWorkerID: { type: 'string', description: 'Producer worker ID to persist in providerMeta.' },
          externalMediaID: {
            type: 'string',
            description: 'External media ID (CDSV1CustomerMediaID:<id> preferred; also accepts CDSV1MediaID:<id> or CDSV1Path:<path>).'
          },
          content: { type: 'string', description: 'SRT or VTT file content' },
          captionerName: {
            type: 'string',
            description: 'Name of captioning service/person (e.g., "3PLAYMEDIA", "VERBIT")'
          },
          extractSpeakers: {
            type: 'boolean',
            default: true,
            description: 'Attempt to extract speaker names from text patterns'
          }
        }
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            transcriptID: { type: 'string' },
            utteranceCount: { type: 'number' },
            details: { type: 'object' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { customerID } = request.query;
    const { mediaID, externalMediaID, content, captionerName, extractSpeakers, cdsJobID, cdsWorkerID } = request.body;

    const result = await ingestCaptionFile(content, {
      customerID,
      mediaID,
      externalMediaID,
      captionerName,
      extractSpeakers,
      ...(cdsJobID ? { cdsJobID } : {}),
      ...(cdsWorkerID ? { cdsWorkerID } : {})
    });

    if (result.success) {
      return reply.status(201).send(result);
    } else {
      return reply.status(400).send(result);
    }
  });

  // ==================== Path 2: Media Transcription (Async Job) ====================

  fastify.post('/transcribe-media', {
    schema: {
      tags: ['Transcript Ingestion'],
      summary: 'Submit media for transcription (async job)',
      description: `
Submit a media file for transcription by an external provider.
This endpoint will:
1. Use local AAC cache when available
2. Otherwise download MP4 from DFW and extract AAC
3. Upload AAC to transcription provider
4. Create pending transcript in CoreAPI
5. Submit a CoreAPI polling job for completion handling

Returns transcript and job identifiers for tracking.

**Required:** customerID (query param) and either mediaID or externalMediaID in the body.

**Note:** This endpoint returns after provider submission + queueing poll job.
      `,
      querystring: {
        type: 'object',
        required: ['customerID'],
        properties: {
          customerID: { type: 'string', description: 'Customer ID' }
        }
      },
      body: {
        type: 'object',
        properties: {
          cdsV1EventID: {
            type: 'number',
            description: 'CustomerAPI v1 event ID used to resolve primary media and augment keyTerms from event content.'
          },
          cdsJobID: { type: 'string', description: 'Producer job ID to persist on created extraction/transcript.' },
          cdsWorkerID: { type: 'string', description: 'Producer worker ID to persist in providerMeta.' },
          mediaID: { type: 'string', description: 'Media ID (ULID)' },
          externalMediaID: {
            type: 'string',
            description: 'External media ID (CDSV1CustomerMediaID:<id> preferred; also accepts CDSV1MediaID:<id> or CDSV1Path:<path>).'
          },
          mediaPath: { type: 'string', description: 'Relative media path (e.g., "meeting123/meeting123.mp4")' },
          provider: {
            type: 'string',
            enum: ['ASSEMBLYAI', 'DEEPGRAM', 'REVAI'],
            default: 'ASSEMBLYAI',
            description: 'Transcription provider to use'
          },
          options: {
            type: 'object',
            description: 'Provider-specific options',
            properties: {
              speakerLabels: { type: 'boolean', default: true, description: 'Enable speaker diarization' },
              isDiarizationEnabled: { type: 'boolean', description: 'Common diarization toggle across providers' },
              speakerCountExpected: { type: 'number', description: 'Expected speaker count hint for providers that support it' },
              speakerCountMin: { type: 'number', description: 'Minimum expected speaker count hint for providers that support it' },
              speakerCountMax: { type: 'number', description: 'Maximum expected speaker count hint for providers that support it' },
              keyTerms: { type: 'array', items: { type: 'string' }, description: 'Key terms / custom vocabulary hints' },
              hintBoostParam: {
                type: 'string',
                enum: ['low', 'default', 'high'],
                description: 'AssemblyAI boost intensity for word_boost (non-SLAM-1 models only). Ignored by Deepgram and Rev.ai.'
              },
              punctuate: { type: 'boolean', default: true, description: 'Add punctuation' },
              languageCode: { type: 'string', default: 'en', description: 'Language code' },
              model: { type: 'string', description: 'Provider model (e.g., Deepgram: nova-3)' },
              silenceNoiseDB: { type: 'number', description: 'Silence detection threshold in dB (e.g., -35)' },
              silenceMinSecs: { type: 'number', description: 'Minimum silence duration in seconds' },
              silenceForceRecreate: {
                type: 'boolean',
                description: 'If true, delete any existing silence extraction and regenerate it before transcription.'
              },
              isChunkingEnabled: { type: 'boolean', description: 'Split into non-silent chunks before provider submission' },
              maxSegmentCount: { type: 'number', description: 'Maximum allowed chunk count before request fails' },
              useAIKeyHintExtraction: {
                type: 'boolean',
                description: 'When true with cdsV1EventID, extract/merge AI key terms from event data before provider submission.'
              },
              isAIKeyHintExtractionFailureFatal: {
                type: 'boolean',
                default: true,
                description: 'When true (default), fail transcription submission if AI key hint extraction fails; when false, continue with warning fallback.'
              }
            }
          }
        }
      },
      response: {
        202: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            transcriptID: { type: 'string' },
            coreApiJobID: { type: 'string' },
            providerJobID: { type: 'string' },
            mediaSource: { type: 'string' },
            audioExtracted: { type: 'boolean' },
            details: {
              type: 'object',
              properties: {
                optionWarnings: {
                  type: 'array',
                  items: { type: 'string' }
                }
              },
              additionalProperties: true
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { customerID } = request.query;
    const { cdsV1EventID, mediaID, externalMediaID, provider, cdsJobID, cdsWorkerID } = request.body;
    const { mediaPath } = request.body;
    const options = (request.body?.options && typeof request.body.options === 'object')
      ? { ...request.body.options }
      : {};

    if (!mediaID && !externalMediaID && !mediaPath) {
      if (cdsV1EventID !== undefined && cdsV1EventID !== null) {
        // Allow service layer to resolve mediaPath + keyTerms from full-event data.
      } else
      {
        return reply.status(400).send({
          success: false,
          error: 'One of mediaID, externalMediaID, mediaPath, or cdsV1EventID is required'
        });
      }
    }

    const result = await submitMediaForTranscriptionHandler({
      customerID,
      mediaID,
      externalMediaID,
      mediaPath,
      cdsV1EventID,
      provider: provider || 'ASSEMBLYAI',
      options,
      ...(cdsJobID ? { cdsJobID } : {}),
      ...(cdsWorkerID ? { cdsWorkerID } : {})
    });

    if (!result.success) {
      return reply.status(400).send(result);
    }

    return reply.status(202).send(result);
  });

  // ==================== Silence Extraction (Async Job) ====================

  fastify.post('/extract-silence', {
    schema: {
      tags: ['Transcript Ingestion'],
      summary: 'Run silence extraction only (async job)',
      description: `
Submit media for silence extraction without STT submission.

This creates an async job that will:
1. Resolve media path
2. Locate/download audio and extract AAC when needed
3. Run silence detection and persist SILENCE_DETECTION extraction metadata

**Required:** customerID (query param) and one of mediaID, externalMediaID, mediaPath, or cdsV1MediaID.
      `,
      querystring: {
        type: 'object',
        required: ['customerID'],
        properties: {
          customerID: { type: 'string', description: 'Customer ID' }
        }
      },
      body: {
        type: 'object',
        properties: {
          mediaID: { type: 'string', description: 'Media ID (ULID)' },
          cdsMediaID: { type: 'string', description: 'Compatibility media ID alias' },
          cdsV1MediaID: { type: 'number', description: 'Legacy CustomerAPI media ID' },
          cdsV1EventID: { type: 'number', description: 'CustomerAPI v1 event ID used to resolve primary media' },
          externalMediaID: {
            type: 'string',
            description: 'External media ID (CDSV1CustomerMediaID:<id> preferred; also accepts CDSV1MediaID:<id> or CDSV1Path:<path>).'
          },
          mediaPath: { type: 'string', description: 'Relative media path (e.g., "meeting123/meeting123.mp4")' },
          options: {
            type: 'object',
            properties: {
              silenceNoiseDB: { type: 'number', description: 'Silence detection threshold in dB (e.g., -35)' },
              silenceMinSecs: { type: 'number', description: 'Minimum silence duration in seconds' },
              silenceForceRecreate: {
                type: 'boolean',
                description: 'If true, delete any existing silence extraction and regenerate it.'
              }
            }
          }
        }
      },
      response: {
        202: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            jobID: { type: 'string' },
            message: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { customerID } = request.query;
    const { mediaID, cdsMediaID, cdsV1MediaID, cdsV1EventID, externalMediaID, mediaPath } = request.body;
    const options = (request.body?.options && typeof request.body.options === 'object')
      ? { ...request.body.options }
      : {};

    if (!mediaID && !cdsMediaID && !cdsV1MediaID && !cdsV1EventID && !externalMediaID && !mediaPath) {
      return reply.status(400).send({
        success: false,
        error: 'One of mediaID, cdsMediaID, cdsV1MediaID, cdsV1EventID, externalMediaID, or mediaPath is required'
      });
    }

    try {
      const client = getCoreApiClientHandler();
      const jobResult = await client.submitJob(customerID, {
        scope: JobScopes.EXTRACT_SILENCE_MEDIA,
        payload: {
          customerID,
          mediaID,
          cdsMediaID,
          cdsV1MediaID,
          cdsV1EventID,
          externalMediaID,
          mediaPath,
          options
        },
        timeoutSeconds: 1800
      });

      return reply.status(202).send({
        success: true,
        jobID: jobResult.jobID,
        message: 'Silence extraction job submitted. Use job queue endpoints to track progress.'
      });
    } catch (err) {
      return reply.status(500).send({
        success: false,
        error: err.message
      });
    }
  });

  // ==================== Caption Enhancement (Async Job) ====================

  fastify.post('/enhance-captions', {
    schema: {
      tags: ['Transcript Ingestion'],
      summary: 'Enhance caption file with speaker diarization (async job)',
      description: `
Send a caption file to a transcription provider for speaker diarization enhancement.
Useful when you have human-generated captions without speaker identification.

This creates an async job that will:
1. Extract text from the caption file
2. Send to provider with original audio for alignment
3. Receive speaker-labeled utterances
4. Update the transcript with speaker information

**Required:** customerID (query param), transcriptID (existing transcript to enhance), 
and either mediaID or externalMediaID.
      `,
      querystring: {
        type: 'object',
        required: ['customerID'],
        properties: {
          customerID: { type: 'string', description: 'Customer ID' }
        }
      },
      body: {
        type: 'object',
        required: ['transcriptID'],
        properties: {
          transcriptID: { type: 'string', description: 'Existing transcript ID to enhance' },
          mediaID: { type: 'string', description: 'Media ID (ULID)' },
          externalMediaID: { type: 'string', description: 'External media ID' },
          provider: {
            type: 'string',
            enum: ['ASSEMBLYAI', 'DEEPGRAM', 'REVAI'],
            default: 'ASSEMBLYAI',
            description: 'Provider to use for enhancement'
          }
        }
      },
      response: {
        202: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            jobID: { type: 'string' },
            message: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { customerID } = request.query;
    const { transcriptID, mediaID, externalMediaID, provider } = request.body;

    if (!mediaID && !externalMediaID) {
      return reply.status(400).send({
        success: false,
        error: 'Either mediaID or externalMediaID is required for enhancement'
      });
    }

    try {
      const client = getCoreApiClientHandler();

      // Submit job to queue
      const jobResult = await client.submitJob(customerID, {
        scope: JobScopes.ENHANCE_CAPTIONS,
        payload: {
          customerID,
          transcriptID,
          mediaID,
          externalMediaID,
          provider: provider || 'ASSEMBLYAI'
        },
        timeoutSeconds: 1800  // 30 minute timeout for enhancement
      });

      return reply.status(202).send({
        success: true,
        jobID: jobResult.jobID,
        message: 'Enhancement job submitted. Use job queue endpoints to track progress.'
      });
    } catch (err) {
      return reply.status(500).send({
        success: false,
        error: err.message
      });
    }
  });

  // ==================== Transcription Completion ====================

  fastify.post('/transcription-complete', {
    schema: {
      tags: ['Transcript Ingestion'],
      summary: 'Finalize transcription payload into transcript + utterances',
      description: `
Finalize provider output into persisted transcript data.

Supports:
1. Single provider response (\`providerResponse\`)
2. Chunked provider responses (\`chunkResponses\` + \`chunkMap\`)

This endpoint is intended for poll-completion handlers that receive completed provider payloads.
      `,
      querystring: {
        type: 'object',
        required: ['customerID'],
        properties: {
          customerID: { type: 'string', description: 'Customer ID' }
        }
      },
      body: {
        type: 'object',
        required: ['transcriptID', 'provider'],
        properties: {
          transcriptID: { type: 'string', description: 'Transcript ID to finalize' },
          cdsJobID: { type: 'string', description: 'Producer job ID to persist on finalized transcript.' },
          cdsWorkerID: { type: 'string', description: 'Producer worker ID to persist in providerMeta.' },
          provider: {
            type: 'string',
            enum: ['ASSEMBLYAI', 'DEEPGRAM', 'REVAI'],
            description: 'Provider that produced the response payload'
          },
          providerResponse: {
            description: 'Single provider response payload (non-chunked flow)',
            oneOf: [{ type: 'object', additionalProperties: true }, { type: 'string' }]
          },
          chunkResponses: {
            type: 'array',
            description: 'Chunked provider responses ordered by chunkIndex',
            items: {
              type: 'object',
              required: ['chunkIndex', 'response'],
              properties: {
                chunkIndex: { type: 'number' },
                response: {
                  oneOf: [{ type: 'object', additionalProperties: true }, { type: 'string' }]
                }
              }
            }
          },
          chunkMap: {
            type: 'array',
            description: 'Chunk map from ingestion-time silence analysis',
            items: {
              type: 'object',
              required: ['chunkIndex', 'originalStartMS', 'originalEndMS', 'chunkStartMS', 'chunkEndMS', 'durationMS'],
              properties: {
                chunkIndex: { type: 'number' },
                originalStartMS: { type: 'number' },
                originalEndMS: { type: 'number' },
                chunkStartMS: { type: 'number' },
                chunkEndMS: { type: 'number' },
                durationMS: { type: 'number' }
              }
            }
          }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            transcriptID: { type: 'string' },
            utteranceCount: { type: 'number' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { customerID } = request.query;
    const { transcriptID, provider, providerResponse, chunkResponses, chunkMap, cdsJobID, cdsWorkerID } = request.body;

    const isChunkedFinalize = Array.isArray(chunkResponses) && chunkResponses.length > 0;
    if (isChunkedFinalize && (!Array.isArray(chunkMap) || chunkMap.length === 0)) {
      return reply.status(400).send({
        success: false,
        error: 'chunkMap is required when chunkResponses are provided'
      });
    }
    if (!isChunkedFinalize && !providerResponse) {
      return reply.status(400).send({
        success: false,
        error: 'providerResponse is required for non-chunked finalization'
      });
    }

    const result = await finalizeTranscriptionHandler({
      customerID,
      transcriptID,
      provider,
      providerResponse,
      chunkResponses,
      chunkMap,
      coreApiClient: getCoreApiClientHandler(),
      executionContext: {
        ...(cdsJobID ? { cdsJobID } : {}),
        ...(cdsWorkerID ? { cdsWorkerID } : {})
      }
    });

    return reply.status(200).send(result);
  });
}
