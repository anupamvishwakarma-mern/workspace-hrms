import type { Connection } from 'mongoose';
import { Tenant } from '../models/tenant.model';
import { recordDbEvent } from '../models/tenantDbEvent.model';
import { HostingError, safeErrorMessage } from './errors';
import { initializeSchema, readBinding, writeBinding } from './initialize';

export interface TenantMigrationContext {
  conn: Connection;
  tenantId: string;
}

/**
 * A versioned, forward-only company-database migration. Rules:
 *  - `up` MUST be idempotent (safe to re-run after a crash or a retry);
 *  - it must not delete or rewrite existing company data. A migration that has to (`destructive: true`) is refused
 *    unless the caller states that a verified backup exists (`backupConfirmed`);
 *  - versions are consecutive integers starting at 1 and are never edited once released.
 */
export interface TenantMigration {
  version: number;
  name: string;
  destructive?: boolean;
  up(ctx: TenantMigrationContext): Promise<void>;
}

export const MIGRATIONS: TenantMigration[] = [
  {
    version: 1,
    name: 'baseline: collections and indexes',
    up: async ({ conn, tenantId }) => {
      await initializeSchema(conn);
      await writeBinding(conn, tenantId);
    },
  },
  // Future migrations are appended here, e.g.
  // { version: 2, name: 'add index on X', up: async ({ conn }) => { await conn.collection('x').createIndex({ ... }) } },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;
const STALE_LOCK_MS = 30 * 60_000;

export interface MigrationOutcome {
  tenantId: string;
  from: number;
  to: number;
  applied: number[];
  status: 'UP_TO_DATE' | 'MIGRATED' | 'FAILED' | 'SKIPPED_RUNNING';
  error?: string;
}

/**
 * Brings one company's database to `target` (default: latest). Works the same for managed and customer-owned
 * databases because the caller supplies the connection. Progress is stored after every step, so a failure leaves a
 * consistent version and a retry resumes where it stopped. A lock in the control-plane record prevents two workers
 * from migrating the same company at once.
 */
export async function migrateTenantDatabase(
  tenantId: string,
  conn: Connection,
  opts: { target?: number; backupConfirmed?: boolean; actorUserId?: unknown } = {},
): Promise<MigrationOutcome> {
  const target = opts.target ?? LATEST_SCHEMA_VERSION;
  const now = new Date();
  const lock = await Tenant.findOneAndUpdate(
    {
      _id: tenantId,
      $or: [
        { 'database.lastMigration.status': { $ne: 'RUNNING' } },
        { 'database.lastMigration.startedAt': { $lt: new Date(now.getTime() - STALE_LOCK_MS) } },
      ],
    },
    { $set: { 'database.lastMigration.status': 'RUNNING', 'database.lastMigration.startedAt': now }, $unset: { 'database.lastMigration.error': '' } },
    { new: false },
  )
    .select('database.schemaVersion')
    .lean();
  if (!lock) return { tenantId, from: 0, to: 0, applied: [], status: 'SKIPPED_RUNNING' };

  const from = lock.database?.schemaVersion ?? 0;
  let current = from;
  const applied: number[] = [];
  try {
    // Compatibility: never run an older application against a database a newer one has already upgraded.
    if (from > LATEST_SCHEMA_VERSION)
      throw new HostingError('SCHEMA_TOO_NEW', `The database schema (v${from}) is newer than this application supports (v${LATEST_SCHEMA_VERSION}).`);
    // A database must belong to this company before anything is written to it.
    const binding = await readBinding(conn);
    if (binding && binding.tenantId !== tenantId)
      throw new HostingError('DATABASE_MISMATCH', 'This database is bound to a different company.');
    const pending = MIGRATIONS.filter((m) => m.version > from && m.version <= target);
    for (const m of pending) {
      if (m.destructive && !opts.backupConfirmed)
        throw new Error(`Migration ${m.version} (${m.name}) changes existing data and needs a confirmed backup first.`);
      await recordDbEvent({ tenantId, type: 'MIGRATION_STARTED', ok: true, actorUserId: opts.actorUserId, detail: { version: m.version, name: m.name } });
      await m.up({ conn, tenantId });
      current = m.version;
      applied.push(m.version);
      await Tenant.updateOne({ _id: tenantId }, { $set: { 'database.schemaVersion': current, 'database.lastMigration.version': current } });
      await recordDbEvent({ tenantId, type: 'MIGRATION_APPLIED', ok: true, actorUserId: opts.actorUserId, detail: { version: m.version } });
    }
    await Tenant.updateOne({ _id: tenantId }, { $set: { 'database.lastMigration.status': 'SUCCEEDED', 'database.lastMigration.finishedAt': new Date(), 'database.lastMigration.version': current } });
    return { tenantId, from, to: current, applied, status: applied.length ? 'MIGRATED' : 'UP_TO_DATE' };
  } catch (e) {
    const msg = safeErrorMessage(e);
    await Tenant.updateOne({ _id: tenantId }, { $set: { 'database.lastMigration.status': 'FAILED', 'database.lastMigration.finishedAt': new Date(), 'database.lastMigration.error': msg } });
    await recordDbEvent({ tenantId, type: 'MIGRATION_FAILED', ok: false, actorUserId: opts.actorUserId, detail: { atVersion: current + 1, error: msg } });
    return { tenantId, from, to: current, applied, status: 'FAILED', error: msg };
  }
}
