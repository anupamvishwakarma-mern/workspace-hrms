import type { Connection } from 'mongoose';
import type { Logger } from 'pino';
import { Tenant } from '../../models/tenant.model';
import { assertHostsAllowed, parseMongoUri, resolveDatabaseName } from '../connectionString';
import { classifyMongoError, HostingError, safeErrorMessage } from '../errors';
import { decryptConnectionString } from '../secrets';
import type { HostingSettings } from '../settings';
import type { TenantDbSource } from '../source';
import { openCustomerConnection } from '../verify';

interface Entry {
  conn: Connection;
  stamp: string;
  lastUsed: number;
  leases: number;
  closed: boolean;
}

export interface CustomerProviderHooks {
  onOpened?(tenantId: string): void;
  onOpenFailed?(tenantId: string, err: HostingError): void;
}

const stampOf = (t: TenantDbSource) => String(t.database?.connectionConfig?.updatedAt?.getTime?.() ?? 0);

/**
 * Connections to customers' own MongoDB clusters: one cached Connection per tenant (key = tenant id, so a cache hit
 * can never return another tenant's database), opened lazily, pooled by the driver, de-duplicated when many requests
 * arrive together, closed when idle, and re-opened when the stored credentials change. After a failed open the
 * tenant fails fast for a growing back-off period instead of making every request wait for a timeout and hammering
 * the customer's database.
 */
export class CustomerMongoProvider {
  private readonly entries = new Map<string, Entry>();
  private readonly opening = new Map<string, Promise<Entry>>();
  private readonly failures = new Map<string, { count: number; until: number }>();
  private sweeper?: NodeJS.Timeout;

  constructor(
    private readonly settings: () => HostingSettings,
    private readonly log: () => Logger | undefined,
    private readonly hooks: CustomerProviderHooks = {},
  ) {}

  get size(): number {
    return this.entries.size;
  }
  has(tenantId: string): boolean {
    return this.entries.has(tenantId);
  }

  /** The tenant's connection (opened on first use). Pass `lease: true` to protect it from idle-closing while in use. */
  async acquire(t: TenantDbSource, lease = false): Promise<{ conn: Connection; release: () => void }> {
    const id = String(t._id);
    let e = this.entries.get(id);
    if (e && (e.closed || e.stamp !== stampOf(t))) {
      await this.close(id); // credentials were replaced (maybe on another instance) or the connection died
      e = undefined;
    }
    e ??= await this.open(id, t);
    e.lastUsed = Date.now();
    if (lease) e.leases += 1;
    const entry = e;
    let released = false;
    return {
      conn: entry.conn,
      release: () => {
        if (lease && !released) {
          released = true;
          entry.leases = Math.max(0, entry.leases - 1);
          entry.lastUsed = Date.now();
        }
      },
    };
  }

  private unavailable(id: string, retryInMs: number): HostingError {
    return new HostingError(
      'TENANT_DB_UNAVAILABLE',
      "Your company's database is currently unreachable. Your data is untouched and the connection is retried automatically.",
      { retryAfterSeconds: Math.ceil(retryInMs / 1000), tenantId: id },
    );
  }

  private open(id: string, t: TenantDbSource): Promise<Entry> {
    const pending = this.opening.get(id);
    if (pending) return pending;
    const f = this.failures.get(id);
    if (f && f.until > Date.now()) return Promise.reject(this.unavailable(id, f.until - Date.now()));
    const p = this.doOpen(id, t).finally(() => this.opening.delete(id));
    this.opening.set(id, p);
    return p;
  }

