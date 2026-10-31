import { randomBytes } from 'node:crypto';
import mongoose, { type Connection } from 'mongoose';
import {
  assertHostsAllowed,
  databaseFingerprint,
  parseMongoUri,
  requireCredentials,
  resolveDatabaseName,
  systemResolver,
  tlsEnabled,
  type ParsedMongoUri,
  type Resolver,
} from './connectionString';
import { classifyMongoError, HostingError } from './errors';
import { collectionNamesOf, readBinding } from './initialize';
import type { HostingSettings } from './settings';
import type { VerificationCheck, VerificationResult } from './types';

/** Opens a connection to a customer's cluster with our timeouts and pool limits. The caller must close it. */
export async function openCustomerConnection(
  settings: HostingSettings,
  uri: string,
  databaseName: string,
  parsed: ParsedMongoUri = parseMongoUri(uri),
): Promise<Connection> {
  const tls = tlsEnabled(parsed, settings);
  const conn = mongoose.createConnection(uri, {
    dbName: databaseName,
    serverSelectionTimeoutMS: settings.connectTimeoutMs,
    connectTimeoutMS: settings.connectTimeoutMs,
    socketTimeoutMS: settings.socketTimeoutMs,
    maxPoolSize: settings.maxPoolSize,
    minPoolSize: 0,
    maxIdleTimeMS: 60_000,
    appName: 'workforce-hrms',
    // Schema and indexes are managed by explicit migrations, never as a side effect of opening a connection.
    autoIndex: false,
    autoCreate: false,
    ...(tls ? { tls: true } : {}),
  });
  // Without a listener a late driver error would crash the process.
  conn.on('error', () => undefined);
  try {
    await conn.asPromise();
  } catch (e) {
    await conn.close().catch(() => undefined);
    throw classifyMongoError(e);
  }
  return conn;
}

const versionParts = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);
export function versionAtLeast(actual: string, min: string): boolean {
  const a = versionParts(actual);
  const b = versionParts(min);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

export interface VerifyInput {
  connectionString: string;
  databaseName?: string;
  /**
   * Set when replacing the credentials of an existing company: the database must then already be bound to this
   * company (same data, e.g. a rotated password or a restored cluster). Unset = first-time attach: it must be empty.
   */
  tenantId?: string;
}

/**
 * Verifies a customer database end to end on a temporary connection (always closed): host policy (SSRF), TLS,
 * authentication, MongoDB version, replica-set/transaction support, a real create/index/write/transaction/drop probe
 * for permissions, and that it holds no one else's data. Throws a HostingError with a safe message on failure.
 */
export async function verifyCustomerDatabase(
  settings: HostingSettings,
  input: VerifyInput,
  resolver: Resolver = systemResolver,
): Promise<VerificationResult> {
  if (!settings.customerOwnedEnabled)
    throw new HostingError('CUSTOMER_DB_DISABLED', 'Customer-owned databases are not enabled on this platform.');
  const parsed = parseMongoUri(input.connectionString);
  if (settings.requireCredentials) requireCredentials(parsed);
  const databaseName = resolveDatabaseName(parsed, input.databaseName);
  tlsEnabled(parsed, settings);
  await assertHostsAllowed(parsed, settings, resolver);
  const fingerprint = databaseFingerprint(parsed, databaseName);

  const checks: VerificationCheck[] = [];
  const conn = await openCustomerConnection(settings, input.connectionString, databaseName, parsed);
  try {
    const db = conn.db!;
    try {
      await db.command({ ping: 1 });
    } catch (e) {
      throw classifyMongoError(e);
    }
    checks.push({ name: 'connection', ok: true }, { name: 'authentication', ok: true });

    const info = (await db.admin().command({ buildInfo: 1 })) as { version: string };
    if (!versionAtLeast(info.version, settings.minMongoVersion))
      throw new HostingError('UNSUPPORTED_VERSION', `MongoDB ${settings.minMongoVersion} or newer is required (the server runs ${info.version}).`);
    checks.push({ name: 'version', ok: true, detail: info.version });

    const hello = (await db.admin().command({ hello: 1 })) as { setName?: string; msg?: string };
    if (!hello.setName && hello.msg !== 'isdbgrid')
      throw new HostingError('UNSUPPORTED_TOPOLOGY', 'The database must be a replica set (or sharded cluster): HR operations use transactions. A standalone server is not supported. MongoDB Atlas clusters qualify.');
    checks.push({ name: 'topology', ok: true });

    await probePermissions(conn);
    checks.push({ name: 'permissions', ok: true });

    const existing = await db.listCollections({}, { nameOnly: true }).toArray();
    const names = new Set(existing.map((c) => c.name));
    const ours = collectionNamesOf(conn).filter((n) => names.has(n));
    let hasData = false;
    for (const n of ours) if (await db.collection(n).findOne({}, { projection: { _id: 1 } })) hasData = true;
    const binding = await readBinding(conn);
    if (input.tenantId) {
      if (!binding || binding.tenantId !== input.tenantId)
        throw new HostingError(
          'DATABASE_MISMATCH',
          'This database does not hold this company\'s HRMS data. To move to a different database, request a data migration; credentials can only be replaced with ones for the same database.',
        );
      checks.push({ name: 'binding', ok: true });
    } else {
      if (binding) throw new HostingError('DATABASE_IN_USE', 'This database is already in use by an HRMS company. Choose an empty database.');
      if (hasData) throw new HostingError('DATABASE_NOT_EMPTY', 'This database already contains HRMS collections with data. Choose an empty database so nothing is overwritten.');
      checks.push({ name: 'emptiness', ok: true });
    }
    return { ok: true, databaseName, serverVersion: info.version, fingerprint, checks };
  } catch (e) {
    throw classifyMongoError(e);
  } finally {
    await conn.close().catch(() => undefined);
  }
}

/** Minimum privileges HRMS needs: create/drop collection, create index, read/write, transactions. */
async function probePermissions(conn: Connection): Promise<void> {
  const db = conn.db!;
  const name = `__hrms_probe_${randomBytes(6).toString('hex')}`;
  let created = false;
  try {
    await db.createCollection(name);
    created = true;
    const col = db.collection(name);
    await col.createIndex({ probe: 1 });
    const session = await conn.startSession();
    try {
      await session.withTransaction(async () => {
        await col.insertOne({ probe: 1 }, { session });
      });
    } catch (e) {
      if ((e as { code?: number }).code === 20 || /Transaction numbers/i.test(String((e as Error).message)))
        throw new HostingError('UNSUPPORTED_TOPOLOGY', 'The database does not support transactions. It must be a replica set or sharded cluster.');
      throw e;
    } finally {
      await session.endSession();
    }
    await col.updateOne({ probe: 1 }, { $set: { probe: 2 } });
    await col.findOne({ probe: 2 });
    await col.deleteMany({});
  } catch (e) {
    throw classifyMongoError(e);
  } finally {
    if (created) await db.dropCollection(name).catch(() => undefined);
  }
}
