import type { Logger } from 'pino';
import { tenantDatabaseManager } from '../database/hosting/manager';
import { LATEST_SCHEMA_VERSION, migrateTenantDatabase, type MigrationOutcome } from '../database/hosting/migrations';
import { TENANT_DB_FIELDS } from '../database/hosting/source';
import { Tenant } from '../database/models/tenant.model';

type Log = Pick<Logger, 'error' | 'info' | 'warn'>;

/**
 * Lightweight connection check of customer-owned databases. Never runs per API request. Each database is probed at
 * most once per interval, failing ones back off exponentially (`database.nextCheckAt`), and only a few run at a time,
 * so customers' databases are not hammered. Managed databases are monitored centrally via the shared connection.
 */
export async function runTenantDbHealthChecks(now: Date, opts: { log?: Log } = {}) {
  const settings = tenantDatabaseManager.getSettings();
  const due = await Tenant.find({
    status: { $in: ['ACTIVE', 'SUSPENDED'] },
    'database.hostingMode': 'CUSTOMER_OWNED',
    'database.status': 'READY',
    $or: [{ 'database.nextCheckAt': { $exists: false } }, { 'database.nextCheckAt': null }, { 'database.nextCheckAt': { $lte: now } }],
  })
    .select(TENANT_DB_FIELDS)
    .limit(1000)
    .lean();
  let healthy = 0;
  let unhealthy = 0;
  for (let i = 0; i < due.length; i += settings.health.concurrency) {
    const part = due.slice(i, i + settings.health.concurrency);
    const results = await Promise.all(part.map((t) => tenantDatabaseManager.checkCustomerHealth(t).catch(() => false)));
    for (const ok of results) {
      if (ok) healthy++;
      else unhealthy++;
    }
  }
  opts.log?.info({ checked: due.length, healthy, unhealthy }, 'tenant database health checks');
  return { checked: due.length, healthy, unhealthy };
}

const RETRY_FAILED_AFTER_MS = 60 * 60_000;

/**
 * Controlled rollout of schema migrations: a few companies per run (TENANT_DB_MIGRATION_BATCH), managed and
 * customer-owned alike. A failed company is retried after an hour; one failure never blocks the others.
 */
export async function runPendingTenantMigrations(now: Date, opts: { log?: Log } = {}) {
  const batch = tenantDatabaseManager.getSettings().migrationBatch;
  const pending = await Tenant.find({
    status: { $in: ['ACTIVE', 'SUSPENDED'] },
    'database.status': 'READY',
    $and: [
      { $or: [{ 'database.schemaVersion': { $exists: false } }, { 'database.schemaVersion': { $lt: LATEST_SCHEMA_VERSION } }] },
      {
        $or: [
          { 'database.lastMigration.status': { $ne: 'FAILED' } },
          { 'database.lastMigration.finishedAt': { $lt: new Date(now.getTime() - RETRY_FAILED_AFTER_MS) } },
        ],
      },
    ],
  })
    .select(TENANT_DB_FIELDS)
    .limit(batch)
    .lean();
  const outcomes: MigrationOutcome[] = [];
  for (const t of pending) {
    try {
      const { conn, release } = await tenantDatabaseManager.lease(t);
      try {
        outcomes.push(await migrateTenantDatabase(String(t._id), conn));
      } finally {
        release();
      }
    } catch (e) {
      opts.log?.warn({ tenantId: String(t._id), err: (e as Error).message }, 'migration skipped: database unavailable');
      outcomes.push({ tenantId: String(t._id), from: 0, to: 0, applied: [], status: 'FAILED', error: 'database unavailable' });
    }
  }
  return {
    considered: pending.length,
    migrated: outcomes.filter((o) => o.status === 'MIGRATED').length,
    failed: outcomes.filter((o) => o.status === 'FAILED').length,
  };
}
