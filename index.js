import dotenv from 'dotenv';
import cron from 'node-cron';
import { scrapeVerkadaApiDocs } from './scraper.js';

dotenv.config();

const config = {
  verkadaApiDocsUrl: process.env.VERKADA_API_DOCS_URL,
  postmanApiKey: process.env.POSTMAN_API_KEY,
  postmanWorkspaceId: process.env.POSTMAN_WORKSPACE_ID,
  postmanCollectionId: process.env.POSTMAN_COLLECTION_ID,
  syncSchedule: process.env.SYNC_SCHEDULE || '0 */6 * * *',
  logLevel: (process.env.LOG_LEVEL || 'info').toLowerCase()
};

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function log(level, message, ...args) {
  if (LOG_LEVELS[level] <= LOG_LEVELS[config.logLevel]) {
    console.log(`[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`, ...args);
  }
}

function validateConfig() {
  const missing = [];
  if (!config.verkadaApiDocsUrl) missing.push('VERKADA_API_DOCS_URL');
  if (!config.postmanApiKey) missing.push('POSTMAN_API_KEY');
  if (!config.postmanWorkspaceId) missing.push('POSTMAN_WORKSPACE_ID');
  return missing;
}

let postmanSync;

try {
  const mod = await import('./postmanSync.js');
  postmanSync = mod.default || mod;
} catch {
  if (config.postmanApiKey && config.postmanWorkspaceId) {
    log('warn', 'postmanSync.js not found. Install or create postmanSync.js to enable Postman synchronization.');
  }
}

function transformEndpointsToPostmanFormat(endpoints) {
  if (!Array.isArray(endpoints)) return [];

  const categories = {};
  for (const endpoint of endpoints) {
    const category = endpoint.category || 'Uncategorized';
    if (!categories[category]) {
      categories[category] = [];
    }

    const item = {
      name: endpoint.description || `${endpoint.method} ${endpoint.path}`,
      request: {
        method: endpoint.method,
        header: [],
        body: {},
        url: {
          raw: `{{baseUrl}}${endpoint.path}`,
          host: ['{{baseUrl}}'],
          path: endpoint.path.split('/').filter(Boolean)
        }
      }
    };

    if (endpoint.parameters && endpoint.parameters.length > 0) {
      const queryParams = [];
      for (const param of endpoint.parameters) {
        queryParams.push({
          key: param.name,
          value: '',
          description: param.description || '',
          disabled: !param.required
        });
        if (param.in === 'query') {
          item.request.url.query.push({ key: param.name, value: '' });
        }
      }
      item.request.parameter = queryParams;
    }

    if (endpoint.description) {
      item.request.description = endpoint.description;
    }

    categories[category].push(item);
  }

  return Object.entries(categories).map(([name, items]) => ({ name, item: items }));
}

async function sync() {
  log('info', 'Starting sync run');

  try {
    const result = await scrapeVerkadaApiDocs(config.verkadaApiDocsUrl);
    log('info', `Scraped ${result.count} API endpoints from ${result.source}`);

    if (result.count === 0) {
      log('warn', 'No API endpoints found in scraped data');
      return { scraped: 0, synced: 0, postman: null };
    }

    if (!postmanSync) {
      log('info', 'Postman sync skipped — postmanSync.js not available or Postman credentials not configured');
      return { scraped: result.count, synced: 0, postman: null };
    }

    const collectionData = transformEndpointsToPostmanFormat(result.endpoints);
    const syncResult = await postmanSync.updateCollection(
      config.postmanCollectionId,
      collectionData,
      config.postmanApiKey,
      config.postmanWorkspaceId
    );

    log('info', `Postman collection updated: ${syncResult.updated || 0} endpoints updated, ${syncResult.created || 0} created`);
    return { scraped: result.count, synced: syncResult.updated || 0, postman: syncResult };
  } catch (error) {
    log('error', `Sync failed: ${error.message}`);
    throw error;
  }
}

async function shutdown(signal) {
  log('info', `Received ${signal}, shutting down gracefully...`);
  cron.getTasks().forEach(task => task.stop());
  log('info', 'All scheduled tasks stopped. Goodbye.');
  process.exit(0);
}

function start() {
  const missing = validateConfig();
  if (missing.length > 0) {
    console.error(`Error: missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  log('info', `Verkada API → Postman sync starting`);
  log('info', `Schedule: ${config.syncSchedule}`);

  if (!cron.validate(config.syncSchedule)) {
    console.error(`Error: invalid cron expression "${config.syncSchedule}"`);
    process.exit(1);
  }

  const shouldRunOnStart = process.argv.includes('--run-on-start');
  if (shouldRunOnStart || !config.syncSchedule || config.syncSchedule === 'manual') {
    log('info', 'Manual mode: running once, no schedule');
    sync().catch(error => {
      console.error(`Fatal error during sync: ${error.message}`);
      process.exit(1);
    });
    return;
  }

  cron.schedule(config.syncSchedule, async () => {
    try {
      await sync();
    } catch (error) {
      log('error', `Scheduled sync failed: ${error.message}`);
    }
  }, { scheduled: true });

  log('info', `Scheduled task configured with cron: ${config.syncSchedule}`);

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start();
