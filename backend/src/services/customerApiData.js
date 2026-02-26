import { getCustomerApiClient } from '../clients/customerApiClient.js';
import { getCoreApiClient } from '../clients/coreApiClient.js';

export async function getCoreCustomerByV1CustomerID(v1CustomerID, deps = {}) {
  const numericV1CustomerID = parsePositiveInteger(v1CustomerID, 'v1CustomerID');
  const customerList = await listCoreCustomers(deps);
  return customerList.find((customer) => Number(customer?.legacyCustomerID) === numericV1CustomerID) || null;
}

export async function getCoreCustomerByV2CustomerID(v2CustomerID, deps = {}) {
  const normalizedV2CustomerID = String(v2CustomerID || '').trim();
  if (!normalizedV2CustomerID) {
    throw new Error('v2CustomerID is required');
  }

  const customerList = await listCoreCustomers(deps);
  return customerList.find((customer) => String(customer?.customerID || '').trim() === normalizedV2CustomerID) || null;
}

export async function lookupV2CustomerIDByV1CustomerID(v1CustomerID, deps = {}) {
  const customer = await getCoreCustomerByV1CustomerID(v1CustomerID, deps);
  if (!customer) {
    throw new Error(`Unable to find CoreAPI customer for v1 customerID ${v1CustomerID}`);
  }

  const v2CustomerID = String(customer?.customerID || '').trim();
  if (!v2CustomerID) {
    throw new Error(`CoreAPI customer ${v1CustomerID} is missing customerID`);
  }

  return {
    v1CustomerID: Number(customer.legacyCustomerID),
    legacyCustomerID: Number(customer.legacyCustomerID),
    v2CustomerID,
    customerAccessID: customer.accessID || '',
    customerNameInternal: customer.customerID || '',
    customerName: customer.customerName || '',
    customer
  };
}

export async function lookupLegacyCustomerIDByV2CustomerID(v2CustomerID, deps = {}) {
  const customer = await getCoreCustomerByV2CustomerID(v2CustomerID, deps);
  if (!customer) {
    throw new Error(`Unable to find CoreAPI customer for v2 customerID ${v2CustomerID}`);
  }

  const legacyCustomerID = Number(customer?.legacyCustomerID);
  if (!Number.isInteger(legacyCustomerID) || legacyCustomerID <= 0) {
    throw new Error(`CoreAPI customer ${v2CustomerID} is missing legacyCustomerID`);
  }

  return {
    v2CustomerID: String(customer.customerID),
    legacyCustomerID,
    customerAccessID: customer.accessID || '',
    customerNameInternal: customer.customerID || '',
    customerName: customer.customerName || '',
    customer
  };
}

export async function getMediaByV1MediaID(v1CustomerID, cdsV1MediaID, deps = {}) {
  const numericV1CustomerID = parsePositiveInteger(v1CustomerID, 'v1CustomerID');
  const numericCDSV1MediaID = parsePositiveInteger(cdsV1MediaID, 'cdsV1MediaID');
  const providedLegacyCustomerID = Number(deps.legacyCustomerID);
  const customerLookup = Number.isInteger(providedLegacyCustomerID) && providedLegacyCustomerID > 0
    ? { legacyCustomerID: providedLegacyCustomerID }
    : await lookupV2CustomerIDByV1CustomerID(numericV1CustomerID, deps);
  const client = deps.customerApiClient || getCustomerApiClient();
  const response = await client.requestGet(
    `/media/byMediaID/${numericCDSV1MediaID}`,
    { customerID: customerLookup.legacyCustomerID }
  );
  if (!response || typeof response !== 'object') {
    return null;
  }
  return response;
}

export async function getFullEventByV1EventID(v1CustomerID, cdsV1EventID, deps = {}) {
  const numericV1CustomerID = parsePositiveInteger(v1CustomerID, 'v1CustomerID');
  const numericCDSV1EventID = parsePositiveInteger(cdsV1EventID, 'cdsV1EventID');
  const client = deps.customerApiClient || getCustomerApiClient();
  try {
    const response = await client.requestGet(
      `/event/fullEventByEventID/${numericCDSV1EventID}`,
      { customerID: numericV1CustomerID }
    );
    if (!response || typeof response !== 'object') {
      return null;
    }
    return response;
  } catch (error) {
    throw new Error(
      `Failed to fetch full event by eventID ${numericCDSV1EventID} for v1 customerID ${numericV1CustomerID}: ${error.message}`
    );
  }
}

