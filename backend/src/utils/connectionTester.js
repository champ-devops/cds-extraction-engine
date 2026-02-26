/**
 * Connection Tester Utility
 * 
 * Tests connectivity to external services:
 * - Backblaze B2 (S3-compatible storage)
 * - DFW authoritative HTTP server
 * - AI providers (AssemblyAI, DeepGram)
 * - CoreAPI
 */

import { S3Client, ListBucketsCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { request } from 'undici';
import { getConfig } from '../config/appConfig.js';

/**
 * @typedef {object} ConnectionTestResult
 * @property {string} service - Service name
 * @property {boolean} success - Whether connection succeeded
 * @property {number} latencyMS - Response time in milliseconds
 * @property {string} [message] - Success/error message
 * @property {object} [details] - Additional details
 */

/**
 * Test Backblaze B2 (S3-compatible) connectivity
 * @returns {Promise<ConnectionTestResult>}
 */
export async function testBackblazeConnection() {
  const config = getConfig();
  const { offsite } = config.media || {};
  const startTime = Date.now();

  // Check if configured
  if (!offsite?.endpoint || !offsite?.accessKeyId || !offsite?.secretAccessKey) {
    return {
      service: 'backblaze',
      success: false,
      latencyMS: 0,
      message: 'Not configured - missing endpoint, accessKeyId, or secretAccessKey',
      details: {
        hasEndpoint: !!offsite?.endpoint,
        hasAccessKey: !!offsite?.accessKeyId,
        hasSecretKey: !!offsite?.secretAccessKey,
        hasBucket: !!offsite?.bucket
      }
    };
  }

  try {
    const s3Client = new S3Client({
      endpoint: `https://${offsite.endpoint}`,
      region: offsite.region || 'us-west-004',
      credentials: {
        accessKeyId: offsite.accessKeyId,
        secretAccessKey: offsite.secretAccessKey
      },
      forcePathStyle: true // Required for Backblaze B2
    });

    // If bucket is configured, test access to that specific bucket
    if (offsite.bucket) {
      const command = new HeadBucketCommand({ Bucket: offsite.bucket });
      await s3Client.send(command);
      
      return {
        service: 'backblaze',
        success: true,
        latencyMS: Date.now() - startTime,
        message: `Successfully connected to bucket: ${offsite.bucket}`,
        details: {
          endpoint: offsite.endpoint,
          bucket: offsite.bucket,
          region: offsite.region
        }
      };
    }

    // Otherwise just list buckets to verify credentials
    const command = new ListBucketsCommand({});
    const response = await s3Client.send(command);

    return {
      service: 'backblaze',
      success: true,
      latencyMS: Date.now() - startTime,
      message: `Connected. Found ${response.Buckets?.length || 0} bucket(s)`,
      details: {
        endpoint: offsite.endpoint,
        bucketCount: response.Buckets?.length || 0,
        buckets: response.Buckets?.map(b => b.Name) || []
      }
    };
  } catch (error) {
    return {
      service: 'backblaze',
      success: false,
      latencyMS: Date.now() - startTime,
      message: `Connection failed: ${error.message}`,
      details: {
        errorCode: error.Code || error.code,
        errorName: error.name
      }
    };
  }
}

/**
 * Test DFW authoritative HTTP server connectivity
 * @param {string} [testFilePath] - Optional specific file path to test (HEAD request)
 * @returns {Promise<ConnectionTestResult>}
 */
export async function testDFWConnection(testFilePath) {
  const config = getConfig();
  const { dfw } = config.media || {};
  const startTime = Date.now();

  // Check if configured
  if (!dfw?.baseUrl) {
    return {
      service: 'dfw',
      success: false,
      latencyMS: 0,
      message: 'Not configured - missing baseUrl',
      details: { hasBaseUrl: false }
    };
  }

  try {
    // Use provided test file path, or config test path, or just test the base URL
    const testPath = testFilePath || dfw.testFilePath;
    const testUrl = testPath ? `${dfw.baseUrl}/${testPath}` : dfw.baseUrl;

    // Use HEAD request to avoid downloading content
    const response = await request(testUrl, {
      method: testPath ? 'HEAD' : 'GET',
      headersTimeout: 10000,
      bodyTimeout: 10000
    });

    // Consume body to avoid memory leak (even for HEAD, undici requires this)
    await response.body.dump();

    const isSuccess = response.statusCode >= 200 && response.statusCode < 400;

    return {
      service: 'dfw',
      success: isSuccess,
      latencyMS: Date.now() - startTime,
      message: isSuccess 
        ? `Connected successfully (HTTP ${response.statusCode})`
        : `Server responded with HTTP ${response.statusCode}`,
      details: {
        baseUrl: dfw.baseUrl,
        testUrl,
        statusCode: response.statusCode,
        contentType: response.headers['content-type']
      }
    };
  } catch (error) {
    return {
      service: 'dfw',
      success: false,
      latencyMS: Date.now() - startTime,
      message: `Connection failed: ${error.message}`,
      details: {
        baseUrl: dfw.baseUrl,
        errorCode: error.code,
        errorName: error.name
      }
    };
  }
}

/**
 * Test AssemblyAI API connectivity
 * @returns {Promise<ConnectionTestResult>}
 */
export async function testAssemblyAIConnection() {
  const config = getConfig();
  const { assemblyai } = config.transcription || {};
  const startTime = Date.now();

  // Check if configured
  if (!assemblyai?.apiKey) {
    return {
      service: 'assemblyai',
      success: false,
      latencyMS: 0,
      message: 'Not configured - missing API key',
      details: { hasApiKey: false }
    };
  }

  try {
    const baseUrl = assemblyai.baseUrl || 'https://api.assemblyai.com/v2';
    
    // Test by getting account info (lightweight endpoint)
    const response = await request(`${baseUrl}/account`, {
      method: 'GET',
      headers: {
        'authorization': assemblyai.apiKey
      },
      headersTimeout: 10000,
      bodyTimeout: 10000
    });

    const bodyText = await response.body.text();
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = { raw: bodyText };
    }

    if (response.statusCode === 200) {
      return {
        service: 'assemblyai',
        success: true,
        latencyMS: Date.now() - startTime,
        message: 'Connected successfully',
        details: {
          baseUrl,
          // Include safe account info (not sensitive data)
          accountId: body.account_id,
          currentBalance: body.current_balance !== undefined ? `$${(body.current_balance / 100).toFixed(2)}` : 'N/A'
        }
      };
    }

    return {
      service: 'assemblyai',
      success: false,
      latencyMS: Date.now() - startTime,
      message: `API returned HTTP ${response.statusCode}: ${body.error || 'Unknown error'}`,
      details: {
        baseUrl,
        statusCode: response.statusCode,
        error: body.error
      }
    };
  } catch (error) {
    return {
      service: 'assemblyai',
      success: false,
      latencyMS: Date.now() - startTime,
      message: `Connection failed: ${error.message}`,
      details: {
        errorCode: error.code,
        errorName: error.name
      }
    };
  }
}

