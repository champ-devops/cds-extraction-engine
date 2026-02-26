import CustomerAPIClient from '@champds/customerapi-client';
import { getConfig } from '../config/appConfig.js';

export class CustomerApiClient {
  constructor(options = {}) {
    const config = getConfig();
    this.customerAPI = options.customerAPI || config.customerAPI || {};
    this.client = new CustomerAPIClient(this.customerAPI);
  }

  async requestGet(path, query = undefined) {
    try {
      const response = await this.client.doGet({
        path,
        queryJSON: query
      });
      return response?.result;
    } catch (error) {
      const wrappedError = new Error(`CustomerAPI GET failed for ${path}`);
      wrappedError.details = {
        operation: 'customerapi:get',
        path,
        query,
        statusCode: error?.statusCode,
        body: error?.body
      };
      wrappedError.statusCode = error?.statusCode || 502;
      wrappedError.cause = error;
      throw wrappedError;
    }
  }
}

let clientInstance = null;

export function getCustomerApiClient() {
  if (!clientInstance) {
    clientInstance = new CustomerApiClient();
  }
  return clientInstance;
}

export default { CustomerApiClient, getCustomerApiClient };
