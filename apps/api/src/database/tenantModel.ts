import mongoose, { model, type Schema } from 'mongoose';
import { currentTenantDbName } from './tenantContext';

const schemas = new Map<string, Schema>();

/** Names of every model that lives in a company database (used to provision a new one). */
export const tenantModelNames = (): string[] => [...schemas.keys()];

/** The model `name` bound to company database `dbName` (created on first use, then cached by Mongoose). */
export function modelForDb(dbName: string, name: string) {
  const schema = schemas.get(name);
  if (!schema) throw new Error(`Unknown tenant model: ${name}`);
  const conn = mongoose.connection.useDb(dbName, { useCache: true });
  return conn.models[name] ?? conn.model(name, schema);
}

/**
 * Declares a model that holds company data. It behaves exactly like a normal Mongoose model, but every call is
 * routed to the database of the company in the current context (see runInTenantDb). With no company context it
 * uses the default database, so companies that predate per-company databases keep working unchanged.
 */
export function tenantModel<S extends Schema>(name: string, schema: S) {
  schemas.set(name, schema);
  const base = model(name, schema); // default database
  const resolve = (): typeof base => {
    const db = currentTenantDbName();
    return db ? (modelForDb(db, name) as unknown as typeof base) : base;
  };
  return new Proxy(base, {
    get(_t, prop) {
      const m = resolve();
      const v = Reflect.get(m, prop, m) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(m) : v;
    },
    set(_t, prop, value) {
      return Reflect.set(resolve(), prop, value);
    },
    has(_t, prop) {
      return Reflect.has(resolve(), prop);
    },
    construct(_t, args) {
      const M = resolve() as unknown as new (...a: unknown[]) => object;
      return new M(...args);
    },
  }) as typeof base;
}
