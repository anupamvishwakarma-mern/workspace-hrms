import 'dotenv/config';
import { EnvValidationError, parseEnv } from '../config/env';
import { createLogger } from '../config/logger';
import { connectDatabase, disconnectDatabase } from '../database/connection';

export async function runScript(
  fn: (env: ReturnType<typeof parseEnv>) => Promise<void>,
): Promise<void> {
  let env;
  try {
    env = parseEnv();
  } catch (err) {
    if (err instanceof EnvValidationError) {
      console.error(
        `${err.message}\n\nHint: run "pnpm setup:env" from the repo root to create apps/api/.env with generated secrets.`,
      );
      process.exitCode = 1;
      return;
    }
    throw err;
  }
  await connectDatabase(env.MONGODB_URI, createLogger({ ...env, LOG_LEVEL: 'warn' }));
  try {
    await fn(env);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
}
