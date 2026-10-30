import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/database/models/auditLog.model';
import { User } from '../src/database/models/user.model';
import { Tenant } from '../src/database/models/tenant.model';
import { bearer, createTenant, loginAs, startTestApp, stopTestApp, testPasswordHash, type TestTenant } from './helpers';

let app: Express;
let a: TestTenant;
let b: TestTenant;
let root = '';
const tok: Record<string, string> = {};
const get = (who: string, path: string) => request(app).get(`/api/v1${path}`).set(bearer(tok[who] ?? ''));
const setModules = (id: unknown, modules: string[]) =>
  request(app).patch(`/api/v1/platform/tenants/${id}/modules`).set(bearer(root)).send({ modules, reason: 'Plan change' });

beforeAll(async () => {
  ({ app } = await startTestApp());
  a = await createTenant('mod-a');
  b = await createTenant('mod-b');
  for (const k of ['owner', 'hr', 'employee'] as const) {
    tok[`a${k}`] = await loginAs(app, a.people[k].email);
  }
  tok.bhr = await loginAs(app, b.people.hr.email);
  await User.create({ email: 'root@mod.test', passwordHash: await testPasswordHash(), status: 'ACTIVE', isPlatformAdmin: true });
  root = await loginAs(app, 'root@mod.test');
});
afterAll(stopTestApp);

describe('limited-access companies', () => {
  it('start with every module', async () => {
    expect((await get('ahr', '/payroll/runs')).status).toBe(200);
    const me = await get('ahr', '/auth/me');
    expect(me.body.data.memberships[0].modules).toContain('PAYROLL');
    expect(me.body.data.memberships[0].permissions).toContain('payroll:manage');
  });

  it('only a platform admin can change them', async () => {
    const r = await request(app).patch(`/api/v1/platform/tenants/${a.tenantId}/modules`).set(bearer(tok.aowner ?? '')).send({ modules: ['LEAVE'], reason: 'Try' });
    expect(r.status).toBe(403);
    expect((await request(app).get('/api/v1/platform/modules').set(bearer(tok.ahr ?? ''))).status).toBe(403);
    const cat = await request(app).get('/api/v1/platform/modules').set(bearer(root));
    expect(cat.body.data.find((m: { key: string }) => m.key === 'PAYROLL').requires).toEqual(['ATTENDANCE']);
  });

  it('rejects unknown modules, broken dependencies and a missing reason', async () => {
    expect((await setModules(a.tenantId, ['NOPE'])).status).toBe(422);
    expect((await setModules(a.tenantId, ['PAYROLL'])).status).toBe(422);
    const noReason = await request(app).patch(`/api/v1/platform/tenants/${a.tenantId}/modules`).set(bearer(root)).send({ modules: ['LEAVE'] });
    expect(noReason.status).toBe(422);
  });

  it('refuse switched-off modules at the API, hide them in the app, and leave other companies alone', async () => {
    const r = await setModules(a.tenantId, ['ATTENDANCE', 'LEAVE']);
    expect(r.status).toBe(200);
    expect(r.body.data.modules).toEqual(['ATTENDANCE', 'LEAVE']);

    for (const path of ['/payroll/runs', '/letters', '/letter-templates', '/handbook', `/employees/${a.people.employee.employeeId}/documents`, '/recruitment/jobs']) {
      const x = await get('ahr', path);
      expect(x.status, path).toBe(403);
      expect(x.body.error.code, path).toBe('MODULE_NOT_ENABLED');
    }
    expect((await get('aemployee', '/payroll/my/payslips')).body.error.code).toBe('MODULE_NOT_ENABLED');
    // Still working: enabled modules and core areas.
    expect((await get('ahr', '/leave-types')).status).toBe(200);
    expect((await get('ahr', '/employees')).status).toBe(200);
    expect((await get('ahr', '/departments')).status).toBe(200);

    const me = await get('ahr', '/auth/me');
    const m = me.body.data.memberships[0];
    expect(m.modules).toEqual(['ATTENDANCE', 'LEAVE']);
    expect(m.permissions).not.toContain('payroll:manage');
    expect(m.permissions).toContain('leave:manage');
    expect(m.permissions).toContain('employee:create');

    expect((await get('bhr', '/payroll/runs')).status).toBe(200);
    expect(await AuditLog.countDocuments({ tenantId: a.tenantId, action: 'platform.tenant_modules' })).toBe(1);
  });

  it('keep data when switched off and restore access when switched back on', async () => {
    expect((await setModules(a.tenantId, ['ATTENDANCE', 'LEAVE', 'PAYROLL'])).status).toBe(200);
    expect((await get('ahr', '/payroll/runs')).status).toBe(200);
    expect((await get('ahr', '/auth/me')).body.data.memberships[0].permissions).toContain('payroll:manage');
  });

  it('can be chosen when a company is onboarded', async () => {
    const r = await request(app).post('/api/v1/platform/tenants').set(bearer(root)).send({
      name: 'Limited Co',
      slug: 'limited-co',
      maxEmployees: 10,
      owner: { email: 'boss@limited.test', firstName: 'Limited', lastName: 'Boss' },
      modules: ['LEAVE'],
    });
    expect(r.status).toBe(201);
    expect(r.body.data.modules).toEqual(['LEAVE']);
    expect((await Tenant.findOne({ slug: 'limited-co' }).lean())!.modules).toEqual(['LEAVE']);
    const bad = await request(app).post('/api/v1/platform/tenants').set(bearer(root)).send({
      name: 'Broken Co',
      slug: 'broken-co',
      maxEmployees: 10,
      owner: { email: 'boss@broken.test', firstName: 'B', lastName: 'B' },
      modules: ['PAYROLL'],
    });
    expect(bad.status).toBe(422);
    expect(await Tenant.countDocuments({ slug: 'broken-co' })).toBe(0);
  });
});

