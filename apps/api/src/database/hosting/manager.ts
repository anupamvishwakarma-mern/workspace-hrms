import type { Connection, Types } from 'mongoose';
import type { Logger } from 'pino';
import type { Env } from '../../config/env';
import { Tenant } from '../models/tenant.model';
import { runInTenantScope, type TenantDbScope } from '../tenantContext';
import { HostingError } from './errors';
import { recordConnectionResult } from './health';
import { CustomerMongoProvider } from './providers/customer';
import { ManagedMongoProvider } from './providers/managed';
import { DEFAULT_SETTINGS, hostingSettingsFromEnv, type HostingSettings } from './settings';
import { TENANT_DB_FIELDS, type TenantDbSource } from './source';

export interface ResolveOptions {
  /** Suspended/closed companies are refused unless the caller (platform tooling, activation) needs them. */
  allowInactive?: boolean;
  /** Companies whose database is not READY are refused unless the caller is part of provisioning/verification. */
  allowNotReady?: boolean;
}

export interface TenantDatabaseManagerApi {
  getTenantDatabase(tenantId: string): Promise<Connection>;
  verifyConnection(tenantId: string): Promise<boolean>;
  closeTenantConnection(tenantId: string): Promise<void>;
}

const idOf = (t: TenantDbSource) => String(t._id);

/**
 * THE one place that decides which database a company's data lives in. Everything else (request middleware, jobs,
 * platform tooling) asks it for a scope derived from the company's stored hosting configuration; no module opens
 * its own MongoDB connection and no caller supplies a database name.
 */
export class TenantDatabaseManager implements TenantDatabaseManagerApi {
  private settings: HostingSettings = DEFAULT_SETTINGS;
  private log?: Logger;
  readonly managed = new ManagedMongoProvider();
  readonly customer = new CustomerMongoProvider(
    () => this.settings,
    () => this.log,
    {
      onOpened: (id) => void recordConnectionResult(id, { ok: true }, { recheckMs: this.settings.health.minIntervalMs }),
      onOpenFailed: (id, error) =>
        void recordConnectionResult(id, { ok: false, error }, { maxBackoffMs: this.settings.health.maxBackoffMs }),
    },
  );

  configure(env: Env, log?: Logger): void {
    this.settings = hostingSettingsFromEnv(env);
    this.log = log;
  }
  /** For tests. */
  configureSettings(s: Partial<HostingSettings>): void {
    this.settings = { ...this.settings, ...s };
  }
  getSettings(): HostingSettings {
    return this.settings;
  }

  private assertUsable(t: TenantDbSource, o: ResolveOptions): NonNullable<TenantDbSource['database']> {
    if (!o.allowInactive && t.status !== 'ACTIVE') throw new HostingError('TENANT_DB_NOT_READY', 'Tenant is unavailable');
    // Fail closed: a record loaded without its hosting configuration must never be guessed to be "managed".
    if (!t.database?.hostingMode)
      throw new HostingError('TENANT_DB_NOT_READY', 'The company database configuration was not loaded.');
    if (!o.allowNotReady && t.database.status && t.database.status !== 'READY')
      throw new HostingError('TENANT_DB_NOT_READY', 'The company database is not ready yet or has been suspended.');
    return t.database;
  }

  /** The scope for one company: pass it to runInTenantScope. `release` must be called when `lease` was requested. */
  async resolve(
    t: TenantDbSource,
    o: ResolveOptions = {},
    lease = false,
  ): Promise<{ scope: TenantDbScope; release: () => void }> {
    const db = this.assertUsable(t, o);
    if (db.hostingMode === 'MANAGED') return { scope: this.managed.scope(t), release: () => undefined };
    if (db.hostingMode === 'CUSTOMER_OWNED') {
      const { conn, release } = await this.customer.acquire(t, lease);
      return { scope: { connection: conn }, release };
    }
    throw new HostingError('TENANT_DB_NOT_READY', 'Unsupported database hosting mode');
  }

  /** Scope for the request middleware. Throws a 503 HostingError when the company database is unavailable. */
  async scopeFor(t: TenantDbSource, o: ResolveOptions = {}): Promise<TenantDbScope> {
    return (await this.resolve(t, o)).scope;
  }

  private async load(tenantId: Types.ObjectId | string): Promise<TenantDbSource | null> {
    return (await Tenant.findById(tenantId).select(TENANT_DB_FIELDS).lean()) as TenantDbSource | null;
  }

  async getTenantDatabase(tenantId: string): Promise<Connection> {
    const t = await this.load(tenantId);
    if (!t || t.status !== 'ACTIVE') throw new Error('Tenant is unavailable');
    const db = this.assertUsable(t, {});
    if (db.hostingMode === 'MANAGED') return this.managed.getDatabase(t);
    return (await this.customer.acquire(t)).conn;
  }

