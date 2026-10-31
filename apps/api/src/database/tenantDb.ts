import type { Types } from 'mongoose';
import { tenantDatabaseManager } from './hosting/manager';

/**
 * Runs `fn` against the database of the given company, wherever it is hosted (managed cluster or the customer's own).
 * Throws a HostingError (503) when that database is unavailable; it never falls back to another database.
 */
export const runInTenant = <T>(tenantId: Types.ObjectId | string, fn: () => Promise<T>): Promise<T> =>
  tenantDatabaseManager.runInTenant(tenantId, fn);
