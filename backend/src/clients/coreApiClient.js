/**
 * CoreAPI Client
 * 
 * Client wrapper for interacting with the CDS CoreAPI endpoints.
 * Uses undici for HTTP requests with proper error handling.
 */

import { request } from 'undici';
import { getConfig } from '../config/appConfig.js';

/**
 * @typedef {object} RequestOptions
 * @property {string} [customerID] - Customer ID (required for most endpoints)
 * @property {object} [body] - Request body for POST/PUT
 * @property {object} [query] - Query parameters
 * @property {object} [headers] - Additional headers
 */

/**
 * CoreAPI Client class
 */
export class CoreApiClient {
  /**
   * Create a new CoreAPI client instance
   * @param {object} [options] - Optional configuration override
   * @param {string} [options.baseUrl] - Base URL for CoreAPI
   * @param {string} [options.apiKey] - API key for authentication
   */
  constructor(options = {}) {
    const config = getConfig();
    this.baseUrl = options.baseUrl || config.coreAPI?.baseUrl || 'http://localhost:7001/v1';
    this.apiKey = options.apiKey || config.coreAPI?.apiKey || '';
    this.authHint = options.authHint || config.coreAPI?.authHint || '';
  }

  /**
   * Make an HTTP request to CoreAPI
   * @param {string} method - HTTP method
   * @param {string} path - API path (relative to baseUrl)
   * @param {RequestOptions} [options={}] - Request options
   * @returns {Promise<object>} Response body parsed as JSON
   * @throws {Error} If request fails
   */
  async request(method, path, options = {}) {
    const normalizedBaseURL = String(this.baseUrl).endsWith('/') ? String(this.baseUrl) : `${this.baseUrl}/`;
    const normalizedPath = String(path || '').replace(/^\/+/, '');
    const url = new URL(normalizedPath, normalizedBaseURL);

    // Add query parameters
    if (options.query) {
      Object.entries(options.query).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    // Add customerID to query if provided
    if (options.customerID) {
      url.searchParams.set('customerID', options.customerID);
    }

    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    // Add authorization if API key is configured
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    if (this.authHint) {
      headers['x-cds-auth-hint'] = this.authHint;
    }

    const requestOptions = {
      method,
      headers
    };

    if (options.body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestOptions.body = JSON.stringify(options.body);
    }

    const response = await request(url.toString(), requestOptions);

    // Read response body
    const bodyText = await response.body.text();
    let body;
    try {
      body = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      body = bodyText;
    }

    // Check for errors
    if (response.statusCode >= 400) {
      const error = new Error(`CoreAPI request failed: ${response.statusCode}`);
      error.statusCode = response.statusCode;
      error.body = body;
      error.path = path;
      error.method = method;
      error.url = url.toString();
      throw error;
    }

    return body;
  }

  // ==================== Transcript Endpoints ====================

  /**
   * List all transcripts for a customer
   * @param {string} customerID - Customer ID
   * @param {object} [query] - Query parameters (limit, offset, etc.)
   * @returns {Promise<object[]>} Array of transcripts
   */
  async listTranscripts(customerID, query = {}) {
    const extractionQuery = mapTranscriptQueryToExtractionQuery(query);
    const response = await this.request('GET', '/extractions/', { customerID, query: extractionQuery });
    return mapExtractionListResponseToTranscriptListResponse(response);
  }

  /**
   * List active (non-deleted) transcripts for a customer
   * @param {string} customerID - Customer ID
   * @param {object} [query] - Query parameters
   * @returns {Promise<object[]>} Array of active transcripts
   */
  async listActiveTranscripts(customerID, query = {}) {
    const extractionQuery = mapTranscriptQueryToExtractionQuery(query);
    const response = await this.request('GET', '/extractions/active', { customerID, query: extractionQuery });
    return mapExtractionListResponseToTranscriptListResponse(response);
  }

  /**
   * Get a transcript by ID
   * @param {string} customerID - Customer ID
   * @param {string} transcriptID - Transcript ID
   * @returns {Promise<object>} Transcript document
   */
  async getTranscript(customerID, transcriptID) {
    const extraction = await this.request('GET', `/extractions/${transcriptID}`, { customerID });
    return mapExtractionToTranscript(extraction);
  }

  /**
   * Get newest active STT transcript by v1 target coordinates.
   * @param {string} customerID - Customer ID
   * @param {{v1TargetClassName:string,v1TargetID:number|string,providerName?:string}} query - Target query
   * @returns {Promise<object|null>} Transcript document or null when not found
   */
  async getNewestTranscriptByV1Target(customerID, query = {}) {
    try {
      const extraction = await this.request('GET', '/extractions/newestByV1Target/', { customerID, query });
      return mapExtractionToTranscript(extraction);
    } catch (error) {
      if (Number(error?.statusCode) === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Create a new transcript
   * @param {string} customerID - Customer ID
   * @param {object} data - Transcript data
   * @param {string} data.mediaID - Associated media ID
   * @param {string} [data.externalMediaID] - External media ID
   * @param {string} [data.providerName] - Transcription provider name
   * @param {string} [data.providerJobID] - Provider's job ID
   * @param {string} [data.textOriginal] - Full transcript text
   * @param {string} [data.textOriginalSource] - Source of original text
   * @param {string} [data.textModified] - Modified text
   * @returns {Promise<object>} Created transcript document
   */
  async createTranscript(customerID, data) {
    const extractionPayload = mapTranscriptCreatePayloadToExtractionPayload(data);
    const extraction = await this.request('POST', '/extractions/new', { customerID, body: extractionPayload });
    return mapExtractionToTranscript(extraction);
  }

  /**
   * Update a transcript
   * @param {string} customerID - Customer ID
   * @param {string} transcriptID - Transcript ID
   * @param {object} data - Fields to update
   * @returns {Promise<object>} Updated transcript document
   */
  async updateTranscript(customerID, transcriptID, data) {
    const extractionPayload = mapTranscriptUpdatePayloadToExtractionPayload(data);
    const extraction = await this.request('POST', `/extractions/${transcriptID}/update`, { customerID, body: extractionPayload });
    return mapExtractionToTranscript(extraction);
  }

  /**
   * Soft delete a transcript
   * @param {string} customerID - Customer ID
   * @param {string} transcriptID - Transcript ID
   * @returns {Promise<object>} Delete result
   */
  async deleteTranscript(customerID, transcriptID) {
    return this.request('POST', `/extractions/${transcriptID}/markDeleted`, { customerID });
  }

  /**
   * Restore a soft-deleted transcript
   * @param {string} customerID - Customer ID
   * @param {string} transcriptID - Transcript ID
   * @returns {Promise<object>} Restore result
   */
  async restoreTranscript(customerID, transcriptID) {
    return this.request('POST', `/extractions/${transcriptID}/markUndeleted`, { customerID });
  }

  // ==================== Utterance Endpoints ====================

  /**
   * List all utterances for a transcript
   * @param {string} customerID - Customer ID
   * @param {string} transcriptID - Transcript ID
   * @returns {Promise<object[]>} Array of utterances
   */
  async listUtterances(customerID, transcriptID) {
    const items = await this.request('GET', `/extractions/${transcriptID}/items`, { customerID });
    return mapExtractionItemsToUtterances(items);
  }

  /**
   * List active (non-deleted) utterances for a transcript
   * @param {string} customerID - Customer ID
   * @param {string} transcriptID - Transcript ID
   * @returns {Promise<object[]>} Array of active utterances
   */
  async listActiveUtterances(customerID, transcriptID) {
    const items = await this.request('GET', `/extractions/${transcriptID}/items/active`, { customerID });
    return mapExtractionItemsToUtterances(items);
  }

  /**
   * Create utterances for a transcript (batch)
   * @param {string} customerID - Customer ID
   * @param {string} transcriptID - Transcript ID
   * @param {object[]} utterances - Array of utterance data
   * @returns {Promise<object[]>} Created utterance documents
   */
  async createUtterances(customerID, transcriptID, utterances) {
    const extractionItemsPayload = Array.isArray(utterances)
      ? utterances.map((utterance) => mapUtterancePayloadToExtractionItemPayload(utterance))
      : [];
    const items = await this.request('POST', `/extractions/${transcriptID}/items/new`, {
      customerID,
      body: extractionItemsPayload
    });
    return mapExtractionItemsToUtterances(items);
  }

  /**
   * Update an utterance
   * @param {string} customerID - Customer ID
   * @param {string} transcriptID - Transcript ID
   * @param {string} utteranceID - Utterance ID
   * @param {object} data - Fields to update
   * @returns {Promise<object>} Updated utterance document
   */
  async updateUtterance(customerID, transcriptID, utteranceID, data) {
    const payload = mapUtterancePayloadToExtractionItemPayload(data);
    const item = await this.request('POST', `/extractions/${transcriptID}/items/${utteranceID}/update`, {
      customerID,
      body: payload
    });
    return mapExtractionItemToUtterance(item);
  }

  /**
   * Soft delete an utterance
   * @param {string} customerID - Customer ID
   * @param {string} transcriptID - Transcript ID
   * @param {string} utteranceID - Utterance ID
   * @returns {Promise<object>} Delete result
   */
  async deleteUtterance(customerID, transcriptID, utteranceID) {
    return this.request('POST', `/extractions/${transcriptID}/items/${utteranceID}/markDeleted`, {
      customerID
    });
  }

  /**
   * Restore a soft-deleted utterance
   * @param {string} customerID - Customer ID
   * @param {string} transcriptID - Transcript ID
   * @param {string} utteranceID - Utterance ID
   * @returns {Promise<object>} Restore result
   */
  async restoreUtterance(customerID, transcriptID, utteranceID) {
    return this.request('POST', `/extractions/${transcriptID}/items/${utteranceID}/markUndeleted`, {
      customerID
    });
  }

  // ==================== Extraction Endpoints ====================

  /**
   * List all extractions for a customer
   * @param {string} customerID - Customer ID
   * @param {object} [query] - Query parameters
   * @returns {Promise<object[]|object>} Array/paged extraction response
   */
  async listExtractions(customerID, query = {}) {
    return this.request('GET', '/extractions/', { customerID, query });
  }

  /**
   * List active (non-deleted) extractions for a customer
   * @param {string} customerID - Customer ID
   * @param {object} [query] - Query parameters
   * @returns {Promise<object[]|object>} Array/paged extraction response
   */
  async listActiveExtractions(customerID, query = {}) {
    return this.request('GET', '/extractions/active', { customerID, query });
  }

  /**
   * Get extraction by ID
   * @param {string} customerID - Customer ID
   * @param {string} extractionID - Extraction ID
   * @returns {Promise<object>} Extraction document
   */
  async getExtraction(customerID, extractionID) {
    return this.request('GET', `/extractions/${extractionID}`, { customerID });
  }

  /**
   * Create extraction
   * @param {string} customerID - Customer ID
   * @param {object} data - Extraction payload
   * @returns {Promise<object>} Created extraction
   */
  async createExtraction(customerID, data) {
    return this.request('POST', '/extractions/new', { customerID, body: data });
  }

  /**
   * Update extraction
   * @param {string} customerID - Customer ID
   * @param {string} extractionID - Extraction ID
   * @param {object} data - Update payload
   * @returns {Promise<object>} Updated extraction
   */
  async updateExtraction(customerID, extractionID, data) {
    return this.request('POST', `/extractions/${extractionID}/update`, { customerID, body: data });
  }

  /**
   * Hard delete extraction and items
   * @param {string} customerID - Customer ID
   * @param {string} extractionID - Extraction ID
   * @returns {Promise<object>} Deletion result
   */
  async hardDeleteExtractionAndItems(customerID, extractionID) {
    return this.request('POST', `/extractions/${extractionID}/hardDeleteExtractionAndItems`, { customerID });
  }

  /**
   * List all extraction items
   * @param {string} customerID - Customer ID
   * @param {string} extractionID - Extraction ID
   * @returns {Promise<object[]|object>} Array/paged extraction-item response
   */
  async listExtractionItems(customerID, extractionID) {
    return this.request('GET', `/extractions/${extractionID}/items`, { customerID });
  }

  /**
   * List active extraction items
   * @param {string} customerID - Customer ID
   * @param {string} extractionID - Extraction ID
   * @returns {Promise<object[]|object>} Array/paged extraction-item response
   */
  async listActiveExtractionItems(customerID, extractionID) {
    return this.request('GET', `/extractions/${extractionID}/items/active`, { customerID });
  }

  /**
   * Create extraction items (batch)
   * @param {string} customerID - Customer ID
   * @param {string} extractionID - Extraction ID
   * @param {object[]} items - Extraction items payload
   * @returns {Promise<object[]|object>} Created extraction items response
   */
  async createExtractionItems(customerID, extractionID, items) {
    return this.request('POST', `/extractions/${extractionID}/items/new`, {
      customerID,
      body: items
    });
  }

  // ==================== Media Endpoints ====================

  /**
   * Get a media entry by ID
   * @param {string} customerID - Customer ID
   * @param {string} mediaID - Media ID
   * @returns {Promise<object>} Media document
   */
  async getMedia(customerID, mediaID) {
    return this.request('GET', `/media/${mediaID}`, { customerID });
  }

  /**
   * List media by external ID (via query filter)
   * @param {string} customerID - Customer ID
   * @param {string} externalID - External media ID
   * @returns {Promise<object[]>} Array of matching media
   */
  async findMediaByExternalID(customerID, externalID) {
    // Note: This assumes the API supports filtering by externalID in query params
    // May need to adjust based on actual CoreAPI implementation
    return this.request('GET', '/media/', {
      customerID,
      query: { externalID }
    });
  }

  // ==================== Job Queue Endpoints ====================

  /**
   * Submit a job to the queue
   * @param {string} customerID - Customer ID
   * @param {object} job - Job data
   * @param {string} job.scope - Job scope/type
   * @param {object} job.payload - Job payload
   * @param {number} job.timeoutSeconds - Job timeout
   * @param {string} [job.fingerprint] - Optional idempotency key
   * @returns {Promise<object>} Submitted job info with jobID
   */
  async submitJob(customerID, job) {
    return this.request('POST', '/jobQueue/', { customerID, body: job });
  }

  /**
   * Get job status
   * @param {string} customerID - Customer ID
   * @param {string} jobID - Job ID
   * @returns {Promise<object>} Job status and details
   */
  async getJob(customerID, jobID) {
    return this.request('GET', '/jobQueue/', { customerID, query: { jobID } });
  }

  /**
   * Get completed job IDs from Redis queue.
   * @param {string} customerID - Customer ID
   * @returns {Promise<string[]>} Job IDs
   */
  async listCompletedJobIDs(customerID) {
    return this.request('GET', '/jobQueue/completedIDs', { customerID });
  }

  /**
   * Get archived job IDs from Redis queue.
   * @param {string} customerID - Customer ID
   * @returns {Promise<string[]>} Job IDs
   */
  async listArchivedJobIDs(customerID) {
    return this.request('GET', '/jobQueue/archivedIDs', { customerID });
  }

  /**
   * List archived jobs by status (Mongo-backed history).
   * @param {string} customerID - Customer ID
   * @param {string} status - Job status (completed, failed, etc.)
   * @param {{limit?:number,offset?:number}} [query={}] - Pagination query
   * @returns {Promise<{jobs:object[],count:number}>} Archived jobs page
   */
  async listArchivedJobsByStatus(customerID, status, query = {}) {
    return this.request('GET', `/jobQueue/archived/${encodeURIComponent(String(status || '').toLowerCase())}`, {
      customerID,
      query
    });
  }

  // ==================== Customer Endpoints ====================

  /**
   * List all customers (admin endpoint).
   * @param {{offsetCount?:number,limitCount?:number}} [query={}] - Pagination query
   * @returns {Promise<object[]>} Array of customer documents
   */
  async listCustomersAdminAll(query = {}) {
    return this.request('GET', '/customers/admin/all', { query });
  }
}

function mapTranscriptQueryToExtractionQuery(query = {}) {
  const next = { ...(query && typeof query === 'object' ? query : {}) };

  const direction = String(next.direction || '').toUpperCase();
  if (!next.extractionKind) {
    if (direction === 'STT') {
      next.extractionKind = 'TRANSCRIPT_STT';
    } else if (direction === 'TTS') {
      next.extractionKind = 'TRANSCRIPT_TTS';
    }
  }
  if (!next.offsetUnit && (next.extractionKind === 'TRANSCRIPT_STT' || next.extractionKind === 'TRANSCRIPT_TTS')) {
    next.offsetUnit = 'MS';
  }

  applyExtractionTargetFields(next, {
    mediaID: next.mediaID,
    externalMediaID: next.externalMediaID
  });

  if (next.limitCount === undefined && next.limit !== undefined) {
    next.limitCount = next.limit;
  }

  delete next.direction;
  delete next.variant;
  delete next.limit;
  delete next.externalMediaID;
  return next;
}

function mapTranscriptCreatePayloadToExtractionPayload(data = {}) {
  const source = (data && typeof data === 'object') ? data : {};
  const direction = String(source.direction || '').toUpperCase();
  const extractionKind = source.extractionKind
    || (direction === 'TTS' ? 'TRANSCRIPT_TTS' : 'TRANSCRIPT_STT');
  const offsetUnit = source.offsetUnit || 'MS';

  const payload = {
    ...source,
    extractionKind,
    offsetUnit
  };

  applyExtractionTargetFields(payload, {
    mediaID: source.mediaID,
    externalMediaID: source.externalMediaID
  });

  delete payload.direction;
  delete payload.variant;
  delete payload.fullText;
  delete payload.textOriginal;
  delete payload.externalMediaID;
  return payload;
}

function mapTranscriptUpdatePayloadToExtractionPayload(data = {}) {
  const source = (data && typeof data === 'object') ? data : {};
  const payload = {
    ...source
  };

  applyExtractionTargetFields(payload, {
    mediaID: source.mediaID,
    externalMediaID: source.externalMediaID
  });

  delete payload.direction;
  delete payload.variant;
  delete payload.fullText;
  delete payload.textOriginal;
  delete payload.textOriginalSource;
  delete payload.externalMediaID;
  return payload;
}

function mapUtterancePayloadToExtractionItemPayload(utterance = {}) {
  const source = (utterance && typeof utterance === 'object') ? utterance : {};
  const meta = {
    ...(source.meta && typeof source.meta === 'object' ? source.meta : {})
  };
  if (source.speakerOriginal !== undefined) {
    meta.speakerOriginal = source.speakerOriginal;
  }
  if (source.speakerModified !== undefined) {
    meta.speakerModified = source.speakerModified;
  }
  if (source.textOriginalSource !== undefined) {
    meta.textOriginalSource = source.textOriginalSource;
  }

  return {
    itemKind: source.itemKind || 'UTTERANCE',
    textOriginal: source.textOriginal || '',
    ...(source.startMS !== undefined ? { offsetStart: source.startMS } : {}),
    ...(source.endMS !== undefined ? { offsetEnd: source.endMS } : {}),
    ...(source.offsetStart !== undefined ? { offsetStart: source.offsetStart } : {}),
    ...(source.offsetEnd !== undefined ? { offsetEnd: source.offsetEnd } : {}),
    ...(source.segmentIndex !== undefined ? { segmentIndex: source.segmentIndex } : {}),
    ...(source.confidence !== undefined ? { confidence: source.confidence } : {}),
    ...(Object.keys(meta).length > 0 ? { meta } : {})
  };
}

function mapExtractionToTranscript(extraction = {}) {
  const source = (extraction && typeof extraction === 'object') ? extraction : {};
  const direction = source.extractionKind === 'TRANSCRIPT_TTS' ? 'TTS' : 'STT';
  const variant = 'EN';
  return {
    ...source,
    transcriptID: source._id,
    externalMediaID: buildLegacyExternalMediaIDFromExtraction(source),
    direction,
    variant,
    fullText: source.fullText || source.textOriginal || ''
  };
}

function applyExtractionTargetFields(payload, context = {}) {
  if (!payload || typeof payload !== 'object') {
    return;
  }
  const mediaID = String(context.mediaID || '').trim();
  if (mediaID && !payload.targetClassName && !payload.targetID) {
    payload.targetClassName = 'MEDIA';
    payload.targetID = mediaID;
  }
  const externalIdentity = parseExternalMediaIdentity(context.externalMediaID);
  if (externalIdentity.numericID && !payload.v1TargetClassName && payload.v1TargetID === undefined) {
    payload.v1TargetClassName = 'MEDIA';
    payload.v1TargetID = externalIdentity.numericID;
  }
}

function parseExternalMediaIdentity(value) {
  const rawValue = String(value || '').trim();
  if (!rawValue) {
    return {
      type: 'unknown',
      numericID: null
    };
  }
  if (rawValue.startsWith(EXTERNAL_MEDIA_ID_PREFIX_CUSTOMER_MEDIA_ID)) {
    const numericID = Number(rawValue.slice(EXTERNAL_MEDIA_ID_PREFIX_CUSTOMER_MEDIA_ID.length));
    return {
      type: 'customer-media-id',
      numericID: Number.isInteger(numericID) && numericID > 0 ? numericID : null
    };
  }
  if (rawValue.startsWith(EXTERNAL_MEDIA_ID_PREFIX_MEDIA_ID)) {
    const numericID = Number(rawValue.slice(EXTERNAL_MEDIA_ID_PREFIX_MEDIA_ID.length));
    return {
      type: 'media-id',
      numericID: Number.isInteger(numericID) && numericID > 0 ? numericID : null
    };
  }
  return {
    type: 'other',
    numericID: null
  };
}

function buildLegacyExternalMediaIDFromExtraction(extraction = {}) {
  if (extraction?.externalMediaID) {
    return extraction.externalMediaID;
  }
  const targetClass = String(extraction?.v1TargetClassName || '').toUpperCase();
  const targetID = Number(extraction?.v1TargetID);
  if (targetClass === 'MEDIA' && Number.isInteger(targetID) && targetID > 0) {
    return `${EXTERNAL_MEDIA_ID_PREFIX_CUSTOMER_MEDIA_ID}${targetID}`;
  }
  return undefined;
}

const EXTERNAL_MEDIA_ID_PREFIX_CUSTOMER_MEDIA_ID = 'CDSV1CustomerMediaID:';
const EXTERNAL_MEDIA_ID_PREFIX_MEDIA_ID = 'CDSV1MediaID:';

function mapExtractionItemToUtterance(item = {}) {
  const source = (item && typeof item === 'object') ? item : {};
  const meta = (source.meta && typeof source.meta === 'object') ? source.meta : {};
  return {
    ...source,
    utteranceID: source._id,
    startMS: source.offsetStart,
    endMS: source.offsetEnd,
    speakerOriginal: source.speakerOriginal || meta.speakerOriginal,
    speakerModified: source.speakerModified || meta.speakerModified,
    textOriginalSource: source.textOriginalSource || meta.textOriginalSource
  };
}

function mapExtractionItemsToUtterances(itemsOrResponse) {
  if (Array.isArray(itemsOrResponse)) {
    return itemsOrResponse.map((item) => mapExtractionItemToUtterance(item));
  }
  if (Array.isArray(itemsOrResponse?.items)) {
    return {
      ...itemsOrResponse,
      items: itemsOrResponse.items.map((item) => mapExtractionItemToUtterance(item))
    };
  }
  return itemsOrResponse;
}

function mapExtractionListResponseToTranscriptListResponse(response) {
  if (Array.isArray(response)) {
    return response.map((item) => mapExtractionToTranscript(item));
  }
  if (Array.isArray(response?.items)) {
    return {
      ...response,
      items: response.items.map((item) => mapExtractionToTranscript(item))
    };
  }
  return response;
}

// Singleton instance
let clientInstance = null;

/**
 * Get singleton CoreAPI client instance
 * @returns {CoreApiClient}
 */
export function getCoreApiClient() {
  if (!clientInstance) {
    clientInstance = new CoreApiClient();
  }
  return clientInstance;
}

export default { CoreApiClient, getCoreApiClient };
