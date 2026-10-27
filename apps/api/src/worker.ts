import 'dotenv/config';
import { EnvValidationError, parseEnv } from './config/env';
import { createLogger } from './config/logger';
import { connectDatabase, disconnectDatabase } from './database/connection';
import { createQueue, createWorker, registerSchedules } from './jobs/queue';

/** Background worker process: `pnpm --filter @workforce/api worker`. Needs REDIS_URL. */
async function main(): Promise<void> {
  let env;
  try {
    env = parseEnv();
  } catch (err) {
    if (err instanceof EnvValidationError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
  if (!env.REDIS_URL) {
    console.error('REDIS_URL is not set: background jobs are disabled. Nothing to run.');
    process.exit(1);
  }
  const log = createLogger(env);
  await connectDatabase(env.MONGODB_URI, log);
  const queue = createQueue(env.REDIS_URL);
  await registerSchedules(queue);
  const worker = createWorker(env.REDIS_URL, { env, log });
  log.info('Worker started');

  const shutdown = (signal: string) => {
    log.info({ signal }, 'Worker shutting down');
    void Promise.all([worker.close(), queue.close()])
      .then(() => disconnectDatabase())
      .finally(() => process.exit(0));
    setTimeout(() => process.exit(1), 15_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection', reason);
  process.exit(1);
});

main().catch((err) => {
  console.error('Fatal worker error', err);
  process.exit(1);
});
