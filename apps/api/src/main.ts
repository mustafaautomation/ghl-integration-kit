import { createDb, migrate } from '@ghl/db';
import { createLogger } from '@ghl/domain';
import { buildServer, ensureInstallation, prepareQueuePath } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
prepareQueuePath(config.queueDbPath);
const logger = createLogger(config.logLevel);
const { sql, db } = createDb(config.databaseUrl);
await migrate(sql);
const { app, worker, ctx } = await buildServer({ config, db, sql, logger });
await app.listen({ port: config.port, host: config.host });
await ensureInstallation(ctx);
worker.start();
logger.info({ port: config.port, mode: config.mode }, 'api listening');

const shutdown = async () => {
  worker.stop();
  await app.close();
  await sql.end();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
