import type { Connection } from 'mongoose';
import { modelOnConnection, tenantModelNames } from '../tenantModel';
import './registerModels';

/** Marker collection that binds a database to exactly one company (prevents attaching the same data to two). */
export const META_COLLECTION = '_hrms_meta';

export interface DatabaseBinding {
  _id: 'binding';
  tenantId: string;
  createdAt: Date;
}

/** Creates every company collection and index on `conn`. Idempotent: safe to run on an already-initialised database. */
export async function initializeSchema(conn: Connection): Promise<void> {
  for (const name of tenantModelNames()) {
    const m = modelOnConnection(conn, name);
    try {
      await m.createCollection();
    } catch (e) {
      if ((e as { code?: number }).code !== 48) throw e; // 48 = already exists
    }
    await m.init();
  }
}

export const collectionNamesOf = (conn: Connection): string[] =>
  tenantModelNames().map((n) => modelOnConnection(conn, n).collection.collectionName);

export async function readBinding(conn: Connection): Promise<DatabaseBinding | null> {
  return (await conn.db!
    .collection<{ _id: string }>(META_COLLECTION)
    .findOne({ _id: 'binding' })) as unknown as DatabaseBinding | null;
}

/** Writes the binding once; never overwrites an existing one. */
export async function writeBinding(conn: Connection, tenantId: string): Promise<void> {
  await conn.db!
    .collection<{ _id: string }>(META_COLLECTION)
    .updateOne({ _id: 'binding' }, { $setOnInsert: { tenantId, createdAt: new Date() } }, { upsert: true });
}
