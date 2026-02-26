import { expect } from 'chai';
import {
  ProviderConcurrencyWaitCancelledError,
  buildProviderConcurrencyLimits,
  createProviderConcurrencyGate,
  resolveProviderKeyForJob
} from '../src/queue/providerConcurrency.js';

describe('provider concurrency helpers', () => {
  it('resolves provider key from job scope and payload', () => {
    expect(resolveProviderKeyForJob({
      scope: 'extraction:transcribe:media',
      payload: {}
    })).to.equal('ASSEMBLYAI');

    expect(resolveProviderKeyForJob({
      scope: 'extraction:transcribe:media',
      payload: { provider: 'deepgram' }
    })).to.equal('DEEPGRAM');

    expect(resolveProviderKeyForJob({
      scope: 'transcription-poll',
      payload: { provider: 'revai' }
    })).to.equal('REVAI');
  });

  it('builds concurrency limits from app config shape', () => {
    const limits = buildProviderConcurrencyLimits({
      concurrency: {
        providerDefaultMaxConcurrency: 2,
        providerMaxConcurrency: {
          DEEPGRAM: 1
        }
      }
    });

    expect(limits.providerDefaultMaxConcurrency).to.equal(2);
    expect(limits.providerMaxConcurrency).to.deep.equal({ DEEPGRAM: 1 });
  });

  it('waits for provider slot when provider is at max concurrency', async () => {
    const gate = createProviderConcurrencyGate({
      providerDefaultMaxConcurrency: undefined,
      providerMaxConcurrency: {
        DEEPGRAM: 1
      }
    }, {
      waitIntervalMS: 5
    });

    const firstToken = await gate.acquire({ providerKey: 'DEEPGRAM' });
    expect(firstToken.acquired).to.equal(true);

    let isSecondResolved = false;
    const secondAcquirePromise = gate.acquire({ providerKey: 'DEEPGRAM' }).then((token) => {
      isSecondResolved = true;
      return token;
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(isSecondResolved).to.equal(false);

    gate.release(firstToken);
    const secondToken = await secondAcquirePromise;
    expect(secondToken.acquired).to.equal(true);
    expect(secondToken.waitedMS).to.be.greaterThan(0);
  });

  it('aborts while waiting when cancellation is requested', async () => {
    const gate = createProviderConcurrencyGate({
      providerDefaultMaxConcurrency: undefined,
      providerMaxConcurrency: {
        ASSEMBLYAI: 1
      }
    }, {
      waitIntervalMS: 5
    });

    const firstToken = await gate.acquire({ providerKey: 'ASSEMBLYAI' });
    let shouldAbort = false;
    const secondAcquirePromise = gate.acquire({
      providerKey: 'ASSEMBLYAI',
      shouldAbort: () => shouldAbort
    });

    await new Promise((resolve) => setTimeout(resolve, 15));
    shouldAbort = true;

    try {
      await secondAcquirePromise;
      throw new Error('Expected acquire to throw cancellation error');
    } catch (error) {
      expect(error instanceof ProviderConcurrencyWaitCancelledError).to.equal(true);
    } finally {
      gate.release(firstToken);
    }
  });
});
