import fs from 'node:fs/promises';
import path from 'node:path';

let appConfig = null;

export async function initializeConfig() {
  if (appConfig) {
    return appConfig;
  }

  const cdsProjectName = process.env.CDS_PROJECT_NAME || 'cds-extraction-engine';
  if (!process.env.CDS_RELEASEMODE) {
    process.env.CDS_RELEASEMODE = 'development';
  }
  const cdsReleaseMode = process.env.CDS_RELEASEMODE;
  const cdsAppRoot = process.env.CDS_APPROOT || '..';
  const configFileName = `${cdsProjectName}.${cdsReleaseMode}.appConfig.json`;
  const configPath = process.env.CDS_CONFIG_PATH || path.resolve(cdsAppRoot, configFileName);

  let parsedConfig;
  try {
    const configText = await fs.readFile(configPath, 'utf8');
    // console.log(configText);
    // process.exit(1);
    parsedConfig = JSON.parse(configText);
  } catch (error) {
    throw new Error(`Failed to load config file at ${configPath}: ${error.message}`);
  }

  injectConfigSectionsToProcessEnv(parsedConfig);
  appConfig = parseStrictConfig(parsedConfig, configPath);
  return appConfig;
}

export function getConfig() {
  if (!appConfig) {
    throw new Error('Configuration not initialized. Call initializeConfig() first.');
  }
  return appConfig;
}

function parseStrictConfig(raw, configPath) {
  const server = requireObject(raw, 'server', configPath);
  const coreAPI = requireObject(raw, 'coreAPI', configPath);
  const assemblyAI = requireObject(raw, 'assemblyAI', configPath);
  const deepgram = requireObject(raw, 'deepgram', configPath);
  const revai = raw?.revai;
  const media = requireObject(raw, 'media', configPath);
  const logger = requireObject(raw, 'logger', configPath);
  const customerAPI = requireObject(raw, 'customerAPI', configPath);
  const concurrency = raw?.concurrency;
  const anthropic = optionalObject(raw, 'anthropic');
  const openai = optionalObject(raw, 'openai');
  const hintExtraction = optionalObject(media, 'HINT_EXTRACTION');

  return {
    server: {
      host: requireString(server, 'SERVER_HOST', configPath),
      port: requireNumber(server, 'SERVER_PORT', configPath)
    },
    coreAPI: {
      baseUrl: buildCoreAPIBaseUrl(coreAPI, configPath),
      apiKey: requireString(coreAPI, 'API_TOKEN', configPath),
      authHint: requireString(coreAPI, 'AUTH_HINT', configPath)
    },
    transcription: {
      assemblyai: {
        apiKey: requireString(assemblyAI, 'SECRET', configPath),
        baseUrl: requireString(assemblyAI, 'BASE_URL', configPath)
      },
      deepgram: {
        apiKey: requireString(deepgram, 'SECRET', configPath),
        baseUrl: requireString(deepgram, 'BASE_URL', configPath)
      },
      revai: {
        apiKey: isObject(revai) ? optionalString(revai, 'SECRET') : '',
        baseUrl: (isObject(revai) ? optionalString(revai, 'BASE_URL') : '') || 'https://api.rev.ai/speechtotext/v1'
      }
    },
    media: {
      localBasePath: requireString(media, 'LOCAL_BASE_PATH', configPath),
      tempBasePath: requireString(media, 'TEMP_BASE_PATH', configPath),
      localAACCacheSecs: requireNumber(media, 'LOCAL_AAC_CACHE_SECS', configPath),
      offsite: parseOffsite(raw, configPath),
      dfw: {
        baseUrl: requireString(media, 'DFW_BASE_URL', configPath),
        testFilePath: optionalString(media, 'DFW_TEST_FILE_PATH')
      },
      silenceDetection: {
        noiseDB: requireNumber(media, 'SILENCE_NOISE_DB', configPath),
        minSilenceSecs: requireNumber(media, 'SILENCE_MIN_SECS', configPath),
        minSilenceSecsToSave: optionalNumber(media, 'SILENCE_MIN_SECS_TO_SAVE') ?? requireNumber(media, 'SILENCE_MIN_SECS', configPath),
        isChunkingEnabled: requireBoolean(media, 'SILENCE_IS_CHUNKING_ENABLED', configPath),
        maxSegmentCount: requireNumber(media, 'SILENCE_MAX_SEGMENT_COUNT', configPath),
        maxSegmentDurationSecs: optionalNumber(media, 'MAX_SEGMENT_DURATION_SECS'),
        segmentOverlapSecs: optionalNumber(media, 'SEGMENT_OVERLAP_SECS')
      }
    },
    logger: {
      level: requireString(logger, 'LEVEL', configPath)
    },
    customerAPI: {
      HOSTNAME: requireString(customerAPI, 'HOSTNAME', configPath),
      PORT: requireNumberLike(customerAPI, 'PORT', configPath),
      API_TOKEN: requireString(customerAPI, 'API_TOKEN', configPath),
      IS_FORCE_SSL: optionalBoolean(customerAPI, 'IS_FORCE_SSL'),
      TIMEOUT_CONNECT_MS: optionalNumber(customerAPI, 'TIMEOUT_CONNECT_MS')
    },
    concurrency: parseConcurrency(concurrency, configPath),
    anthropic: {
      apiKey: optionalString(anthropic, 'API_KEY')
    },
    openai: {
      apiKey: optionalString(openai, 'API_KEY')
    },
    hintExtraction: {
      provider: optionalString(hintExtraction, 'PROVIDER').toLowerCase(),
      timeoutMS: optionalNumber(hintExtraction, 'TIMEOUT_MS')
    }
  };
}

