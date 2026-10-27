import 'dotenv/config';
import { createApp } from './app';
import { EnvValidationError, parseEnv } from './config/env';
import { createLogger } from './config/logger';
import { connectDatabase, disconnectDatabase } from './database/connection';

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
  const logger = createLogger(env);
  await connectDatabase(env.MONGODB_URI, logger);
  const app = createApp(env, logger);
  const server = app.listen(env.API_PORT, () => logger.info(`API listening on :${env.API_PORT}`));

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => {
      void disconnectDatabase().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection', reason);
  process.exit(1);
});

main().catch((err) => {
  console.error('Fatal startup error', err);
  process.exit(1);
});
