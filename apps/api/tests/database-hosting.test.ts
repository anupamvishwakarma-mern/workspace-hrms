import type { Express } from 'express';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenantDatabaseManager } from '../src/database/hosting/manager';
import { migrateTenantDatabase } from '../src/database/hosting/migrations';
import { decryptConnectionString, parseKeyRing } from '../src/database/hosting/secrets';
import { AttendanceEvent } from '../src/database/models/attendanceEvent.model';
import { Employee } from '../src/database/models/employee.model';
import { Membership } from '../src/database/models/membership.model';
import { Tenant } from '../src/database/models/tenant.model';
import { TenantDbEvent } from '../src/database/models/tenantDbEvent.model';
import { User } from '../src/database/models/user.model';
import { runInTenantDb } from '../src/database/tenantContext';
import { purgeLocationData } from '../src/jobs/handlers';
import { runPendingTenantMigrations, runTenantDbHealthChecks } from '../src/jobs/tenantDatabase';
import { bearer, createTenant, latestEmailToken, loginAs, PASSWORD, startTestApp, stopTestApp, testPasswordHash } from './helpers';

/**
 * Both hosting modes end to end. The "customer cluster" is the same throwaway replica set the other tests use,
 * addressed through separate databases and the customer-owned code path (own connection, encrypted secret, SSRF
 * policy relaxed for localhost only in this test environment).
 */
const KEY_V1 = '1'.repeat(64);
const KEY_V2 = '2'.repeat(64);
const PASS = 'Owner-Pass-12345';
let app: Express;
let root = '';
const api = (path: string) => `/api/v1${path}`;