describe('company numbering', () => {
  const ownerPatch = (who: string, numbering: object) =>
    request(app).patch('/api/v1/tenants/current').set(bearer(tok[who] ?? '')).send({ settings: { numbering } });
  const createEmp = (n: number) =>
    request(app)
      .post('/api/v1/employees')
      .set(bearer(tok.bhr ?? ''))
      .send({ firstName: 'Num', lastName: `Test${n}`, workEmail: `num${n}@example.test` });

  it('only the owner changes it, and only safe values are accepted', async () => {
    expect((await ownerPatch('bhr', { employee: { prefix: 'X-' } })).status).toBe(403);
    tok.bowner = await loginAs(app, b.people.owner.email);
    expect((await ownerPatch('bowner', { employee: { prefix: '<b>' } })).status).toBe(422);
    expect((await ownerPatch('bowner', { employee: { padding: 20 } })).status).toBe(422);
    expect((await ownerPatch('bowner', { bogus: {} })).status).toBe(422);
  });

  it('applies to new employee codes and letter references, never to existing ones', async () => {
    const before = await createEmp(1);
    expect(before.status).toBe(201);
    expect(before.body.data.employeeCode).toMatch(/^EMP-\d{4}$/);
    const r = await ownerPatch('bowner', { employee: { prefix: 'acme/', padding: 6 } });
    expect(r.status).toBe(200);
    expect(r.body.data.numbering.employee).toEqual({ prefix: 'ACME/', padding: 6 });
    expect(r.body.data.numbering.letter).toEqual({ prefix: 'LTR-', padding: 4 });
    const after = await createEmp(2);
    expect(after.body.data.employeeCode).toMatch(/^ACME\/\d{6}$/);
    const old = await request(app).get(`/api/v1/employees/${before.body.data.id}`).set(bearer(tok.bhr ?? ''));
    expect(old.body.data.employeeCode).toBe(before.body.data.employeeCode);
  });
});
