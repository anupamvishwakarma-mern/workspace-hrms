import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { User } from '../src/database/models/user.model';
import { bearer, createTenant, loginAs, startTestApp, stopTestApp, testPasswordHash, type TestTenant } from './helpers';

let app: Express;
let a: TestTenant;
let root = '';
let owner = '';
const get = (tok: string, path: string) => request(app).get(`/api/v1${path}`).set(bearer(tok));

beforeAll(async () => {
  ({ app } = await startTestApp());
  a = await createTenant('console-a');
  owner = await loginAs(app, a.people.owner.email);
  await User.create({ email: 'root@console.test', passwordHash: await testPasswordHash(), status: 'ACTIVE', isPlatformAdmin: true });
  root = await loginAs(app, 'root@console.test');
});
afterAll(stopTestApp);

describe('platform console API', () => {
  it('is closed to company users', async () => {
    for (const p of ['/platform/metrics', '/platform/companies', `/platform/companies/${a.tenantId}`, '/platform/admins', '/platform/owners'])
      expect((await get(owner, p)).status, p).toBe(403);
  });

  it('dashboard metrics count companies, people and module use', async () => {
    const r = await get(root, '/platform/metrics');
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.companies).toBeGreaterThanOrEqual(1);
    expect(d.tenantsByStatus.ACTIVE).toBeGreaterThanOrEqual(1);
    expect(d.people).toBeGreaterThanOrEqual(1);
    expect(d.moduleAdoption.PAYROLL).toBeGreaterThanOrEqual(1);
    expect(d.signupsByMonth).toHaveLength(6);
    expect(JSON.stringify(d)).not.toContain('@'); // no personal data in the dashboard
  });

  it('lists and searches companies with headcount', async () => {
    const all = await get(root, '/platform/companies');
    const mine = all.body.data.find((t: any) => t.id === String(a.tenantId));
    expect(mine.headcount).toBeGreaterThanOrEqual(1);
    const hit = await get(root, '/platform/companies?q=CONSOLE');
    expect(hit.body.data.some((t: any) => t.id === String(a.tenantId))).toBe(true);
    expect((await get(root, '/platform/companies?q=no-such-company-xyz')).body.data).toHaveLength(0);
    expect((await get(root, '/platform/companies?q=.*')).body.data).toHaveLength(0); // regex is escaped
  });

  it('shows one company with owners and its platform changes', async () => {
    const seats = await request(app).patch(`/api/v1/platform/tenants/${a.tenantId}/seats`).set(bearer(root)).send({ maxEmployees: 50 });
    expect(seats.status).toBe(200);
    const r = await get(root, `/platform/companies/${a.tenantId}`);
    expect(r.status).toBe(200);
    expect(r.body.data.owners.map((o: any) => o.email)).toContain(a.people.owner.email);
    expect(r.body.data.activity.some((x: any) => x.action === 'platform.tenant_seats' && x.by === 'root@console.test')).toBe(true);
    expect((await get(root, '/platform/companies/000000000000000000000000')).status).toBe(404);
  });

  it('lists every owner with their company', async () => {
    const r = await get(root, '/platform/owners');
    expect(r.status).toBe(200);
    const mine = r.body.data.find((o: any) => o.email === a.people.owner.email);
    expect(mine.companyId).toBe(String(a.tenantId));
    expect(mine.companyName).toBeTruthy();
  });

  it('lists platform administrators', async () => {
    const r = await get(root, '/platform/admins');
    expect(r.body.data.map((u: any) => u.email)).toContain('root@console.test');
  });
});