const cluster = () => {
  const raw = process.env.TEST_MONGODB_URI!;
  return { hostport: /mongodb:\/\/([^/]+)\//.exec(raw)![1]!, rs: /replicaSet=([^&]+)/.exec(raw)?.[1] };
};
const uri = (db: string, creds = '') => {
  const { hostport, rs } = cluster();
  return `mongodb://${creds}${hostport}/${db}${rs ? `?replicaSet=${rs}` : ''}`;
};
const customer = (db: string) => ({ hostingMode: 'CUSTOMER_OWNED', connectionString: uri(db) });
const signup = (name: string, email: string, database?: Record<string, unknown>) =>
  request(app)
    .post(api('/signup'))
    .send({ name, maxEmployees: 5, timezone: 'Asia/Kolkata', owner: { email, firstName: 'Own', lastName: 'Er' }, ...(database ? { database } : {}) });
async function activate(email: string): Promise<string> {
  const token = await latestEmailToken(email, 'ACTIVATION');
  expect((await request(app).post(api('/auth/activate')).send({ token, password: PASS })).status).toBe(200);
  return loginAs(app, email, PASS);
}
const secretOf = async (id: unknown) =>
  (await Tenant.findById(id).select('+database.connectionConfig.encryptedConnectionString +database.connectionConfig.encryptionKeyVersion +database.connectionConfig.fingerprint').lean())!;
const vitestWait = async (fn: () => Promise<boolean>, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};
const withSettings = async (patch: Parameters<typeof tenantDatabaseManager.configureSettings>[0], fn: () => Promise<void>) => {
  const before = { ...tenantDatabaseManager.getSettings() };
  tenantDatabaseManager.configureSettings(patch);
  try {
    await fn();
  } finally {
    tenantDatabaseManager.configureSettings(before);
  }
};

let mgdId: Types.ObjectId;
let acmeId: Types.ObjectId;
let betaId: Types.ObjectId;
let mgdOwner = '';
let acmeOwner = '';
let betaOwner = '';

beforeAll(async () => {
  ({ app } = await startTestApp({
    RATE_LIMIT_SIGNUP_MAX: '10000',
    RATE_LIMIT_DB_TEST_MAX: '10000',
    TENANT_DB_ENCRYPTION_KEYS: `v1:${KEY_V1}`,
    CUSTOMER_DB_ALLOW_PRIVATE_HOSTS: 'true', // localhost is the only "customer cluster" a test can have
    CUSTOMER_DB_REQUIRE_TLS: 'false',
    CUSTOMER_DB_CONNECT_TIMEOUT_MS: '2000',
  }));
  for (const db of ['acme_hrms', 'beta_hrms', 'junk_hrms', 'other_hrms', 'MGD_CO_HRM'])
    await mongoose.connection.useDb(db).dropDatabase();
  await User.create({ email: 'root@hosting.test', passwordHash: await testPasswordHash(), status: 'ACTIVE', isPlatformAdmin: true });
  root = await loginAs(app, 'root@hosting.test');
});
afterAll(async () => {
  await stopTestApp();
});

describe('HRMS-managed database (existing behaviour preserved)', () => {
  it('is the default and keeps the data in the company database on our cluster', async () => {
    const res = await signup('Mgd Co', 'owner@mgd.test');
    expect(res.status).toBe(201);
    expect(res.body.data.company.hostingMode).toBe('MANAGED');
    const t = (await Tenant.findOne({ slug: 'mgd-co' }).lean())!;
    mgdId = t._id;
    expect(t.dbName).toBe('MGD_CO_HRM');
    expect(t.database).toMatchObject({ hostingMode: 'MANAGED', provider: 'MONGODB', status: 'READY', databaseName: 'MGD_CO_HRM', clusterId: 'primary', schemaVersion: 1 });
    // no per-tenant connection string for managed tenants
    expect((await secretOf(mgdId)).database?.connectionConfig?.encryptedConnectionString).toBeUndefined();
    expect(await runInTenantDb('MGD_CO_HRM', () => Employee.countDocuments({ tenantId: mgdId }))).toBe(1);
    expect(await Employee.countDocuments({ tenantId: mgdId })).toBe(0);
    mgdOwner = await activate('owner@mgd.test');
  });

  it('serves requests and reuses the shared cluster connection', async () => {
    expect((await request(app).get(api('/tenants/current')).set(bearer(mgdOwner))).status).toBe(200);
    const a = await tenantDatabaseManager.getTenantDatabase(String(mgdId));
    const b = await tenantDatabaseManager.getTenantDatabase(String(mgdId));
    expect(a).toBe(b);
    expect(a.name).toBe('MGD_CO_HRM');
    expect(tenantDatabaseManager.customer.size).toBe(0); // no customer connection exists for managed tenants
  });

  it('shows the managed settings without exposing the physical database name', async () => {
    const r = await request(app).get(api('/tenants/current/database')).set(bearer(mgdOwner));
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ hostingMode: 'MANAGED', health: 'HEALTHY', canChangeConnection: false, canSwitchHostingMode: false });
    expect(r.body.data.databaseName).toBeUndefined();
    expect(r.body.data.managed.backupPolicy).toBeTruthy();
  });

  it('legacy companies without a database block are refused rather than guessed, and backfilled at start-up', async () => {
    const legacy = await Tenant.create({ name: 'Legacy', slug: 'legacy-co' });
    await Tenant.collection.updateOne({ _id: legacy._id }, { $unset: { database: '' } });
    const raw = (await Tenant.findById(legacy._id).select('status dbName database').lean())!;
    expect(raw.database).toBeUndefined();
    await expect(tenantDatabaseManager.scopeFor({ ...raw, status: 'ACTIVE' })).rejects.toMatchObject({ hostingCode: 'TENANT_DB_NOT_READY' });
    const { backfillTenantDatabaseConfig } = await import('../src/database/connection');
    expect(await backfillTenantDatabaseConfig('primary')).toBeGreaterThanOrEqual(1);
    expect((await Tenant.findById(legacy._id).lean())!.database).toMatchObject({ hostingMode: 'MANAGED', status: 'READY' });
  });
});

