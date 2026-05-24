import axios from 'axios';
import * as cheerio from 'cheerio';

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;
const DEFAULT_TIMEOUT = 30000;

async function fetchWithRetry(url, options = {}, maxRetries = DEFAULT_MAX_RETRIES, retryDelay = DEFAULT_RETRY_DELAY) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(url, {
        timeout: DEFAULT_TIMEOUT,
        ...options
      });
      return response.data;
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
      }
    }
  }

  throw lastError;
}

function extractApiEndpoints($) {
  const endpoints = [];

  $('div.api-endpoint, table.endpoints tr, .endpoint-item, [class*="endpoint"]').each((_, element) => {
    const $el = $(element);

    const method = $el.find('.method, .http-method, [data-method]').first().text().trim().toUpperCase() ||
                   $el.attr('data-method')?.toUpperCase();

    const path = $el.find('.path, .endpoint-path, [data-path]').first().text().trim() ||
                 $el.attr('data-path') ||
                 $el.find('code').first().text().trim();

    const description = $el.find('.description, .endpoint-description, p').first().text().trim();

    if (method && path) {
      endpoints.push({
        method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(method) ? method : 'GET',
        path: path.startsWith('/') ? path : `/${path}`,
        description: description || '',
        parameters: []
      });
    }
  });

  return endpoints;
}

function extractParameters($, $container) {
  const parameters = [];

  $container.find('tr, .parameter-item, [class*="param"]').each((_, row) => {
    const $row = $(row);
    const name = $row.find('td:first-child, .param-name, [data-param]').first().text().trim();
    const type = $row.find('td:nth-child(2), .param-type').first().text().trim();
    const required = $row.find('td:nth-child(3), .param-required').text().toLowerCase().includes('true') ||
                     $row.find('.required').length > 0;
    const description = $row.find('td:nth-child(4), .param-description').first().text().trim();

    if (name) {
      parameters.push({
        name,
        type: type || 'string',
        required,
        description: description || '',
        in: 'query'
      });
    }
  });

  return parameters;
}

function extractApiData($) {
  const apiData = [];

  $('h2, h3, h4').each((_, header) => {
    const $header = $(header);
    const sectionTitle = $header.text().trim();

    let $current = $header.next();
    while ($current.length && !$current.is('h2, h3, h4')) {
      if ($current.find('.api-endpoint, table.endpoints, .endpoint-item, [class*="endpoint"]').length) {
        $current.find('.api-endpoint, table.endpoints, .endpoint-item, [class*="endpoint"]').each((_, element) => {
          const $el = $(element);

          const method = $el.find('.method, .http-method, [data-method]').first().text().trim().toUpperCase() ||
                         $el.attr('data-method')?.toUpperCase();

          const path = $el.find('.path, .endpoint-path, [data-path]').first().text().trim() ||
                       $el.attr('data-path') ||
                       $el.find('code').first().text().trim();

          const description = $el.find('.description, .endpoint-description, p').first().text().trim();

          if (method && path) {
            const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
            const httpMethod = validMethods.includes(method) ? method : 'GET';

            const endpoint = {
              path: path.startsWith('/') ? path : `/${path}`,
              method: httpMethod,
              description: description || sectionTitle,
              parameters: extractParameters($, $el),
              category: sectionTitle
            };

            apiData.push(endpoint);
          }
        });
      }

      if ($current.is('table')) {
        const headers = [];
        const $headerRow = $current.find('tr:first-child th, tr:first-child td');

        $headerRow.each((_, th) => {
          headers.push($(th).text().trim().toLowerCase());
        });

        $current.find('tr:not(:first-child)').each((_, row) => {
          const $cells = $(row).find('td');
          if ($cells.length >= 2) {
            let path = '';
            let method = 'GET';
            let description = '';

            $cells.each((i, cell) => {
              const cellText = $(cell).text().trim();
              if (headers[i]) {
                if (headers[i].includes('path') || headers[i].includes('endpoint')) {
                  path = cellText;
                } else if (headers[i].includes('method')) {
                  method = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(cellText.toUpperCase())
                    ? cellText.toUpperCase()
                    : 'GET';
                } else if (headers[i].includes('description') || headers[i].includes('desc')) {
                  description = cellText;
                }
              }
            });

            if (path && !apiData.some(e => e.path === path && e.method === method)) {
              apiData.push({
                path: path.startsWith('/') ? path : `/${path}`,
                method,
                description,
                parameters: [],
                category: sectionTitle
              });
            }
          }
        });
      }

      $current = $current.next();
    }
  });

  return apiData.length > 0 ? apiData : extractApiEndpoints($);
}

export async function scrapeVerkadaApiDocs(url, options = {}) {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    retryDelay = DEFAULT_RETRY_DELAY,
    timeout = DEFAULT_TIMEOUT
  } = options;

  try {
    const html = await fetchWithRetry(url, {}, maxRetries, retryDelay);
    const $ = cheerio.load(html);
    const apiData = extractApiData($);

    return {
      success: true,
      source: url,
      count: apiData.length,
      endpoints: apiData
    };
  } catch (error) {
    if (error.response) {
      throw new Error(`HTTP error: ${error.response.status} ${error.response.statusText}`);
    } else if (error.request) {
      throw new Error(`Network error: Unable to reach ${url}`);
    } else {
      throw new Error(`Scraping error: ${error.message}`);
    }
  }
}

export default scrapeVerkadaApiDocs;