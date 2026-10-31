import { AsyncLocalStorage } from 'node:async_hooks';
import type { Connection } from 'mongoose';

/**
 * Which MongoDB database the tenant-scoped models talk to for the current request / job.
 *  - `connection` set: the company's own (customer-owned) cluster. Models are registered on that connection only.
 *  - `dbName` set: a database on the managed cluster (the default connection).
 *  - neither: the shared default database (companies created before per-company databases existed).
 * Scopes are produced by the tenant database manager from the tenant's stored hosting configuration; request code
 * never chooses a database itself.
 */
export interface TenantDbScope {
  dbName?: string;
  connection?: Connection;
}

const storage = new AsyncLocalStorage<TenantDbScope>();

/** Runs `fn` (and everything it awaits) against the given scope. */
export const runInTenantScope = <T>(scope: TenantDbScope, fn: () => T): T => storage.run(scope, fn);

/** Runs `fn` against a database on the managed cluster (or the shared one when `dbName` is undefined). */
export const runInTenantDb = <T>(dbName: string | undefined, fn: () => T): T =>
  storage.run({ dbName }, fn);

export const currentTenantScope = (): TenantDbScope | undefined => storage.getStore();
export const currentTenantDbName = (): string | undefined => storage.getStore()?.dbName;
