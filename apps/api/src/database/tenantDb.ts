import type { Types } from 'mongoose';
import { Tenant } from './models/tenant.model';
import { runInTenantDb } from './tenantContext';

/** Runs `fn` against the database of the given company (the shared database for legacy companies). */
export async function runInTenant<T>(tenantId: Types.ObjectId | string, fn: () => Promise<T>) {
  const t = await Tenant.findById(tenantId).select('dbName').lean();
  return runInTenantDb(t?.dbName ?? undefined, fn);
}

/**
 * Runs `fn` once per physical company database: the shared one (legacy companies) and every per-company one.
 * Used by background jobs whose queries are not scoped to a single company. One database failing does not stop
 * the others; failures are returned so the job can report them.
 */
export async function forEachTenantDb<T>(
  fn: (dbName: string | undefined) => Promise<T>,
): Promise<{ results: T[]; failed: string[] }> {
  const names = (await Tenant.distinct('dbName', { dbName: { $exists: true, $ne: null } })) as string[];
  const results: T[] = [];
  const failed: string[] = [];
  for (const dbName of [undefined, ...names]) {
    try {
      results.push(await runInTenantDb(dbName, () => fn(dbName)));
    } catch {
      failed.push(dbName ?? '(shared)');
    }
  }
  return { results, failed };
}
