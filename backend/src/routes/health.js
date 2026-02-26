/**
 * Health and Connection Test Routes
 * 
 * Provides endpoints for checking service health and external connectivity.
 */

import { testAllConnections, testBackblazeConnection, testDFWConnection, testAssemblyAIConnection, testDeepGramConnection, testCoreAPIConnection } from '../utils/connectionTester.js';

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export default async function healthRoutes(fastify) {
  
  // Full connection test (all services)
  fastify.get('/connections', {
    schema: {
      tags: ['Health'],
      summary: 'Test all external service connections',
      description: 'Tests connectivity to CoreAPI, Backblaze B2, DFW HTTP, AssemblyAI, and DeepGram. Returns status for each service.',
      querystring: {
        type: 'object',
        properties: {
          dfwTestFile: {
            type: 'string',
            description: 'Optional file path to test on DFW server (HEAD request)'
          }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            summary: {
              type: 'object',
              properties: {
                totalServices: { type: 'number' },
                successful: { type: 'number' },
                failed: { type: 'number' },
                notConfigured: { type: 'number' },
                timestamp: { type: 'string' }
              }
            },
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  service: { type: 'string' },
                  success: { type: 'boolean' },
                  latencyMS: { type: 'number' },
                  message: { type: 'string' },
                  details: { type: 'object' }
                }
              }
            }
          }
        }
      }
    }
  }, async (request) => {
    const { dfwTestFile } = request.query;
    return testAllConnections({ dfwTestFile });
  });

  // Individual service tests
  fastify.get('/connections/coreapi', {
    schema: {
      tags: ['Health'],
      summary: 'Test CoreAPI connection',
      description: 'Tests connectivity to the CoreAPI service.'
    }
  }, async () => {
    return testCoreAPIConnection();
  });

  fastify.get('/connections/backblaze', {
    schema: {
      tags: ['Health'],
      summary: 'Test Backblaze B2 connection',
      description: 'Tests connectivity to Backblaze B2 (S3-compatible) storage.'
    }
  }, async () => {
    return testBackblazeConnection();
  });

  fastify.get('/connections/dfw', {
    schema: {
      tags: ['Health'],
      summary: 'Test DFW HTTP connection',
      description: 'Tests connectivity to the DFW authoritative HTTP server.',
      querystring: {
        type: 'object',
        properties: {
          testFile: {
            type: 'string',
            description: 'Optional file path to test (HEAD request)'
          }
        }
      }
    }
  }, async (request) => {
    return testDFWConnection(request.query.testFile);
  });

  fastify.get('/connections/assemblyai', {
    schema: {
      tags: ['Health'],
      summary: 'Test AssemblyAI connection',
      description: 'Tests connectivity to the AssemblyAI transcription API.'
    }
  }, async () => {
    return testAssemblyAIConnection();
  });

  fastify.get('/connections/deepgram', {
    schema: {
      tags: ['Health'],
      summary: 'Test DeepGram connection',
      description: 'Tests connectivity to the DeepGram transcription API.'
    }
  }, async () => {
    return testDeepGramConnection();
  });
}
