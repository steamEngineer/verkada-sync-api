// Postman synchronization utility
// Interacts with Postman API to update/create collections with API endpoints

import axios from 'axios';

/**
 * Postman API client
 */
class PostmanSync {
  /**
   * @param {string} apiKey - Postman API key
   * @param {string} workspaceId - Postman workspace ID
   * @param {string} [collectionId] - Postman collection ID (optional)
   */
  constructor(apiKey, workspaceId, collectionId = null) {
    this.apiKey = apiKey;
    this.workspaceId = workspaceId;
    this.collectionId = collectionId;
    this.client = axios.create({
      baseURL: 'https://api.getpostman.com',
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Get existing collection details
   * @returns {Promise<Object>} Collection data
   */
  async getCollection() {
    if (!this.collectionId) {
      throw new Error('Collection ID is required to get collection details');
    }

    try {
      const response = await this.client.get(`/collections/${this.collectionId}`);
      return response.data.collection;
    } catch (error) {
      throw this.handleError(error, 'Failed to get collection');
    }
  }

  /**
   * Create a new collection in the workspace
   * @param {Object} collectionData - Postman collection v2.1 format
   * @returns {Promise<Object>} Created collection data
   */
  async createCollection(collectionData) {
    try {
      const response = await this.client.post(`/workspaces/${this.workspaceId}/collections`, {
        collection: collectionData
      });
      return response.data.collection;
    } catch (error) {
      throw this.handleError(error, 'Failed to create collection');
    }
  }

  /**
   * Update an existing collection
   * @param {Object} collectionData - Postman collection v2.1 format
   * @returns {Promise<Object>} Updated collection data
   */
  async updateCollection(collectionData) {
    if (!this.collectionId) {
      throw new Error('Collection ID is required to update collection');
    }

    try {
      const response = await this.client.put(`/collections/${this.collectionId}`, {
        collection: collectionData
      });
      return response.data.collection;
    } catch (error) {
      throw this.handleError(error, 'Failed to update collection');
    }
  }

  /**
   * Convert scraped API data to Postman collection v2.1 format
   * @param {Array<Object>} apiEndpoints - Array of API endpoint objects from scraper
   * @param {string} collectionName - Name for the Postman collection
   * @returns {Object} Postman collection v2.1 format
   */
  static convertToPostmanCollection(apiEndpoints, collectionName = 'Verkada API') {
    // Validate input
    if (!Array.isArray(apiEndpoints)) {
      throw new Error('apiEndpoints must be an array');
    }

    // Create Postman collection structure
    const collection = {
      info: {
        _postman_id: this.generateGuid(),
        name: collectionName,
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
      },
      item: []
    };

    // Group endpoints by path or tag if available
    const grouped = this.groupEndpoints(apiEndpoints);

    // Create folders and requests
    for (const [groupName, endpoints] of Object.entries(grouped)) {
      const folder = {
        name: groupName,
        item: []
      };

      for (const endpoint of endpoints) {
        const requestItem = this.convertEndpointToRequest(endpoint);
        folder.item.push(requestItem);
      }

      collection.item.push(folder);
    }

    return collection;
  }

  /**
   * Generate a GUID for Postman ID
   * @returns {string} GUID
   */
  static generateGuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Group endpoints by tag or path prefix
   * @param {Array<Object>} endpoints - Array of endpoint objects
   * @returns {Object} Grouped endpoints
   */
  static groupEndpoints(endpoints) {
    const groups = {};

    for (const endpoint of endpoints) {
      // Use tag if available, otherwise use first path segment
      let groupName = endpoint.tag || 'Default';
      if (!endpoint.tag && endpoint.path) {
        const pathSegments = endpoint.path.split('/').filter(Boolean);
        groupName = pathSegments[0] || 'Default';
      }

      if (!groups[groupName]) {
        groups[groupName] = [];
      }
      groups[groupName].push(endpoint);
    }

    return groups;
  }

  /**
   * Convert a single endpoint to Postman request format
   * @param {Object} endpoint - API endpoint object
   * @returns {Object} Postman request item
   */
  static convertEndpointToRequest(endpoint) {
    const request = {
      name: endpoint.description || endpoint.method + ' ' + endpoint.path,
      event: [],
      request: {
        method: endpoint.method.toUpperCase(),
        header: [],
        url: {
          raw: '{{baseUrl}}' + endpoint.path,
          host: ['{{baseUrl}}'],
          path: endpoint.path.split('/').filter(Boolean)
        }
      }
    };

    // Add description if available
    if (endpoint.description) {
      request.request.description = endpoint.description;
    }

    // Add query parameters if available
    if (endpoint.queryParams && Array.isArray(endpoint.queryParams)) {
      request.request.url.query = endpoint.queryParams.map(param => ({
        key: param.key,
        value: param.value,
        description: param.description || ''
      }));
    }

    // Add headers if available
    if (endpoint.headers && Array.isArray(endpoint.headers)) {
      request.request.header = endpoint.headers.map(header => ({
        key: header.key,
        value: header.value,
        description: header.description || ''
      }));
    }

    // Add body if available
    if (endpoint.body) {
      request.request.body = {
        mode: endpoint.body.mode || 'raw',
        raw: typeof endpoint.body === 'string' ? endpoint.body : JSON.stringify(endpoint.body),
        options: {
          raw: {
            language: endpoint.body.language || 'json'
          }
        }
      };
    }

    return request;
  }

  /**
   * Handle API errors with rate limiting and retry logic
   * @param {Error} error - Axios error
   * @param {string} message - Custom error message
   * @returns {Promise} - Rejects with enhanced error
   */
  async handleError(error, message) {
    // Handle rate limiting (429)
    if (error.response && error.response.status === 429) {
      const retryAfter = error.response.headers['retry-after'] || 1;
      // Wait for retry-after seconds before retrying
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      // Retry the original operation - this would need to be implemented by the caller
      throw new Error(`Rate limited. Retry after ${retryAfter} seconds: ${message}`);
    }

    // Handle other errors
    if (error.response) {
      // Server responded with error status
      throw new Error(`${message}: ${error.response.status} - ${error.response.data?.message || error.response.statusText}`);
    } else if (error.request) {
      // No response received
      throw new Error(`${message}: No response received from Postman API`);
    } else {
      // Error in request setup
      throw new Error(`${message}: ${error.message}`);
    }
  }
}

// Export the class and utility functions
export { PostmanSync };
export default PostmanSync;