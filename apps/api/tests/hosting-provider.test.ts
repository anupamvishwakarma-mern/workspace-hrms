import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HostingError } from '../src/database/hosting/errors';
import { CustomerMongoProvider } from '../src/database/hosting/providers/customer';
import { encryptConnectionString, parseKeyRing } from '../src/database/hosting/secrets';
import { DEFAULT_SETTINGS, type HostingSettings } from '../src/database/hosting/settings';
import type { TenantDbSource } from '../src/database/hosting/source';
import { Tenant } from '../src/database/models/tenant.model';
import * as verify from '../src/database/hosting/verify';

/** Connection-lifecycle tests with a fake driver: no MongoDB needed. */
const ring = parseKeyRing(`v1:${'c'.repeat(64)}`);
const settings: HostingSettings = {
  ...DEFAULT_SETTINGS,
  customerOwnedEnabled: true,
  keyRing: ring,
  allowPrivateHosts: true,
  requireCredentials: false,
  idleCloseMs: 1000,
  maxCustomerConnections: 2,
  openBackoff: { baseMs: 60_000, maxMs: 60_000 },
};

interface FakeConn {
  name: string;
  closed: boolean;
  on(ev: string, fn: () => void): FakeConn;
  close(): Promise<void>;
}
let opened: { uri: string; db: string; conn: FakeConn }[] = [];
let failOpen: Error | undefined;
const secretsByTenant = new Map<string, string>();

function makeTenant(uri: string, stamp = 1): TenantDbSource {
  const id = new Types.ObjectId();
  secretsByTenant.set(String(id), encryptConnectionString(ring, String(id), uri).encryptedConnectionString);
  return {
    _id: id,
    status: 'ACTIVE',
    database: { hostingMode: 'CUSTOMER_OWNED', status: 'READY', databaseName: 'hrms', connectionConfig: { updatedAt: new Date(stamp) } },
  };
}

beforeEach(() => {
  opened = [];
  failOpen = undefined;
  vi.restoreAllMocks();
  vi.spyOn(Tenant, 'findById').mockImplementation(((id: string) => ({
    select: () => ({
      lean: async () => ({
        _id: id,
        database: {
          databaseName: 'hrms',
          connectionConfig: { encryptedConnectionString: secretsByTenant.get(String(id)), encryptionKeyVersion: 'v1' },
        },
      }),
    }),
  })) as never);
  vi.spyOn(verify, 'openCustomerConnection').mockImplementation((async (_s: unknown, uri: string, db: string) => {
    if (failOpen) throw failOpen;
    const handlers: Record<string, (() => void)[]> = {};
    const conn: FakeConn = {
      name: db,
      closed: false,
      on(ev, fn) {
        (handlers[ev] ??= []).push(fn);
        return conn;
      },
      async close() {
        conn.closed = true;
        handlers.close?.forEach((f) => f());
      },
    };
    opened.push({ uri, db, conn });
    return conn;
  }) as never);
});

const provider = (hooks = {}) => new CustomerMongoProvider(() => settings, () => undefined, hooks);

