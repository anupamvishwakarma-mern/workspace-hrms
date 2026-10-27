import mongoose from 'mongoose';
import type { Logger } from 'pino';

export async function connectDatabase(uri: string, logger: Logger): Promise<typeof mongoose> {
  mongoose.set('strictQuery', true);
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  logger.info('MongoDB connected');
  try {
    const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
    if (!hello.setName) {
      logger.warn(
        'MongoDB is not a replica set: transactions (tenant onboarding, leave balances) will fail. Use a single-node replica set, see README.',
      );
    }
  } catch {
    /* non-fatal */
  }
  return mongoose;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

/** Returns true when MongoDB answers a ping. */
export async function pingDatabase(): Promise<boolean> {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) return false;
  try {
    await mongoose.connection.db.admin().ping();
    return true;
  } catch {
    return false;
  }
}
