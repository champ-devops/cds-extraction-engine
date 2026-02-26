import { JobScopes } from '../services/transcriptIngestion.js';

const DEFAULT_PROVIDER_FOR_TRANSCRIBE_MEDIA = 'ASSEMBLYAI';
const DEFAULT_WAIT_INTERVALMS = 1000;

export class ProviderConcurrencyWaitCancelledError extends Error {
  constructor(message = 'Cancelled while waiting for provider concurrency slot') {
    super(message);
    this.name = 'ProviderConcurrencyWaitCancelledError';
  }
}

export function normalizeProviderKey(provider) {
  return String(provider || '').trim().toUpperCase();
}

export function resolveProviderKeyForJob(job = {}) {
  const scope = String(job?.scope || '').trim();
  const payload = (job?.payload && typeof job.payload === 'object') ? job.payload : {};

  if (scope === JobScopes.TRANSCRIBE_MEDIA) {
    return normalizeProviderKey(payload.provider || DEFAULT_PROVIDER_FOR_TRANSCRIBE_MEDIA);
  }
  if (scope === JobScopes.TRANSCRIPTION_POLL) {
    return normalizeProviderKey(payload.provider);
  }
  return '';
}

export function buildProviderConcurrencyLimits(config = {}) {
  const raw = (config?.concurrency && typeof config.concurrency === 'object')
    ? config.concurrency
    : {};
  const rawProviderMap = (raw.providerMaxConcurrency && typeof raw.providerMaxConcurrency === 'object')
    ? raw.providerMaxConcurrency
    : {};

  const providerDefaultMaxConcurrency = sanitizeMaxConcurrency(raw.providerDefaultMaxConcurrency, 'providerDefaultMaxConcurrency');
  const providerMaxConcurrency = {};
  Object.entries(rawProviderMap).forEach(([providerName, rawValue]) => {
    const normalizedProvider = normalizeProviderKey(providerName);
    if (!normalizedProvider) {
      throw new Error('Invalid concurrency config: providerMaxConcurrency contains an empty provider key');
    }
    providerMaxConcurrency[normalizedProvider] = sanitizeMaxConcurrency(
      rawValue,
      `providerMaxConcurrency.${normalizedProvider}`
    );
  });

  return {
    providerDefaultMaxConcurrency,
    providerMaxConcurrency
  };
}

export function resolveProviderMaxConcurrency({ limits, providerKey }) {
  const normalizedProviderKey = normalizeProviderKey(providerKey);
  if (!normalizedProviderKey) {
    return Number.POSITIVE_INFINITY;
  }
  if (Number.isFinite(limits?.providerMaxConcurrency?.[normalizedProviderKey])) {
    return limits.providerMaxConcurrency[normalizedProviderKey];
  }
  if (Number.isFinite(limits?.providerDefaultMaxConcurrency)) {
    return limits.providerDefaultMaxConcurrency;
  }
  return Number.POSITIVE_INFINITY;
}

export function createProviderConcurrencyGate(limits, deps = {}) {
  const waitIntervalMS = Number(deps.waitIntervalMS) > 0 ? Number(deps.waitIntervalMS) : DEFAULT_WAIT_INTERVALMS;
  const sleepMS = typeof deps.sleepMS === 'function' ? deps.sleepMS : defaultSleepMS;
  const activeCountsByProvider = new Map();
  const waitingCountsByProvider = new Map();

  async function acquire(params = {}) {
    const providerKey = normalizeProviderKey(params.providerKey);
    const maxConcurrency = resolveProviderMaxConcurrency({ limits, providerKey });
    if (!providerKey || !Number.isFinite(maxConcurrency)) {
      return {
        acquired: false,
        providerKey,
        maxConcurrency
      };
    }

    let waitedMS = 0;
    let waitIteration = 0;
    let isWaitingCounted = false;
    for (;;) {
      const activeCount = activeCountsByProvider.get(providerKey) || 0;
      if (activeCount < maxConcurrency) {
        activeCountsByProvider.set(providerKey, activeCount + 1);
        if (isWaitingCounted) {
          decrementMapCount(waitingCountsByProvider, providerKey);
        }
        return {
          acquired: true,
          providerKey,
          maxConcurrency,
          waitedMS
        };
      }

      if (!isWaitingCounted) {
        incrementMapCount(waitingCountsByProvider, providerKey);
        isWaitingCounted = true;
      }
      if (typeof params.shouldAbort === 'function' && params.shouldAbort()) {
        decrementMapCount(waitingCountsByProvider, providerKey);
        throw new ProviderConcurrencyWaitCancelledError();
      }

      waitIteration += 1;
      if (typeof params.onWait === 'function') {
        await params.onWait({
          providerKey,
          maxConcurrency,
          activeCount,
          waitedMS,
          waitIteration
        });
      }
      await sleepMS(waitIntervalMS);
      waitedMS += waitIntervalMS;
    }
  }

  function release(token = {}) {
    if (!token.acquired || !token.providerKey) {
      return;
    }
    const providerKey = normalizeProviderKey(token.providerKey);
    const nextCount = Math.max(0, (activeCountsByProvider.get(providerKey) || 0) - 1);
    if (nextCount === 0) {
      activeCountsByProvider.delete(providerKey);
      return;
    }
    activeCountsByProvider.set(providerKey, nextCount);
  }

  function getSnapshot() {
    return {
      activeByProvider: Object.fromEntries(activeCountsByProvider.entries()),
      waitingByProvider: Object.fromEntries(waitingCountsByProvider.entries())
    };
  }

  return {
    acquire,
    release,
    getSnapshot
  };
}

function sanitizeMaxConcurrency(rawValue, label) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return undefined;
  }
  if (typeof rawValue !== 'number' || !Number.isInteger(rawValue) || rawValue < 1) {
    throw new Error(`Invalid concurrency config: ${label} must be a positive integer`);
  }
  return rawValue;
}

function incrementMapCount(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function decrementMapCount(map, key) {
  const nextCount = Math.max(0, (map.get(key) || 0) - 1);
  if (nextCount === 0) {
    map.delete(key);
    return;
  }
  map.set(key, nextCount);
}

function defaultSleepMS(durationMS) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMS);
  });
}

export default {
  ProviderConcurrencyWaitCancelledError,
  normalizeProviderKey,
  resolveProviderKeyForJob,
  buildProviderConcurrencyLimits,
  resolveProviderMaxConcurrency,
  createProviderConcurrencyGate
};