describe('customer-owned MongoDB: verification', () => {
  const test = (body: Record<string, unknown>) => request(app).post(api('/signup/database/test')).send(body);

  it('accepts a valid empty database, reports the checks, and leaves nothing behind', async () => {
    const r = await test({ connectionString: uri('acme_hrms') });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ ok: true, databaseName: 'acme_hrms' });
    expect(r.body.data.checks.map((c: { name: string }) => c.name)).toEqual(expect.arrayContaining(['connection', 'authentication', 'version', 'topology', 'permissions', 'emptiness']));
    const names = (await mongoose.connection.useDb('acme_hrms').db!.listCollections().toArray()).map((c) => c.name);
    expect(names.some((n) => n.startsWith('__hrms_probe'))).toBe(false);
  });

  it('takes the database name from the form when the string has none', async () => {
    const { hostport, rs } = cluster();
    const noDb = `mongodb://${hostport}/${rs ? `?replicaSet=${rs}` : ''}`;
    expect((await test({ connectionString: noDb, databaseName: 'acme_hrms' })).body.data.databaseName).toBe('acme_hrms');
    const r = await test({ connectionString: noDb });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('INVALID_DATABASE_NAME');
  });

  it.each([
    ['an unsupported scheme', { connectionString: 'http://example.com/x' }, 'UNSUPPORTED_SCHEME'],
    ['a file-reading option', { connectionString: `${uri('acme_hrms')}&tlsCAFile=/etc/passwd` }, 'UNSUPPORTED_OPTION'],
    ['a reserved database', { connectionString: uri('admin') }, 'INVALID_DATABASE_NAME'],
    ['bad credentials', { connectionString: uri('acme_hrms', 'bob:Sup3rS3cretPw@') }, 'AUTH_FAILED'],
  ])('rejects %s with a clear code and never echoes the secret', async (_n, body, code) => {
    const r = await test(body);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe(code);
    expect(JSON.stringify(r.body)).not.toContain('Sup3rS3cretPw');
  });

  it('reports an unreachable host (refused or timed out)', async () => {
    const r = await test({ connectionString: 'mongodb://127.0.0.1:1/acme_hrms' });
    expect(r.status).toBe(422);
    expect(['NETWORK_UNREACHABLE', 'CONNECTION_TIMEOUT']).toContain(r.body.error.code);
  });

  it('blocks private, loopback and metadata hosts when SSRF protection is on', async () => {
    await withSettings({ allowPrivateHosts: false, requireCredentials: true }, async () => {
      for (const host of ['127.0.0.1:27017', '169.254.169.254:27017', '10.0.0.5:27017', 'localhost:27017']) {
        const r = await test({ connectionString: `mongodb://u:p@${host}/acme_hrms` });
        expect(r.status, host).toBe(422);
        expect(r.body.error.code, host).toBe('HOST_NOT_ALLOWED');
      }
      expect((await test({ connectionString: uri('acme_hrms') })).body.error.code).toBe('INVALID_CONNECTION_STRING'); // credentials are mandatory
    });
  });

  it('rejects an unsupported MongoDB version', async () => {
    await withSettings({ minMongoVersion: '99.0' }, async () => {
      const r = await test({ connectionString: uri('acme_hrms') });
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('UNSUPPORTED_VERSION');
    });
  });

  it('rejects a standalone server (no transactions)', async () => {
    const standalone = await MongoMemoryServer.create();
    try {
      const r = await test({ connectionString: `${standalone.getUri('standalone_db').split('?')[0]}` });
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('UNSUPPORTED_TOPOLOGY');
    } finally {
      await standalone.stop();
    }
  });

  it('refuses a database that already holds data, and does not touch it', async () => {
    await mongoose.connection.useDb('junk_hrms').collection('employees').insertOne({ keep: 'me' });
    const r = await test({ connectionString: uri('junk_hrms') });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('DATABASE_NOT_EMPTY');
    expect(await mongoose.connection.useDb('junk_hrms').collection('employees').countDocuments()).toBe(1);
    const signupAttempt = await signup('Junk Co', 'owner@junk.test', customer('junk_hrms'));
    expect(signupAttempt.status).toBe(409);
    expect(await Tenant.exists({ slug: 'junk-co' })).toBeNull();
    expect(await User.exists({ email: 'owner@junk.test' })).toBeNull();
  });
});