  private async doOpen(id: string, t: TenantDbSource): Promise<Entry> {
    const s = this.settings();
    try {
      if (!s.keyRing) throw new HostingError('CUSTOMER_DB_DISABLED', 'Customer-owned databases are not enabled on this platform.');
      // Secrets are not selected by default: load them only now, for this one tenant.
      const doc = await Tenant.findById(id)
        .select('database.databaseName +database.connectionConfig.encryptedConnectionString +database.connectionConfig.encryptionKeyVersion')
        .lean();
      const cfg = doc?.database?.connectionConfig;
      if (!doc || !cfg?.encryptedConnectionString || !doc.database?.databaseName)
        throw new HostingError('TENANT_DB_NOT_READY', 'This company has no database connection configured.');
      const uri = decryptConnectionString(s.keyRing, id, {
        encryptedConnectionString: cfg.encryptedConnectionString,
        encryptionKeyVersion: cfg.encryptionKeyVersion,
      });
      const parsed = parseMongoUri(uri);
      const databaseName = resolveDatabaseName(parsed, doc.database.databaseName);
      await assertHostsAllowed(parsed, s); // re-checked at connect time: DNS may have changed since it was saved
      if (this.entries.size >= s.maxCustomerConnections) await this.evictOne();
      if (this.entries.size >= s.maxCustomerConnections)
        throw new HostingError('TENANT_DB_UNAVAILABLE', 'The service is at its connection capacity. Please retry shortly.');
      const conn = await openCustomerConnection(s, uri, databaseName, parsed);
      const entry: Entry = { conn, stamp: stampOf(t), lastUsed: Date.now(), leases: 0, closed: false };
      conn.on('close', () => {
        entry.closed = true;
        if (this.entries.get(id) === entry) this.entries.delete(id);
      });
      conn.on('disconnected', () => this.log()?.warn({ tenantId: id }, 'customer database disconnected'));
      conn.on('reconnected', () => this.log()?.info({ tenantId: id }, 'customer database reconnected'));
      this.entries.set(id, entry);
      this.failures.delete(id);
      this.startSweeper();
      this.hooks.onOpened?.(id);
      return entry;
    } catch (e) {
      const err = e instanceof HostingError ? e : classifyMongoError(e);
      const prev = this.failures.get(id)?.count ?? 0;
      const delay = Math.min(s.openBackoff.baseMs * 2 ** prev, s.openBackoff.maxMs);
      this.failures.set(id, { count: prev + 1, until: Date.now() + delay });
      this.log()?.warn({ tenantId: id, code: err.hostingCode, err: safeErrorMessage(e) }, 'customer database connection failed');
      this.hooks.onOpenFailed?.(id, err);
      if (err.hostingCode === 'CUSTOMER_DB_DISABLED' || err.hostingCode === 'TENANT_DB_NOT_READY') throw err;
      throw this.unavailable(id, delay);
    }
  }

  /** Forget a tenant's back-off (after credentials were replaced or an administrator asked for a re-check). */
  resetFailures(tenantId: string): void {
    this.failures.delete(tenantId);
  }

  async close(tenantId: string): Promise<void> {
    const e = this.entries.get(tenantId);
    this.entries.delete(tenantId);
    if (e) {
      e.closed = true;
      await e.conn.close().catch(() => undefined);
    }
  }

  async closeAll(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = undefined;
    await Promise.all([...this.entries.keys()].map((id) => this.close(id)));
    this.failures.clear();
  }

  /** Closes the least recently used connection that nobody is using. */
  private async evictOne(): Promise<void> {
    let oldest: [string, Entry] | undefined;
    for (const kv of this.entries) if (kv[1].leases === 0 && (!oldest || kv[1].lastUsed < oldest[1].lastUsed)) oldest = kv;
    if (oldest) await this.close(oldest[0]);
  }

  /** Closes connections nobody has used for the idle period. Exposed for tests. */
  async sweepIdle(now = Date.now()): Promise<number> {
    const idleMs = this.settings().idleCloseMs;
    const stale = [...this.entries].filter(([, e]) => e.leases === 0 && now - e.lastUsed > idleMs).map(([id]) => id);
    await Promise.all(stale.map((id) => this.close(id)));
    return stale.length;
  }

  private startSweeper(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => void this.sweepIdle(), 60_000);
    this.sweeper.unref();
  }
}
