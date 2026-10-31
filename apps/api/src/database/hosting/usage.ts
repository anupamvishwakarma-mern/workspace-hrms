import type { Connection } from 'mongoose';

export interface DatabaseUsage {
  dataSizeMb: number;
  storageSizeMb: number;
  indexSizeMb: number;
  collections: number;
  objects: number;
}

const cache = new Map<string, { at: number; value: DatabaseUsage }>();
const TTL_MS = 5 * 60_000;
const mb = (n: number) => Math.round((n / 1_048_576) * 100) / 100;

/** Approximate size of one company's database (dbStats), cached for a few minutes so a settings page is cheap. */
export async function databaseUsage(tenantId: string, conn: Connection): Promise<DatabaseUsage | undefined> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  try {
    const s = (await conn.db!.command({ dbStats: 1 })) as Record<string, number>;
    const value: DatabaseUsage = {
      dataSizeMb: mb(s.dataSize ?? 0),
      storageSizeMb: mb(s.storageSize ?? 0),
      indexSizeMb: mb(s.indexSize ?? 0),
      collections: s.collections ?? 0,
      objects: s.objects ?? 0,
    };
    cache.set(tenantId, { at: Date.now(), value });
    return value;
  } catch {
    return undefined; // usage is informational: never fail the page because of it
  }
}
