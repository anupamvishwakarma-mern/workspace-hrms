import mongoose, { model, type Connection, type Schema } from 'mongoose';
import { currentTenantScope } from './tenantContext';

const schemas = new Map<string, Schema>();

/** Names of every model that lives in a company database (used to provision and migrate one). */
export const tenantModelNames = (): string[] => [...schemas.keys()];

/**
 * The model `name` bound to a specific connection (created on first use, then cached by that connection).
 * Models are never shared between connections, so a model obtained for one company's cluster cannot query another's.
 */
export function modelOnConnection(conn: Connection, name: string) {
  const schema = schemas.get(name);
  if (!schema) throw new Error(`Unknown tenant model: ${name}`);
  return conn.models[name] ?? conn.model(name, schema);
}

/** The model `name` bound to managed-cluster database `dbName`. */
export function modelForDb(dbName: string, name: string) {
  return modelOnConnection(mongoose.connection.useDb(dbName, { useCache: true }), name);
}

/**
 * Declares a model that holds company data. It behaves exactly like a normal Mongoose model, but every call is
 * routed to the database of the company in the current context (see runInTenantScope). With no company context it
 * uses the default database, so companies that predate per-company databases keep working unchanged.
 */
export function tenantModel<S extends Schema>(name: string, schema: S) {
  schemas.set(name, schema);
  const base = model(name, schema); // default database
  const resolve = (): typeof base => {
    const scope = currentTenantScope();
    if (scope?.connection) return modelOnConnection(scope.connection, name) as unknown as typeof base;
    if (scope?.dbName) return modelForDb(scope.dbName, name) as unknown as typeof base;
    return base;
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
