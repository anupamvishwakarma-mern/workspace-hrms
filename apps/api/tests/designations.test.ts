import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/database/models/auditLog.model';
import {
  bearer,
  createTenant,
  loginAs,
  startTestApp,
  stopTestApp,
  type TestTenant,
} from './helpers';

let app: Express;
let a: TestTenant;
let b: TestTenant;
const tok: Record<string, string> = {};
const h = (role: string, t: TestTenant = a) => ({
  ...bearer(tok[`${t === a ? 'a' : 'b'}-${role}`]!),
  'X-Tenant-Id': String(t.tenantId),
});

beforeAll(async () => {
  ({ app } = await startTestApp());
  a = await createTenant('desig-a');
  b = await createTenant('desig-b');
  for (const r of ['owner', 'hr', 'manager', 'employee'] as const) {
    tok[`a-${r}`] = await loginAs(app, a.people[r].email);
  }
  tok['b-owner'] = await loginAs(app, b.people.owner.email);
});
afterAll(stopTestApp);

const create = (role: string, body: Record<string, unknown>, t: TestTenant = a) =>
  request(app).post('/api/v1/designations').set(h(role, t)).send(body);

describe('designations', () => {
  it('HR can create, list and update; duplicates are rejected', async () => {
    const r = await create('hr', { title: 'Senior Engineer', code: 'se', level: 4 });
    expect(r.status).toBe(201);
    expect(r.body.data.code).toBe('SE');
    expect((await create('hr', { title: 'Senior Engineer' })).status).toBe(409);
    expect((await create('hr', { title: 'Other', code: 'SE' })).status).toBe(409);
    const list = await request(app).get('/api/v1/designations').set(h('hr'));
    expect(list.body.data.map((d: { title: string }) => d.title)).toContain('Senior Engineer');
    const p = await request(app)
      .patch(`/api/v1/designations/${r.body.data.id}`)
      .set(h('hr'))
      .send({ level: 5, code: null });
    expect(p.status).toBe(200);
    expect(p.body.data.level).toBe(5);
    expect(p.body.data.code).toBeUndefined();
    expect(
      await AuditLog.countDocuments({ tenantId: a.tenantId, action: 'designation.create' }),
    ).toBeGreaterThan(0);
  });

  it('employees and managers can read but not write', async () => {
    expect((await request(app).get('/api/v1/designations').set(h('employee'))).status).toBe(200);
    expect((await create('employee', { title: 'X1' })).status).toBe(403);
    expect((await create('manager', { title: 'X2' })).status).toBe(403);
  });

  it('is isolated per company', async () => {
    const r = await create('hr', { title: 'Only In A' });
    const other = await request(app).get('/api/v1/designations').set(h('owner', b));
    expect(other.body.data.map((d: { title: string }) => d.title)).not.toContain('Only In A');
    const cross = await request(app)
      .patch(`/api/v1/designations/${r.body.data.id}`)
      .set(h('owner', b))
      .send({ level: 1 });
    expect(cross.status).toBe(404);
  });

  it('assigning a designation to an employee copies its title and records history', async () => {
    const d = await create('hr', { title: 'Team Lead' });
    const empId = String(a.people.employee.employeeId);
    const r = await request(app)
      .patch(`/api/v1/employees/${empId}`)
      .set(h('hr'))
      .send({ designationId: d.body.data.id, dateOfBirth: '1992-04-05', gender: 'FEMALE' });
    expect(r.status).toBe(200);
    expect(r.body.data.designation).toBe('Team Lead');
    expect(r.body.data.designationId).toBe(d.body.data.id);
    const full = await request(app).get(`/api/v1/employees/${empId}`).set(h('hr'));
    expect(
      full.body.data.history.some((x: { type: string }) => x.type === 'DESIGNATION_CHANGE'),
    ).toBe(true);
  });

  it("rejects another company's designation and an inactive one; blocks deleting one in use", async () => {
    const foreign = await create('owner', { title: 'Foreign' }, b);
    const empId = String(a.people.employee.employeeId);
    const bad = await request(app)
      .patch(`/api/v1/employees/${empId}`)
      .set(h('hr'))
      .send({ designationId: foreign.body.data.id });
    expect(bad.status).toBe(400);
    const d = await create('hr', { title: 'Retired Title' });
    await request(app)
      .patch(`/api/v1/designations/${d.body.data.id}`)
      .set(h('hr'))
      .send({ status: 'INACTIVE' });
    const inactive = await request(app)
      .patch(`/api/v1/employees/${empId}`)
      .set(h('hr'))
      .send({ designationId: d.body.data.id });
    expect(inactive.status).toBe(400);
    const used = await request(app).get('/api/v1/designations?search=Team').set(h('hr'));
    const del = await request(app)
      .delete(`/api/v1/designations/${used.body.data[0].id}`)
      .set(h('hr'));
    expect(del.status).toBe(409);
  });

  it('managers do not see personal fields of their reports', async () => {
    const empId = String(a.people.employee.employeeId);
    const asMgr = await request(app).get(`/api/v1/employees/${empId}`).set(h('manager'));
    if (asMgr.status === 200) {
      expect(asMgr.body.data.dateOfBirth).toBeUndefined();
      expect(asMgr.body.data.gender).toBeUndefined();
    }
  });
});