/**
 * Test DeepGram API connectivity
 * @returns {Promise<ConnectionTestResult>}
 */
export async function testDeepGramConnection() {
  const config = getConfig();
  const { deepgram } = config.transcription || {};
  const startTime = Date.now();

  // Check if configured
  if (!deepgram?.apiKey) {
    return {
      service: 'deepgram',
      success: false,
      latencyMS: 0,
      message: 'Not configured - missing API key',
      details: { hasApiKey: false }
    };
  }

  try {
    const baseUrl = deepgram.baseUrl || 'https://api.deepgram.com/v1';
    
    // Test by getting project info (lightweight endpoint)
    // DeepGram uses /projects to list available projects
    const response = await request(`${baseUrl}/projects`, {
      method: 'GET',
      headers: {
        'authorization': `Token ${deepgram.apiKey}`
      },
      headersTimeout: 10000,
      bodyTimeout: 10000
    });

    const bodyText = await response.body.text();
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = { raw: bodyText };
    }

    if (response.statusCode === 200) {
      const projectCount = body.projects?.length || 0;
      return {
        service: 'deepgram',
        success: true,
        latencyMS: Date.now() - startTime,
        message: `Connected successfully. Found ${projectCount} project(s)`,
        details: {
          baseUrl,
          projectCount,
          projects: body.projects?.map(p => ({ id: p.project_id, name: p.name })) || []
        }
      };
    }

    return {
      service: 'deepgram',
      success: false,
      latencyMS: Date.now() - startTime,
      message: `API returned HTTP ${response.statusCode}: ${body.err_msg || body.error || 'Unknown error'}`,
      details: {
        baseUrl,
        statusCode: response.statusCode,
        error: body.err_msg || body.error
      }
    };
  } catch (error) {
    return {
      service: 'deepgram',
      success: false,
      latencyMS: Date.now() - startTime,
      message: `Connection failed: ${error.message}`,
      details: {
        errorCode: error.code,
        errorName: error.name
      }
    };
  }
}