describe('CustomerMongoProvider', () => {
  it('opens one connection per tenant and reuses it, even for simultaneous requests', async () => {
    const p = provider();
    const t = makeTenant('mongodb://u:p@db1.example.com/hrms');
    const [a, b, c] = await Promise.all([p.acquire(t), p.acquire(t), p.acquire(t)]);
    expect(opened).toHaveLength(1);
    expect(a.conn).toBe(b.conn);
    expect(b.conn).toBe(c.conn);
    expect((await p.acquire(t)).conn).toBe(a.conn);
    expect(opened).toHaveLength(1);
  });

  it('keys the cache by tenant: a tenant can never be handed another tenant\'s connection', async () => {
    const p = provider();
    const a = makeTenant('mongodb://u:p@a.example.com/hrms');
    const b = makeTenant('mongodb://u:p@b.example.com/hrms');
    const ca = (await p.acquire(a)).conn;
    const cb = (await p.acquire(b)).conn;
    expect(ca).not.toBe(cb);
    expect(opened.map((o) => o.uri)).toEqual(['mongodb://u:p@a.example.com/hrms', 'mongodb://u:p@b.example.com/hrms']);
    expect((await p.acquire(a)).conn).toBe(ca);
    expect((await p.acquire(b)).conn).toBe(cb);
  });

  it('decrypts with the tenant id as context: a ciphertext moved to another tenant fails closed', async () => {
    const p = provider();
    const a = makeTenant('mongodb://u:p@a.example.com/hrms');
    const b = makeTenant('mongodb://u:p@b.example.com/hrms');
    secretsByTenant.set(String(b._id), secretsByTenant.get(String(a._id))!); // attacker copies A's secret onto B
    await expect(p.acquire(b)).rejects.toMatchObject({ hostingCode: 'TENANT_DB_UNAVAILABLE' });
    expect(opened).toHaveLength(0);
  });

  it('fails fast with a back-off after an open fails, without leaking details, then recovers', async () => {
    const failures: string[] = [];
    const p = provider({ onOpenFailed: (_id: string, e: HostingError) => failures.push(e.hostingCode) });
    const t = makeTenant('mongodb://u:topsecret@down.example.com/hrms');
    failOpen = new HostingError('CONNECTION_TIMEOUT', 'timed out reaching mongodb://u:topsecret@down.example.com');
    const first = await p.acquire(t).catch((e: HostingError) => e);
    expect(first).toMatchObject({ hostingCode: 'TENANT_DB_UNAVAILABLE', statusCode: 503 });
    expect(JSON.stringify(first)).not.toContain('topsecret');
    expect((first as Error).message).not.toContain('topsecret');
    expect(failures).toEqual(['CONNECTION_TIMEOUT']);
    // within the back-off window nothing is attempted
    failOpen = undefined;
    await expect(p.acquire(t)).rejects.toMatchObject({ hostingCode: 'TENANT_DB_UNAVAILABLE' });
    expect(opened).toHaveLength(0);
    // an administrator re-check clears the back-off
    p.resetFailures(String(t._id));
    expect((await p.acquire(t)).conn).toBeTruthy();
    expect(opened).toHaveLength(1);
  });

  it('re-opens when the credentials were replaced (changed timestamp), closing the old connection', async () => {
    const p = provider();
    const t = makeTenant('mongodb://u:p@a.example.com/hrms', 1);
    const old = (await p.acquire(t)).conn as unknown as FakeConn;
    const replaced: TenantDbSource = { ...t, database: { ...t.database!, connectionConfig: { updatedAt: new Date(2) } } };
    const fresh = (await p.acquire(replaced)).conn;
    expect(old.closed).toBe(true);
    expect(fresh).not.toBe(old);
    expect(opened).toHaveLength(2);
  });

  it('closes idle connections but never one that is leased', async () => {
    const p = provider();
    const idle = makeTenant('mongodb://u:p@a.example.com/hrms');
    const busy = makeTenant('mongodb://u:p@b.example.com/hrms');
    await p.acquire(idle);
    const lease = await p.acquire(busy, true);
    const closed = await p.sweepIdle(Date.now() + 5_000);
    expect(closed).toBe(1);
    expect(p.has(String(idle._id))).toBe(false);
    expect(p.has(String(busy._id))).toBe(true);
    lease.release();
    expect(await p.sweepIdle(Date.now() + 10_000)).toBe(1);
    expect(p.size).toBe(0);
  });

  it('caps the number of open customer connections by evicting the least recently used', async () => {
    const p = provider();
    const [a, b, c] = [makeTenant('mongodb://u:p@a.example.com/hrms'), makeTenant('mongodb://u:p@b.example.com/hrms'), makeTenant('mongodb://u:p@c.example.com/hrms')];
    await p.acquire(a);
    await new Promise((r) => setTimeout(r, 5));
    await p.acquire(b);
    await p.acquire(c);
    expect(p.size).toBe(2);
    expect(p.has(String(a._id))).toBe(false);
  });

  it('refuses when customer-owned hosting is not enabled', async () => {
    const p = new CustomerMongoProvider(() => ({ ...settings, keyRing: undefined }), () => undefined);
    await expect(p.acquire(makeTenant('mongodb://u:p@a.example.com/hrms'))).rejects.toMatchObject({ hostingCode: 'CUSTOMER_DB_DISABLED' });
  });

  it('closeAll closes everything', async () => {
    const p = provider();
    await p.acquire(makeTenant('mongodb://u:p@a.example.com/hrms'));
    await p.acquire(makeTenant('mongodb://u:p@b.example.com/hrms'));
    await p.closeAll();
    expect(p.size).toBe(0);
    expect(opened.every((o) => o.conn.closed)).toBe(true);
  });
});
