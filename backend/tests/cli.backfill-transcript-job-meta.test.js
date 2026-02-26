import { expect } from 'chai';
import { __testables } from '../src/cli/backfill-transcript-job-meta.js';

describe('backfill transcript job meta CLI helpers', () => {
  it('fetchTranscripts applies STT identity query filters', async () => {
    const queryCalls = [];
    const client = {
      listTranscripts: async (_customerID, query) => {
        queryCalls.push(query);
        return [];
      }
    };

    const transcripts = await __testables.fetchTranscripts({
      client,
      customerID: 'C1',
      pageSize: 50,
      maxTranscripts: 100
    });

    expect(transcripts).to.deep.equal([]);
    expect(queryCalls).to.have.lengthOf(1);
    expect(queryCalls[0].direction).to.equal('STT');
    expect(queryCalls[0].variant).to.equal('EN');
  });
});
