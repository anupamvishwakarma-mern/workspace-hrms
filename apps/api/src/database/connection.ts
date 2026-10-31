import mongoose from 'mongoose';
import type { Logger } from 'pino';
import { Tenant } from './models/tenant.model';
import { tenantDatabaseManager } from './hosting/manager';

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
  await tenantDatabaseManager.closeAll(); // customer-owned connections first
  await mongoose.disconnect();
}

/**
 * Companies created before hosting modes existed have no `database` block. The database manager refuses such a record
 * (it will not guess where the data lives), so give them an explicit MANAGED configuration once at start-up.
 * Idempotent and touches only records that lack the block.
 */
export async function backfillTenantDatabaseConfig(clusterId: string): Promise<number> {
  const legacy = await Tenant.find({ database: { $exists: false } }).select('_id dbName').lean();
  for (const t of legacy)
    await Tenant.updateOne(
      { _id: t._id, database: { $exists: false } },
      {
        $set: {
          database: {
            hostingMode: 'MANAGED',
            provider: 'MONGODB',
            status: 'READY',
            clusterId,
            databaseName: t.dbName ?? undefined,
            health: 'UNKNOWN',
            consecutiveFailures: 0,
          },
        },
      },
    );
  return legacy.length;
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