describe('customer-owned MongoDB: onboarding and routing', () => {
  it('provisions the schema and default data in the customer database, encrypted secret in the control plane', async () => {
    const res = await signup('Acme Co', 'owner@acme.test', customer('acme_hrms'));
    expect(res.status).toBe(201);
    expect(res.body.data.company).toMatchObject({ slug: 'acme-co', hostingMode: 'CUSTOMER_OWNED' });
    expect(JSON.stringify(res.body)).not.toMatch(/127\.0\.0\.1|replicaSet|mongodb:\/\//);

    const t = (await Tenant.findOne({ slug: 'acme-co' }).lean())!;
    acmeId = t._id;
    expect(t.status).toBe('ACTIVE');
    expect(t.dbName).toBeUndefined();
    expect(t.database).toMatchObject({ hostingMode: 'CUSTOMER_OWNED', status: 'READY', health: 'HEALTHY', databaseName: 'acme_hrms', schemaVersion: 1 });

    // encrypted at rest: no host, no scheme, decryptable only with the key and this tenant
    const s = await secretOf(acmeId);
    const enc = s.database!.connectionConfig!;
    expect(enc.encryptedConnectionString).not.toMatch(/127\.0\.0\.1|mongodb/);
    expect(enc.encryptionKeyVersion).toBe('v1');
    expect(enc.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(decryptConnectionString(parseKeyRing(`v1:${KEY_V1}`), String(acmeId), { encryptedConnectionString: enc.encryptedConnectionString!, encryptionKeyVersion: 'v1' })).toBe(uri('acme_hrms'));
    const rawDoc = JSON.stringify(await Tenant.collection.findOne({ _id: acmeId }));
    expect(rawDoc).not.toMatch(/127\.0\.0\.1|mongodb:\/\//);

    // data lives in the customer's database only
    expect(await tenantDatabaseManager.runInTenant(acmeId, () => Employee.countDocuments({ tenantId: acmeId }))).toBe(1);
    expect(await Employee.countDocuments({ tenantId: acmeId })).toBe(0); // not in the shared database
    expect(await runInTenantDb('ACME_CO_HRM', () => Employee.countDocuments({ tenantId: acmeId }))).toBe(0); // not in a managed one
    const binding = await mongoose.connection.useDb('acme_hrms').collection('_hrms_meta').findOne({ _id: 'binding' as never });
    expect(binding?.tenantId).toBe(String(acmeId));
    acmeOwner = await activate('owner@acme.test');
  });

  it('serves the whole API from the customer database, using one reused connection', async () => {
    expect((await request(app).get(api('/tenants/current')).set(bearer(acmeOwner))).status).toBe(200);
    const made = await request(app).post(api('/departments')).set(bearer(acmeOwner)).send({ name: 'Acme Secret Dept' });
    expect(made.status).toBe(201);
    expect(await mongoose.connection.useDb('acme_hrms').collection('departments').countDocuments({ name: 'Acme Secret Dept' })).toBe(1);
    expect(await mongoose.connection.useDb('workforce_test').collection('departments').countDocuments({ name: 'Acme Secret Dept' })).toBe(0);
    for (let i = 0; i < 5; i++) await request(app).get(api('/departments')).set(bearer(acmeOwner));
    expect(tenantDatabaseManager.customer.size).toBe(1);
    const a = await tenantDatabaseManager.getTenantDatabase(String(acmeId));
    expect(await tenantDatabaseManager.getTenantDatabase(String(acmeId))).toBe(a);
    expect(a.name).toBe('acme_hrms');
  });

  it('refuses to attach a database that is already in use by a company', async () => {
    const r = await signup('Acme Two', 'owner@acme2.test', customer('acme_hrms'));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('DATABASE_IN_USE');
    expect(await Tenant.exists({ slug: 'acme-two' })).toBeNull();
    expect(await tenantDatabaseManager.runInTenant(acmeId, () => Employee.countDocuments({ tenantId: acmeId }))).toBe(1); // untouched
  });

  it('keeps companies apart: no data, membership or connection is shared', async () => {
    expect((await signup('Beta Co', 'owner@beta.test', customer('beta_hrms'))).status).toBe(201);
    betaId = (await Tenant.findOne({ slug: 'beta-co' }).lean())!._id;
    betaOwner = await activate('owner@beta.test');
    const list = await request(app).get(api('/departments')).set(bearer(betaOwner));
    expect(JSON.stringify(list.body)).not.toContain('Acme Secret Dept');
    // a tenant id supplied by the client is only a selector among the caller's own memberships
    expect((await request(app).get(api('/departments')).set(bearer(betaOwner)).set('X-Tenant-Id', String(acmeId))).status).toBe(403);
    expect((await request(app).get(api('/departments')).set(bearer(betaOwner)).set('X-Tenant-Id', String(mgdId ?? new Types.ObjectId()))).status).toBe(403);
    // the cache hands each tenant its own database
    const [a, b] = await Promise.all([tenantDatabaseManager.getTenantDatabase(String(acmeId)), tenantDatabaseManager.getTenantDatabase(String(betaId))]);
    expect(a).not.toBe(b);
    expect([a.name, b.name]).toEqual(['acme_hrms', 'beta_hrms']);
    expect(tenantDatabaseManager.customer.size).toBe(2);
    // employees of A are invisible from B even by id
    const aEmp = await tenantDatabaseManager.runInTenant(acmeId, () => Employee.findOne({ tenantId: acmeId }).lean());
    const cross = await request(app).get(api(`/employees/${aEmp!._id}`)).set(bearer(betaOwner));
    expect(cross.status).toBe(404);
    // and a model resolved inside B's scope can only ever see B's database
    expect(await tenantDatabaseManager.runInTenant(betaId, () => Employee.countDocuments({}))).toBe(1);
  });

  it('never exposes connection details through any API', async () => {
    const calls = [
      await request(app).get(api('/tenants/current')).set(bearer(acmeOwner)),
      await request(app).get(api('/tenants/current/database')).set(bearer(acmeOwner)),
      await request(app).get(api('/tenants/current/database/status')).set(bearer(acmeOwner)),
      await request(app).get(api('/tenants/current/database/events')).set(bearer(acmeOwner)),
      await request(app).get(api('/platform/tenants')).set(bearer(root)),
      await request(app).get(api('/platform/database/overview')).set(bearer(root)),
      await request(app).get(api('/auth/me')).set(bearer(acmeOwner)),
    ];
    for (const r of calls) {
      expect(r.status).toBe(200);
      expect(JSON.stringify(r.body)).not.toMatch(/127\.0\.0\.1|mongodb:\/\/|encrypted|fingerprint|replicaSet/i);
    }
    const s = (await request(app).get(api('/tenants/current/database')).set(bearer(acmeOwner))).body.data;
    expect(s).toMatchObject({ hostingMode: 'CUSTOMER_OWNED', databaseName: 'acme_hrms', status: 'READY', health: 'HEALTHY', schemaVersion: 1, canChangeConnection: true, canSwitchHostingMode: false });
    expect(s.responsibilities.you.length).toBeGreaterThan(0);
  });

  it('keeps database credentials away from ordinary administrators', async () => {
    const hr = await User.create({ email: 'hr@acme.test', passwordHash: await testPasswordHash(), status: 'ACTIVE' });
    await Membership.create({ tenantId: acmeId, userId: hr._id, roles: ['HR_ADMIN'] });
    const tok = await loginAs(app, 'hr@acme.test', PASSWORD);
    expect((await request(app).get(api('/tenants/current/database')).set(bearer(tok))).status).toBe(403);
    expect((await request(app).post(api('/tenants/current/database/test')).set(bearer(tok)).send({ connectionString: uri('acme_hrms') })).status).toBe(403);
    expect((await request(app).put(api('/tenants/current/database/connection')).set(bearer(tok)).send({ connectionString: uri('acme_hrms'), currentPassword: PASSWORD, confirm: true })).status).toBe(403);
    const status = await request(app).get(api('/tenants/current/database/status')).set(bearer(tok)); // service status is visible to HR
    expect(status.status).toBe(200);
    expect(status.body.data.health).toBe('HEALTHY');
  });
});

describe('customer-owned MongoDB: credential replacement', () => {
  const put = (token: string, body: Record<string, unknown>) => request(app).put(api('/tenants/current/database/connection')).set(bearer(token)).send(body);

  it('requires the owner password and explicit confirmation', async () => {
    const before = (await secretOf(acmeId)).database!.connectionConfig!.encryptedConnectionString;
    expect((await put(acmeOwner, { connectionString: uri('acme_hrms'), currentPassword: 'wrong-password-1', confirm: true })).status).toBe(403);
    expect((await put(acmeOwner, { connectionString: uri('acme_hrms'), currentPassword: PASS })).status).toBe(422);
    expect((await secretOf(acmeId)).database!.connectionConfig!.encryptedConnectionString).toBe(before);
    expect((await TenantDbEvent.find({ tenantId: acmeId, type: 'CONNECTION_REPLACE_REJECTED' }).lean()).length).toBeGreaterThanOrEqual(1);
  });

  it('refuses a different database: switching data is a migration, not a credential change', async () => {
    const r = await put(acmeOwner, { connectionString: uri('other_hrms'), currentPassword: PASS, confirm: true });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('DATABASE_MISMATCH');
    const beta = await put(acmeOwner, { connectionString: uri('beta_hrms'), currentPassword: PASS, confirm: true }); // another company's database
    expect(beta.status).toBe(409);
    expect((await Tenant.findById(acmeId).lean())!.database?.databaseName).toBe('acme_hrms');
  });

  it('replaces credentials for the same database: new ciphertext, old connection closed, service continues', async () => {
    const before = await secretOf(acmeId);
    const oldConn = await tenantDatabaseManager.getTenantDatabase(String(acmeId));
    const newUri = `${uri('acme_hrms')}${uri('acme_hrms').includes('?') ? '&' : '?'}appName=rotated`;
    const r = await put(acmeOwner, { connectionString: newUri, currentPassword: PASS, confirm: true });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toMatch(/rotated|127\.0\.0\.1|mongodb:\/\//);
    const after = await secretOf(acmeId);
    expect(after.database!.connectionConfig!.encryptedConnectionString).not.toBe(before.database!.connectionConfig!.encryptedConnectionString);
    expect(after.database!.connectionConfig!.fingerprint).toBe(before.database!.connectionConfig!.fingerprint);
    expect((await request(app).get(api('/departments')).set(bearer(acmeOwner))).status).toBe(200);
    const fresh = await tenantDatabaseManager.getTenantDatabase(String(acmeId));
    expect(fresh).not.toBe(oldConn);
    expect(JSON.stringify(await TenantDbEvent.find({ tenantId: acmeId, type: 'CONNECTION_REPLACED' }).lean())).not.toMatch(/127\.0\.0\.1|mongodb:\/\//);
  });

  it('tests candidate credentials without saving them', async () => {
    const before = (await secretOf(acmeId)).database!.connectionConfig!.encryptedConnectionString;
    const ok = await request(app).post(api('/tenants/current/database/test')).set(bearer(acmeOwner)).send({ connectionString: uri('acme_hrms') });
    expect(ok.status).toBe(200);
    const bad = await request(app).post(api('/tenants/current/database/test')).set(bearer(acmeOwner)).send({ connectionString: uri('other_hrms') });
    expect(bad.status).toBe(409);
    expect((await secretOf(acmeId)).database!.connectionConfig!.encryptedConnectionString).toBe(before);
  });

  it('managed companies have no connection to test or replace', async () => {
    expect((await request(app).put(api('/tenants/current/database/connection')).set(bearer(mgdOwner ?? '')).send({ connectionString: uri('acme_hrms'), currentPassword: PASS, confirm: true })).status).toBeGreaterThanOrEqual(400);
  });
});

describe('customer database outages', () => {
  it('fails closed with a clear 503, never falls back to another database, and recovers', async () => {
    const good = await secretOf(acmeId);
    const { encryptConnectionString } = await import('../src/database/hosting/secrets');
    const down = encryptConnectionString(parseKeyRing(`v1:${KEY_V1}`), String(acmeId), 'mongodb://127.0.0.1:1/acme_hrms');
    await Tenant.updateOne({ _id: acmeId }, { $set: { 'database.connectionConfig.encryptedConnectionString': down.encryptedConnectionString, 'database.connectionConfig.updatedAt': new Date() } });

    const t0 = Date.now();
    const r1 = await request(app).get(api('/departments')).set(bearer(acmeOwner));
    expect(r1.status).toBe(503);
    expect(r1.body.error.code).toBe('TENANT_DB_UNAVAILABLE');
    expect(JSON.stringify(r1.body)).not.toMatch(/127\.0\.0\.1|mongodb:\/\//);
    // back-off: the second request fails immediately instead of waiting for another timeout
    const t1 = Date.now();
    const r2 = await request(app).get(api('/departments')).set(bearer(acmeOwner));
    expect(r2.status).toBe(503);
    expect(Date.now() - t1).toBeLessThan(1000);
    expect(t1 - t0).toBeGreaterThanOrEqual(0);

    // other companies are unaffected; the shared database never received this company's data
    expect((await request(app).get(api('/departments')).set(bearer(betaOwner))).status).toBe(200);
    expect(await mongoose.connection.useDb('workforce_test').collection('departments').countDocuments({ tenantId: acmeId })).toBe(0);

    // the health state is recorded (separately from application errors) and shown to the owner
    expect(await vitestWait(async () => (await Tenant.findById(acmeId).lean())?.database?.health !== 'HEALTHY')).toBe(true);
    const t = (await Tenant.findById(acmeId).lean())!;
    expect(['DEGRADED', 'UNREACHABLE']).toContain(t.database?.health);
    expect(t.database?.lastError).toBeTruthy();
    expect(t.database?.lastError).not.toMatch(/127\.0\.0\.1|mongodb:\/\//);
    // the owner can still see the service status (and replace the connection) while the database is down
    const status = await request(app).get(api('/tenants/current/database/status')).set(bearer(acmeOwner));
    expect(status.status).toBe(200);
    expect(['DEGRADED', 'UNREACHABLE']).toContain(status.body.data.health);
    expect(status.body.data.message).toMatch(/database/i);
    // login still lists the company instead of an empty account
    const login = await request(app).post(api('/auth/login')).send({ email: 'owner@acme.test', password: PASS });
    expect(login.status).toBe(200);

    // restore the credentials: back-off cleared, service resumes, data intact
    await Tenant.updateOne({ _id: acmeId }, { $set: { 'database.connectionConfig.encryptedConnectionString': good.database!.connectionConfig!.encryptedConnectionString, 'database.connectionConfig.updatedAt': new Date() } });
    tenantDatabaseManager.customer.resetFailures(String(acmeId));
    expect((await request(app).get(api('/departments')).set(bearer(acmeOwner))).status).toBe(200);
    expect(JSON.stringify((await request(app).get(api('/departments')).set(bearer(acmeOwner))).body)).toContain('Acme Secret Dept');
  });
});

describe('background jobs and monitoring are tenant-aware', () => {
  const OLD = new Date(Date.now() - 400 * 86_400_000);
  const insertEvent = (tenantId: Types.ObjectId) =>
    tenantDatabaseManager.runInTenant(tenantId, () =>
      AttendanceEvent.collection.insertOne({ tenantId, employeeId: new Types.ObjectId(), eventType: 'CHECK_IN', occurredAt: OLD, receivedAt: OLD, workDate: '2025-01-01', location: { type: 'Point', coordinates: [77, 12] }, verification: { status: 'VERIFIED' }, idempotencyKey: `k-${tenantId}`, source: 'MOBILE' }),
    );
  const located = (tenantId: Types.ObjectId) => tenantDatabaseManager.runInTenant(tenantId, () => AttendanceEvent.collection.countDocuments({ tenantId, location: { $exists: true } }));

  it('runs retention against each company\'s own database (managed, customer-owned and legacy)', async () => {
    const legacy = await createTenant('jobs-legacy');
    mgdId = (await Tenant.findOne({ slug: 'mgd-co' }).lean())?._id ?? mgdId;
    await Promise.all([insertEvent(acmeId), insertEvent(betaId), insertEvent(legacy.tenantId), ...(mgdId ? [insertEvent(mgdId)] : [])]);
    expect(await located(acmeId)).toBe(1);
    const r = await purgeLocationData(new Date(), 90);
    expect(r.failed).toEqual([]);
    expect(r.events).toBeGreaterThanOrEqual(3);
    expect(await located(acmeId)).toBe(0);
    expect(await located(betaId)).toBe(0);
    expect(await located(legacy.tenantId)).toBe(0);
    expect(await mongoose.connection.useDb('acme_hrms').collection('attendanceevents').countDocuments({ locationPurgedAt: { $exists: true } })).toBe(1);
  });

  it('isolates one failing company: the others are still processed and the failure is reported', async () => {
    await tenantDatabaseManager.closeTenantConnection(String(betaId));
    const { encryptConnectionString } = await import('../src/database/hosting/secrets');
    const good = await secretOf(betaId);
    const down = encryptConnectionString(parseKeyRing(`v1:${KEY_V1}`), String(betaId), 'mongodb://127.0.0.1:1/beta_hrms');
    await Tenant.updateOne({ _id: betaId }, { $set: { 'database.connectionConfig.encryptedConnectionString': down.encryptedConnectionString, 'database.connectionConfig.updatedAt': new Date() } });
    await insertEvent(acmeId);
    const r = await purgeLocationData(new Date(), 90);
    expect(r.failed.map((f) => f.tenantId)).toContain(String(betaId));
    expect(r.failed.find((f) => f.tenantId === String(betaId))?.code).toBe('TENANT_DB_UNAVAILABLE');
    expect(await located(acmeId)).toBe(0);
    await Tenant.updateOne({ _id: betaId }, { $set: { 'database.connectionConfig.encryptedConnectionString': good.database!.connectionConfig!.encryptedConnectionString, 'database.connectionConfig.updatedAt': new Date() } });
    tenantDatabaseManager.customer.resetFailures(String(betaId));
  });

  it('health job probes customer databases (not managed ones) and records the result', async () => {
    await Tenant.updateOne({ _id: acmeId }, { $set: { 'database.health': 'UNKNOWN' }, $unset: { 'database.nextCheckAt': '' } });
    const r = await runTenantDbHealthChecks(new Date());
    expect(r.healthy).toBeGreaterThanOrEqual(1);
    const t = (await Tenant.findById(acmeId).lean())!;
    expect(t.database).toMatchObject({ health: 'HEALTHY', consecutiveFailures: 0 });
    expect(t.database?.lastSuccessfulConnection).toBeTruthy();
    expect(t.database?.nextCheckAt && t.database.nextCheckAt.getTime() > Date.now()).toBe(true); // not probed again straight away
    expect((await runTenantDbHealthChecks(new Date())).checked).toBe(0);
  });

  it('migrations are versioned, idempotent, locked and retryable', async () => {
    await Tenant.updateOne({ _id: acmeId }, { $set: { 'database.schemaVersion': 0 } });
    const run = await runPendingTenantMigrations(new Date());
    expect(run.migrated).toBeGreaterThanOrEqual(1);
    expect((await Tenant.findById(acmeId).lean())!.database).toMatchObject({ schemaVersion: 1, lastMigration: { status: 'SUCCEEDED', version: 1 } });
    const conn = await tenantDatabaseManager.getTenantDatabase(String(acmeId));
    expect((await migrateTenantDatabase(String(acmeId), conn)).status).toBe('UP_TO_DATE'); // idempotent
    // another worker holds the lock
    await Tenant.updateOne({ _id: acmeId }, { $set: { 'database.lastMigration.status': 'RUNNING', 'database.lastMigration.startedAt': new Date() } });
    expect((await migrateTenantDatabase(String(acmeId), conn)).status).toBe('SKIPPED_RUNNING');
    // a crashed worker's stale lock is taken over
    await Tenant.updateOne({ _id: acmeId }, { $set: { 'database.lastMigration.startedAt': new Date(Date.now() - 3_600_000), 'database.schemaVersion': 0 } });
    expect((await migrateTenantDatabase(String(acmeId), conn)).status).toBe('MIGRATED');
    expect(JSON.stringify(await TenantDbEvent.find({ tenantId: acmeId, type: 'MIGRATION_APPLIED' }).lean())).toContain('"version":1');
    // a database bound to another company is never migrated
    const other = await tenantDatabaseManager.getTenantDatabase(String(betaId));
    await Tenant.updateOne({ _id: acmeId }, { $set: { 'database.schemaVersion': 0, 'database.lastMigration.status': 'SUCCEEDED' } });
    const wrong = await migrateTenantDatabase(String(acmeId), other);
    expect(wrong.status).toBe('FAILED');
    expect(wrong.error).toMatch(/different company/);
    await Tenant.updateOne({ _id: acmeId }, { $set: { 'database.schemaVersion': 1, 'database.lastMigration.status': 'SUCCEEDED' } });
  });
});

describe('encryption key rotation', () => {
  it('re-encrypts secrets with the active key without interrupting service', async () => {
    const before = await tenantDatabaseManager.getTenantDatabase(String(acmeId));
    await withSettings({ keyRing: parseKeyRing(`v1:${KEY_V1},v2:${KEY_V2}`) }, async () => {
      const r = await request(app).post(api('/platform/database/rotate-keys')).set(bearer(root));
      expect(r.status).toBe(200);
      expect(r.body.data).toMatchObject({ activeKeyVersion: 'v2', failed: 0 });
      expect(r.body.data.rotated).toBeGreaterThanOrEqual(2);
      expect((await secretOf(acmeId)).database!.connectionConfig!.encryptionKeyVersion).toBe('v2');
      // the cached connection keeps working, and so does a cold one that must decrypt with the new key
      expect(await tenantDatabaseManager.getTenantDatabase(String(acmeId))).toBe(before);
      await tenantDatabaseManager.closeTenantConnection(String(acmeId));
      expect((await request(app).get(api('/departments')).set(bearer(acmeOwner))).status).toBe(200);
      // company users cannot rotate keys
      expect((await request(app).post(api('/platform/database/rotate-keys')).set(bearer(acmeOwner))).status).toBe(403);
    });
  });
});

describe('platform administration of hosting', () => {
  it('summarises hosting and health without tenant data or secrets', async () => {
    const r = await request(app).get(api('/platform/database/overview')).set(bearer(root));
    expect(r.status).toBe(200);
    expect(r.body.data.customerOwnedEnabled).toBe(true);
    expect(r.body.data.hostingModes.CUSTOMER_OWNED).toBeGreaterThanOrEqual(2);
  });

  it('sets a configurable storage entitlement and records it', async () => {
    const r = await request(app).patch(api(`/platform/tenants/${acmeId}/database-limits`)).set(bearer(root)).send({ storageLimitMb: 500, reason: 'Plan upgrade' });
    expect(r.status).toBe(200);
    const s = (await request(app).get(api('/tenants/current/database')).set(bearer(acmeOwner))).body.data;
    expect(s.usage?.limitMb).toBe(500);
    expect((await request(app).patch(api(`/platform/tenants/${acmeId}/database-limits`)).set(bearer(acmeOwner)).send({ storageLimitMb: 1, reason: 'x y z' })).status).toBe(403);
  });

  it('lets a platform admin onboard a customer-owned company too', async () => {
    const r = await request(app).post(api('/platform/tenants')).set(bearer(root)).send({
      name: 'Gamma Co', maxEmployees: 5, timezone: 'UTC', owner: { email: 'owner@gamma.test', firstName: 'G', lastName: 'O' },
      database: { hostingMode: 'CUSTOMER_OWNED', connectionString: uri('other_hrms') },
    });
    expect(r.status).toBe(201);
    expect(r.body.data.database).toMatchObject({ hostingMode: 'CUSTOMER_OWNED', status: 'READY', databaseName: 'other_hrms' });
    expect(JSON.stringify(r.body)).not.toMatch(/127\.0\.0\.1|mongodb:\/\//);
  });

  it('hides customer-owned signup when the platform has not configured encryption keys', async () => {
    await withSettings({ keyRing: undefined, customerOwnedEnabled: false }, async () => {
      const opts = await request(app).get(api('/signup/options'));
      expect(opts.body.data.hostingModes).toEqual([{ mode: 'MANAGED', available: true }, { mode: 'CUSTOMER_OWNED', available: false }]);
      const r = await signup('Delta Co', 'owner@delta.test', customer('other_hrms'));
      expect(r.status).toBe(503);
      expect(r.body.error.code).toBe('CUSTOMER_DB_DISABLED');
      expect(await Tenant.exists({ slug: 'delta-co' })).toBeNull();
    });
  });
});