export async function resolveLegacyMediaContext(params, deps = {}) {
  const { v1CustomerID, cdsV1MediaID } = params || {};
  const numericV1CustomerID = parsePositiveInteger(v1CustomerID, 'v1CustomerID');
  const numericCDSV1MediaID = parsePositiveInteger(cdsV1MediaID, 'cdsV1MediaID');

  const customerLookup = await lookupV2CustomerIDByV1CustomerID(numericV1CustomerID, deps);
  const media = await getMediaByV1MediaID(numericV1CustomerID, numericCDSV1MediaID, {
    ...deps,
    legacyCustomerID: customerLookup.v1CustomerID
  });
  if (!media) {
    throw new Error(`Unable to find CustomerAPI media for cdsV1MediaID ${numericCDSV1MediaID} and v1 customerID ${numericV1CustomerID}`);
  }

  const mediaPath = buildMediaPathFromV1Media(media);
  if (!mediaPath) {
    throw new Error(`CustomerAPI media ${numericCDSV1MediaID} does not contain mediaFileLocation/mediaFileName`);
  }

  return {
    ...customerLookup,
    cdsV1MediaID: numericCDSV1MediaID,
    media,
    mediaPath
  };
}

export async function getMediaByLocationName(v2CustomerID, mediaPath, deps = {}) {
  const customerLookup = await lookupLegacyCustomerIDByV2CustomerID(v2CustomerID, deps);
  const { mediaFileLocation, mediaFileName } = parseLocationAndFileName(mediaPath);
  const client = deps.customerApiClient || getCustomerApiClient();
  const response = await client.requestGet(
    `/media/byLocationName/${encodeURIComponent(mediaFileLocation)}/${encodeURIComponent(mediaFileName)}`,
    { customerID: customerLookup.legacyCustomerID }
  );
  if (!response || typeof response !== 'object') {
    return null;
  }
  return {
    ...customerLookup,
    media: response,
    mediaPath: buildMediaPathFromV1Media(response)
  };
}

export function buildMediaPathFromV1Media(media) {
  if (!media || typeof media !== 'object') {
    return '';
  }
  const mediaFileLocation = String(media.mediaFileLocation || '').trim().replace(/^\/+|\/+$/g, '');
  const mediaFileName = String(media.mediaFileName || '').trim().replace(/^\/+/, '');
  if (!mediaFileLocation || !mediaFileName) {
    return '';
  }
  return `${mediaFileLocation}/${mediaFileName}`;
}

function parsePositiveInteger(value, fieldName) {
  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return parsedValue;
}

function parseLocationAndFileName(mediaPath) {
  const normalizedPath = String(mediaPath || '').trim().replace(/^\/+/, '');
  if (!normalizedPath) {
    throw new Error('mediaPath is required');
  }

  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  if (lastSlashIndex < 1 || lastSlashIndex === normalizedPath.length - 1) {
    throw new Error(`mediaPath must include location and file name: ${mediaPath}`);
  }

  const mediaFileLocation = normalizedPath.slice(0, lastSlashIndex).replace(/^\/+|\/+$/g, '');
  const mediaFileName = normalizedPath.slice(lastSlashIndex + 1).replace(/^\/+/, '');
  if (!mediaFileLocation || !mediaFileName) {
    throw new Error(`mediaPath must include location and file name: ${mediaPath}`);
  }
  return { mediaFileLocation, mediaFileName };
}

async function listCoreCustomers(deps = {}) {
  const coreApiClient = deps.coreApiClient || getCoreApiClient();
  const customers = await coreApiClient.listCustomersAdminAll({ limitCount: 5000 });
  return Array.isArray(customers)
    ? customers
    : (Array.isArray(customers?.items) ? customers.items : []);
}

export default {
  getCoreCustomerByV1CustomerID,
  getCoreCustomerByV2CustomerID,
  lookupV2CustomerIDByV1CustomerID,
  lookupLegacyCustomerIDByV2CustomerID,
  getMediaByV1MediaID,
  getFullEventByV1EventID,
  resolveLegacyMediaContext,
  getMediaByLocationName,
  buildMediaPathFromV1Media
};
