import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/database/models/auditLog.model';
import {
  addPerson,
  bearer,
  createTenant,
  loginAs,
  startTestApp,
  stopTestApp,
  type TestTenant,
} from './helpers';

let app: Express;
let t: TestTenant;
let beta: TestTenant;
const tok: Record<string, string> = {};
const api = (m: 'get' | 'post' | 'patch' | 'put' | 'delete', who: string, path: string, tenant = t) =>
  request(app)[m](`/api/v1${path}`).set(bearer(tok[who]!)).set('X-Tenant-Id', String(tenant.tenantId));

beforeAll(async () => {
  ({ app } = await startTestApp());
  t = await createTenant('roles-a');
  beta = await createTenant('roles-b');
  for (const k of ['owner', 'hr', 'manager', 'employee'] as const) tok[k] = await loginAs(app, t.people[k].email);
  tok.betaOwner = await loginAs(app, beta.people.owner.email);
});
afterAll(stopTestApp);

const mk = async (name: string, permissions: string[]) => {
  const r = await api('post', 'owner', '/roles').send({ name, permissions });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data.id as string;
};

describe('managing company-defined roles', () => {
  it('only the owner can create, edit or delete; HR can only list', async () => {
    for (const who of ['hr', 'manager', 'employee'])
      expect((await api('post', who, '/roles').send({ name: 'Nope', permissions: [] })).status).toBe(403);
    const id = await mk('Auditor', ['audit:read']);
    expect((await api('patch', 'hr', `/roles/${id}`).send({ name: 'X1' })).status).toBe(403);
    expect((await api('delete', 'hr', `/roles/${id}`)).status).toBe(403);
    expect((await api('get', 'hr', '/roles')).status).toBe(200);
    expect((await api('get', 'employee', '/roles')).status).toBe(403);
    expect((await api('get', 'hr', '/roles/permissions')).status).toBe(403);
    const cat = await api('get', 'owner', '/roles/permissions');
    const names = cat.body.data.map((x: { permission: string }) => x.permission);
    expect(names).toContain('audit:read');
    for (const locked of ['tenant:update', 'role:manage', 'employee:roles', 'payroll:publish', 'employee:sensitive:update'])
      expect(names).not.toContain(locked);
  });

  it('validates names and permissions, and rejects locked ones', async () => {
    const lock = await api('post', 'owner', '/roles').send({ name: 'Sneaky', permissions: ['payroll:publish'] });
    expect(lock.status).toBe(422);
    expect((await api('post', 'owner', '/roles').send({ name: 'Odd', permissions: ['made:up'] })).status).toBe(422);
    expect((await api('post', 'owner', '/roles').send({ name: 'Extra', permissions: [], admin: true })).status).toBe(422);
    expect((await api('post', 'owner', '/roles').send({ name: 'HR Admin', permissions: [] })).status).toBe(409);
    expect((await api('post', 'owner', '/roles').send({ name: 'employee', permissions: [] })).status).toBe(409);
    await mk('Dupe', []);
    expect((await api('post', 'owner', '/roles').send({ name: 'dupe', permissions: [] })).status).toBe(409);
    expect((await api('patch', 'owner', `/roles/${await mk('Edit me', [])}`).send({})).status).toBe(422);
  });

  it('assigned roles take effect at once, and editing the role changes everyone who holds it', async () => {
    const p = await addPerson(t.tenantId, 'roles-a', 'holder', ['EMPLOYEE'], t.department);
    const ptok = await loginAs(app, p.email);
    const audit = () =>
      request(app).get('/api/v1/audit-logs').set(bearer(ptok)).set('X-Tenant-Id', String(t.tenantId));
    expect((await audit()).status).toBe(403);
    const id = await mk('Log reader', ['audit:read']);
    const put = await api('put', 'owner', `/employees/${p.employeeId}/custom-roles`).send({ roleIds: [id] });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect((await audit()).status).toBe(200);
    expect((await api('get', 'owner', `/employees/${p.employeeId}/custom-roles`)).body.data.roleIds).toEqual([id]);

    // roles in use cannot be deleted; counts are reported
    const del = await api('delete', 'owner', `/roles/${id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('ROLE_IN_USE');
    expect((await api('get', 'owner', '/roles')).body.data.find((r: { id: string }) => r.id === id).assignedCount).toBe(1);

    // taking the permission out of the role removes it from the holder on the next request
    expect((await api('patch', 'owner', `/roles/${id}`).send({ permissions: [] })).status).toBe(200);
    expect((await audit()).status).toBe(403);

    await api('put', 'owner', `/employees/${p.employeeId}/custom-roles`).send({ roleIds: [] });
    expect((await api('delete', 'owner', `/roles/${id}`)).status).toBe(200);
    for (const action of ['role.create', 'role.update', 'role.delete', 'employee.custom_roles'])
      expect(await AuditLog.countDocuments({ tenantId: t.tenantId, action }), action).toBeGreaterThan(0);
  });

  it('HR can assign only roles made of permissions HR holds, only to managers and employees, never to themselves', async () => {
    const safe = await mk('HR-safe', ['audit:read']);
    const beyond = await mk('Team approver', ['leave:review:team']); // HR does not hold this one
    const target = await addPerson(t.tenantId, 'roles-a', 'target1', ['EMPLOYEE'], t.department);
    const set = (who: string, empId: unknown, roleIds: string[]) =>
      api('put', who, `/employees/${empId}/custom-roles`).send({ roleIds });

    expect((await set('hr', target.employeeId, [safe])).status).toBe(200);
    expect((await set('hr', target.employeeId, [safe, beyond])).status).toBe(403);
    expect((await set('owner', target.employeeId, [safe, beyond])).status).toBe(200); // owner may assign anything
    // HR can still take roles away
    expect((await set('hr', target.employeeId, [])).status).toBe(200);
    expect((await set('hr', t.people.hr.employeeId, [safe])).status).toBe(403); // not to themselves
    expect((await set('hr', t.people.owner.employeeId, [safe])).status).toBe(403); // not to an owner
    for (const who of ['manager', 'employee'])
      expect((await set(who, target.employeeId, [safe])).status).toBe(403);
  });

  it('enforces the per-person limit and unknown or foreign roles', async () => {
    const target = await addPerson(t.tenantId, 'roles-a', 'target2', ['EMPLOYEE'], t.department);
    const ids = [await mk('L1', []), await mk('L2', []), await mk('L3', []), await mk('L4', [])];
    const put = (roleIds: string[]) =>
      api('put', 'owner', `/employees/${target.employeeId}/custom-roles`).send({ roleIds });
    expect((await put(ids)).status).toBe(422);
    expect((await put(ids.slice(0, 3))).status).toBe(200);
    expect((await put(['64b64b64b64b64b64b64b64b'])).status).toBe(422);
    const foreign = (await api('post', 'betaOwner', '/roles', beta).send({ name: 'Foreign', permissions: [] })).body.data.id;
    expect((await put([foreign])).status).toBe(422);
  });

  it('keeps companies apart', async () => {
    await mk('Only in A', ['audit:read']);
    const theirs = await api('get', 'betaOwner', '/roles', beta);
    expect(theirs.body.data.map((r: { name: string }) => r.name)).not.toContain('Only in A');
    const aRole = (await api('get', 'owner', '/roles')).body.data.find((r: { name: string }) => r.name === 'Only in A');
    expect((await api('patch', 'betaOwner', `/roles/${aRole.id}`, beta).send({ name: 'Hijack' })).status).toBe(404);
    expect((await api('delete', 'betaOwner', `/roles/${aRole.id}`, beta)).status).toBe(404);
  });

  it('caps the number of roles per company', async () => {
    const c = await createTenant('roles-cap');
    const o = await loginAs(app, c.people.owner.email);
    const post = (name: string) =>
      request(app).post('/api/v1/roles').set(bearer(o)).set('X-Tenant-Id', String(c.tenantId)).send({ name, permissions: [] });
    for (let i = 0; i < 20; i++) expect((await post(`Role ${i}`)).status).toBe(201);
    expect((await post('One too many')).status).toBe(409);
  });
});
