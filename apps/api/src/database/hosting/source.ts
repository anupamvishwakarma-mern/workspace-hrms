import type { Types } from 'mongoose';

/**
 * The part of a Tenant record the database manager needs. Callers load it with TENANT_DB_FIELDS; the manager refuses
 * a record that was loaded without `database` rather than guessing (a guess could land on the wrong database).
 */
export interface TenantDbSource {
  _id: Types.ObjectId | string;
  status?: string | null;
  dbName?: string | null;
  database?: {
    hostingMode?: string | null;
    status?: string | null;
    databaseName?: string | null;
    connectionConfig?: {
      updatedAt?: Date | null;
      encryptedConnectionString?: string | null;
      encryptionKeyVersion?: string | null;
    } | null;
  } | null;
}

/** Mongoose `select` string for every query that feeds the database manager. */
export const TENANT_DB_FIELDS = 'status dbName database';
