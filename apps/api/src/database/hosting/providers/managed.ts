import mongoose, { type Connection } from 'mongoose';
import type { TenantDbScope } from '../../tenantContext';
import type { TenantDbSource } from '../source';

/**
 * Databases on OUR shared MongoDB cluster. All managed tenants share the one default connection (and its pool);
 * a tenant is just a database name selected with `useDb()`, which Mongoose caches. No per-tenant connection string
 * exists, and no connection is opened per request. A source without a database name is a company that predates
 * per-company databases and lives in the shared default database.
 */
export class ManagedMongoProvider {
  scope(t: TenantDbSource): TenantDbScope {
    return { dbName: t.dbName ?? undefined };
  }

  getDatabase(t: TenantDbSource): Connection {
    return t.dbName ? mongoose.connection.useDb(t.dbName, { useCache: true }) : mongoose.connection;
  }

  /** Cheap liveness check of the shared cluster connection (monitored centrally, not per tenant). */
  async ping(): Promise<boolean> {
    if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) return false;
    try {
      await mongoose.connection.db.admin().ping();
      return true;
    } catch {
      return false;
    }
  }
}
