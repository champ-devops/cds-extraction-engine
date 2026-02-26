import { expect } from 'chai';
import {
  buildMediaPathFromV1Media,
  getCoreCustomerByV1CustomerID,
  getFullEventByV1EventID,
  getMediaByLocationName,
  getMediaByV1MediaID,
  lookupV2CustomerIDByV1CustomerID,
  lookupLegacyCustomerIDByV2CustomerID,
  resolveLegacyMediaContext
} from '../src/services/customerApiData.js';

describe('CustomerAPI data service', () => {
  it('builds media path from v1 media response', () => {
    const mediaPath = buildMediaPathFromV1Media({
      mediaFileLocation: '2016-12',
      mediaFileName: 'abc.mp4'
    });
    expect(mediaPath).to.equal('2016-12/abc.mp4');
  });

  it('finds CoreAPI customer by legacyCustomerID', async () => {
    const customer = await getCoreCustomerByV1CustomerID(2, {
      coreApiClient: {
        listCustomersAdminAll: async () => [
          { legacyCustomerID: '2', customerID: 'Demo', accessID: 'demo' }
        ]
      }
    });

    expect(customer.customerID).to.equal('Demo');
  });

  it('maps v1 customerID to v2 customerID using CoreAPI customerID', async () => {
    const result = await lookupV2CustomerIDByV1CustomerID(2, {
      coreApiClient: {
        listCustomersAdminAll: async () => [
          { legacyCustomerID: 2, customerID: 'Demo', accessID: 'demo', customerName: 'Demo' }
        ]
      }
    });

    expect(result.v1CustomerID).to.equal(2);
    expect(result.v2CustomerID).to.equal('Demo');
    expect(result.customerAccessID).to.equal('demo');
  });

  it('maps v2 customerID to CoreAPI legacyCustomerID', async () => {
    const result = await lookupLegacyCustomerIDByV2CustomerID('WaldenTN', {
      coreApiClient: {
        listCustomersAdminAll: async () => [
          { legacyCustomerID: 69, customerID: 'WaldenTN', accessID: 'waldentn', customerName: 'Walden TN' }
        ]
      }
    });

    expect(result.legacyCustomerID).to.equal(69);
    expect(result.v2CustomerID).to.equal('WaldenTN');
  });

  it('requests legacy media via CustomerAPI using CoreAPI legacyCustomerID', async () => {
    const media = await getMediaByV1MediaID(2, 125, {
      coreApiClient: {
        listCustomersAdminAll: async () => [
          { legacyCustomerID: 2, customerID: 'Demo', accessID: 'demo' }
        ]
      },
      customerApiClient: {
        requestGet: async (path, query) => {
          expect(path).to.equal('/media/byMediaID/125');
          expect(query.customerID).to.equal(2);
          return { mediaFileLocation: '2016-12', mediaFileName: 'abc.mp4' };
        }
      }
    });

    expect(media.mediaFileName).to.equal('abc.mp4');
  });

  it('resolves legacy media context with CoreAPI customer mapping', async () => {
    const result = await resolveLegacyMediaContext(
      { v1CustomerID: 2, cdsV1MediaID: 125 },
      {
        coreApiClient: {
          listCustomersAdminAll: async () => [
            { legacyCustomerID: 2, customerID: 'Demo', accessID: 'demo', customerName: 'Demo' }
          ]
        },
        customerApiClient: {
          requestGet: async (path, query) => {
            if (path === '/media/byMediaID/125') {
              expect(query.customerID).to.equal(2);
              return {
                mediaFileLocation: '2016-12',
                mediaFileName: 'abc.mp4'
              };
            }
            return null;
          }
        }
      }
    );

    expect(result.v2CustomerID).to.equal('Demo');
    expect(result.mediaPath).to.equal('2016-12/abc.mp4');
  });

  it('looks up media by location/name using legacyCustomerID', async () => {
    const result = await getMediaByLocationName('WaldenTN', '2026-02/57df900e7a4faf101af2ab280ca9964146e856f6.mp4', {
      coreApiClient: {
        listCustomersAdminAll: async () => [
          { legacyCustomerID: 69, customerID: 'WaldenTN', accessID: 'waldentn', customerName: 'Walden TN' }
        ]
      },
      customerApiClient: {
        requestGet: async (path, query) => {
          expect(path).to.equal('/media/byLocationName/2026-02/57df900e7a4faf101af2ab280ca9964146e856f6.mp4');
          expect(query.customerID).to.equal(69);
          return {
            customerMediaID: 497,
            mediaFileLocation: '2026-02',
            mediaFileName: '57df900e7a4faf101af2ab280ca9964146e856f6.mp4'
          };
        }
      }
    });

    expect(result.media.customerMediaID).to.equal(497);
    expect(result.mediaPath).to.equal('2026-02/57df900e7a4faf101af2ab280ca9964146e856f6.mp4');
  });

  it('requests full event by v1 event ID', async () => {
    const event = await getFullEventByV1EventID(69, 1175, {
      customerApiClient: {
        requestGet: async (path, query) => {
          expect(path).to.equal('/event/fullEventByEventID/1175');
          expect(query.customerID).to.equal(69);
          return { customerEventID: 1175, media: [] };
        }
      }
    });

    expect(event.customerEventID).to.equal(1175);
  });

  it('throws for invalid full event lookup input', async () => {
    let error = null;
    try {
      await getFullEventByV1EventID(0, 1175, {
        customerApiClient: { requestGet: async () => ({}) }
      });
    } catch (err) {
      error = err;
    }
    expect(error).to.be.instanceOf(Error);
    expect(error.message).to.match(/v1CustomerID must be a positive integer/i);
  });

  it('wraps customer api failure for full event lookup', async () => {
    let error = null;
    try {
      await getFullEventByV1EventID(69, 1175, {
        customerApiClient: {
          requestGet: async () => {
            throw new Error('boom');
          }
        }
      });
    } catch (err) {
      error = err;
    }

    expect(error).to.be.instanceOf(Error);
    expect(error.message).to.match(/Failed to fetch full event by eventID 1175/i);
  });
});