function parseConcurrency(concurrency, configPath) {
  if (concurrency === undefined) {
    return {
      providerDefaultMaxConcurrency: undefined,
      providerMaxConcurrency: {}
    };
  }
  if (!isObject(concurrency)) {
    throw new Error(`Invalid config ${configPath}: concurrency must be an object when provided`);
  }

  const providerDefaultMaxConcurrency = optionalPositiveInteger(concurrency, 'PROVIDER_DEFAULT_MAX_CONCURRENCY', configPath);
  const providerMaxConcurrencyRaw = concurrency.PROVIDER_MAX_CONCURRENCY;
  const providerMaxConcurrency = {};

  if (providerMaxConcurrencyRaw !== undefined) {
    if (!isObject(providerMaxConcurrencyRaw)) {
      throw new Error(`Invalid config ${configPath}: PROVIDER_MAX_CONCURRENCY must be an object when provided`);
    }
    Object.entries(providerMaxConcurrencyRaw).forEach(([providerName, rawValue]) => {
      const normalizedProviderName = String(providerName || '').trim().toUpperCase();
      if (!normalizedProviderName) {
        throw new Error(`Invalid config ${configPath}: PROVIDER_MAX_CONCURRENCY contains an empty provider name`);
      }
      providerMaxConcurrency[normalizedProviderName] = parsePositiveInteger(rawValue, `PROVIDER_MAX_CONCURRENCY.${normalizedProviderName}`, configPath);
    });
  }

  return {
    providerDefaultMaxConcurrency,
    providerMaxConcurrency
  };
}

function parseOffsite(raw, configPath) {
  const offsite = requireObject(raw, 'uploadMediaS3Storage', configPath);
  return {
    endpoint: requireString(offsite, 'UPLOAD_MEDIA_S3_ENDPOINT', configPath),
    bucket: requireString(offsite, 'UPLOAD_MEDIA_S3_BUCKET', configPath),
    accessKeyId: requireString(offsite, 'UPLOAD_MEDIA_S3_ACCESS_KEY_ID', configPath),
    secretAccessKey: requireString(offsite, 'UPLOAD_MEDIA_S3_SECRET_ACCESS_KEY', configPath),
    region: requireString(offsite, 'UPLOAD_MEDIA_S3_REGION', configPath)
  };
}

function injectConfigSectionsToProcessEnv(rawConfig) {
  injectSectionToProcessEnv(rawConfig, 'logger');
  injectSectionToProcessEnv(rawConfig, 'environment');
  injectSectionToProcessEnv(rawConfig, 'cdsJobQueue');
  injectSectionToProcessEnv(rawConfig, 'uploadMediaS3Storage');
}

function injectSectionToProcessEnv(rawConfig, sectionKey) {
  const section = rawConfig?.[sectionKey];
  if (!section || typeof section !== 'object' || Array.isArray(section)) {
    return;
  }

  Object.entries(section).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }
    process.env[key] = String(value);
  });
}

function buildCoreAPIBaseUrl(coreAPI, configPath) {
  const host = requireString(coreAPI, 'SERVER_HOST', configPath);
  const serverPort = requireNumber(coreAPI, 'SERVER_PORT', configPath);
  const urlPrefix = requireString(coreAPI, 'URL_PREFIX', configPath);
  return `http://${host}:${serverPort}${urlPrefix}`;
}

function requireObject(source, key, configPath) {
  const value = source?.[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid config ${configPath}: required object ${key} is missing or invalid`);
  }
  return value;
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function optionalObject(source, key) {
  const value = source?.[key];
  if (!isObject(value)) {
    return undefined;
  }
  return value;
}

function requireString(source, key, configPath, options = {}) {
  const allowEmpty = options.allowEmpty === true;
  const value = source?.[key];
  if (typeof value !== 'string') {
    throw new Error(`Invalid config ${configPath}: required string ${key} is missing or invalid`);
  }
  if (!allowEmpty && value.length === 0) {
    throw new Error(`Invalid config ${configPath}: required string ${key} is missing or invalid`);
  }
  return value;
}

function requireNumber(source, key, configPath) {
  const value = source?.[key];
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`Invalid config ${configPath}: required number ${key} is missing or invalid`);
  }
  return value;
}

function requireNumberLike(source, key, configPath) {
  const value = source?.[key];
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsedValue = Number(value);
    if (!Number.isNaN(parsedValue)) {
      return parsedValue;
    }
  }
  throw new Error(`Invalid config ${configPath}: required number ${key} is missing or invalid`);
}

function requireBoolean(source, key, configPath) {
  const value = source?.[key];
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid config ${configPath}: required boolean ${key} is missing or invalid`);
  }
  return value;
}

function optionalString(source, key) {
  const value = source?.[key];
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value !== 'string') {
    return '';
  }
  return value;
}

function optionalNumber(source, key) {
  const value = source?.[key];
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value;
  }
  return undefined;
}

function optionalPositiveInteger(source, key, configPath) {
  const value = source?.[key];
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return parsePositiveInteger(value, key, configPath);
}

function parsePositiveInteger(value, key, configPath) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid config ${configPath}: ${key} must be a positive integer`);
  }
  return value;
}

function optionalBoolean(source, key) {
  const value = source?.[key];
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }
  return undefined;
}

export default { initializeConfig, getConfig };
