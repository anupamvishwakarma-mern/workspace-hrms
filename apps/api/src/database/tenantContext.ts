import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Which MongoDB database the tenant-scoped models talk to for the current request / job.
 * `dbName` undefined = the shared default database (companies created before per-company databases existed).
 */
interface TenantDbContext {
  dbName?: string;
}

const storage = new AsyncLocalStorage<TenantDbContext>();

/** Runs `fn` (and everything it awaits) against the given company database. */
export const runInTenantDb = <T>(dbName: string | undefined, fn: () => T): T =>
  storage.run({ dbName }, fn);

export const currentTenantDbName = (): string | undefined => storage.getStore()?.dbName;