  /** Runs `fn` against one already-loaded company's database (holds a lease so idle-closing cannot interrupt it). */
  async runInTenantDoc<T>(t: TenantDbSource, fn: () => Promise<T>, o: ResolveOptions = {}): Promise<T> {
    const { scope, release } = await this.resolve(t, o, true);
    try {
      return await runInTenantScope(scope, fn);
    } finally {
      release();
    }
  }

  /** Runs `fn` against the company with this id (activation, platform tooling; not limited to ACTIVE companies). */
  async runInTenant<T>(tenantId: Types.ObjectId | string, fn: () => Promise<T>, o: ResolveOptions = { allowInactive: true }): Promise<T> {
    const t = await this.load(tenantId);
    if (!t) throw new HostingError('TENANT_DB_NOT_READY', 'Tenant not found');
    return this.runInTenantDoc(t, fn, o);
  }

  /**
   * Runs `fn` once per company, each against that company's own database (managed or customer-owned). A company whose
   * database is unreachable is reported in `failed` and never stops the others. `filter`/`select` narrow the
   * companies; the database-routing fields are always loaded.
   */
  async forEachTenant<T, D extends TenantDbSource = TenantDbSource & Record<string, unknown>>(
    fn: (tenant: D) => Promise<T>,
    opts: { filter?: Record<string, unknown>; select?: string; options?: ResolveOptions; limit?: number } = {},
  ): Promise<{ results: { tenantId: string; value: T }[]; failed: { tenantId: string; code: string }[] }> {
    const tenants = (await Tenant.find(opts.filter ?? { status: { $in: ['ACTIVE', 'SUSPENDED'] } })
      .select(`${TENANT_DB_FIELDS} ${opts.select ?? ''}`)
      .limit(opts.limit ?? 0)
      .lean()) as unknown as D[];
    const results: { tenantId: string; value: T }[] = [];
    const failed: { tenantId: string; code: string }[] = [];
    for (const t of tenants) {
      try {
        results.push({ tenantId: idOf(t), value: await this.runInTenantDoc(t, () => fn(t), opts.options ?? { allowInactive: true }) });
      } catch (e) {
        failed.push({ tenantId: idOf(t), code: e instanceof HostingError ? e.hostingCode : 'JOB_ERROR' });
        this.log?.error({ tenantId: idOf(t), code: e instanceof HostingError ? e.hostingCode : undefined }, 'tenant task failed');
      }
    }
    return { results, failed };
  }

  async verifyConnection(tenantId: string): Promise<boolean> {
    const t = await this.load(tenantId);
    if (!t?.database) return false;
    if (t.database.hostingMode === 'MANAGED') return this.managed.ping();
    try {
      const { conn, release } = await this.customer.acquire(t, true);
      try {
        await Promise.race([
          conn.db!.command({ ping: 1 }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('ping timeout')), 5_000).unref()),
        ]);
        return true;
      } finally {
        release();
      }
    } catch {
      return false;
    }
  }

  /** A connection to one company's database with a lease (call `release`), for jobs that need the Connection itself. */
  async lease(t: TenantDbSource, o: ResolveOptions = { allowInactive: true }): Promise<{ conn: Connection; release: () => void }> {
    const db = this.assertUsable(t, o);
    if (db.hostingMode === 'MANAGED') return { conn: this.managed.getDatabase(t), release: () => undefined };
    return this.customer.acquire(t, true);
  }

  /**
   * One health probe of a customer-owned database, used by the health job. A failed OPEN is already recorded by the
   * provider; a failed ping on an open connection is recorded here. Healthy results are recorded here too.
   */
  async checkCustomerHealth(t: TenantDbSource): Promise<boolean> {
    let leased: { conn: Connection; release: () => void };
    try {
      leased = await this.customer.acquire(t, true);
    } catch {
      return false; // recorded by the provider hook
    }
    try {
      await Promise.race([
        leased.conn.db!.command({ ping: 1 }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('ping timeout')), 5_000).unref()),
      ]);
      await recordConnectionResult(t._id, { ok: true }, { recheckMs: this.settings.health.minIntervalMs });
      return true;
    } catch {
      await recordConnectionResult(
        t._id,
        { ok: false, error: new HostingError('TENANT_DB_UNAVAILABLE', "Your company's database did not answer the health check.") },
        { maxBackoffMs: this.settings.health.maxBackoffMs },
      );
      return false;
    } finally {
      leased.release();
    }
  }

  async closeTenantConnection(tenantId: string): Promise<void> {
    await this.customer.close(tenantId);
  }

  async closeAll(): Promise<void> {
    await this.customer.closeAll();
  }
}

export const tenantDatabaseManager = new TenantDatabaseManager();