/**
 * Test CoreAPI connectivity
 * @returns {Promise<ConnectionTestResult>}
 */
export async function testCoreAPIConnection() {
  const config = getConfig();
  const { coreAPI } = config;
  const startTime = Date.now();

  // Check if configured
  if (!coreAPI?.baseUrl) {
    return {
      service: 'coreapi',
      success: false,
      latencyMS: 0,
      message: 'Not configured - missing baseUrl',
      details: { hasBaseUrl: false }
    };
  }

  try {
    // Test by hitting a health or root endpoint
    // Adjust the path based on actual CoreAPI health endpoint
    const healthUrl = coreAPI.baseUrl.replace(/\/v1\/?$/, '/health');
    
    const headers = {
      'Content-Type': 'application/json'
    };
    
    if (coreAPI.apiKey) {
      headers['Authorization'] = `Bearer ${coreAPI.apiKey}`;
    }
    if (coreAPI.authHint) {
      headers['x-cds-auth-hint'] = coreAPI.authHint;
    }

    const response = await request(healthUrl, {
      method: 'GET',
      headers,
      headersTimeout: 10000,
      bodyTimeout: 10000
    });

    const bodyText = await response.body.text();
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = { raw: bodyText };
    }

    if (response.statusCode === 200) {
      return {
        service: 'coreapi',
        success: true,
        latencyMS: Date.now() - startTime,
        message: 'Connected successfully',
        details: {
          baseUrl: coreAPI.baseUrl,
          status: body.status,
          version: body.version
        }
      };
    }

    return {
      service: 'coreapi',
      success: false,
      latencyMS: Date.now() - startTime,
      message: `API returned HTTP ${response.statusCode}`,
      details: {
        baseUrl: coreAPI.baseUrl,
        statusCode: response.statusCode
      }
    };
  } catch (error) {
    return {
      service: 'coreapi',
      success: false,
      latencyMS: Date.now() - startTime,
      message: `Connection failed: ${error.message}`,
      details: {
        baseUrl: coreAPI.baseUrl,
        errorCode: error.code,
        errorName: error.name
      }
    };
  }
}

/**
 * Test all configured services
 * @param {object} [options] - Test options
 * @param {string} [options.dfwTestFile] - Specific file path to test on DFW
 * @returns {Promise<{summary: object, results: ConnectionTestResult[]}>}
 */
export async function testAllConnections(options = {}) {
  const results = await Promise.all([
    testCoreAPIConnection(),
    testBackblazeConnection(),
    testDFWConnection(options.dfwTestFile),
    testAssemblyAIConnection(),
    testDeepGramConnection()
  ]);

  const summary = {
    totalServices: results.length,
    successful: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    notConfigured: results.filter(r => r.message.includes('Not configured')).length,
    timestamp: new Date().toISOString()
  };

  return { summary, results };
}

export default {
  testBackblazeConnection,
  testDFWConnection,
  testAssemblyAIConnection,
  testDeepGramConnection,
  testCoreAPIConnection,
  testAllConnections
};
