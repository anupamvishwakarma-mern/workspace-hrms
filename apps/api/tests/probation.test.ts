import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/database/models/auditLog.model';
import { Employee } from '../src/database/models/employee.model';
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
const probation = (role: string, id: unknown, body: Record<string, unknown>) =>
  request(app)
    .post(`/api/v1/employees/${String(id)}/probation`)
    .set(h(role))
    .send(body);
const confirm = (role: string, id: unknown, body: Record<string, unknown> = {}, t = a) =>
  request(app)
    .post(`/api/v1/employees/${String(id)}/confirm`)
    .set(h(role, t))
    .send(body);

beforeAll(async () => {
  ({ app } = await startTestApp());
  a = await createTenant('prob-a');
  b = await createTenant('prob-b');
  for (const r of ['owner', 'hr', 'manager', 'employee', 'employee2'] as const)
    tok[`a-${r}`] = await loginAs(app, a.people[r].email);
  tok['b-owner'] = await loginAs(app, b.people.owner.email);
});
afterAll(stopTestApp);

describe('probation and confirmation', () => {
  it('HR starts probation; employees and managers cannot', async () => {
    const id = a.people.employee.employeeId;
    expect((await probation('employee', id, { endDate: '2031-01-01' })).status).toBe(403);
    expect((await probation('manager', id, { endDate: '2031-01-01' })).status).toBe(403);
    const r = await probation('hr', id, { endDate: '2031-01-01' });
    expect(r.status).toBe(200);
    expect(r.body.data.probationStatus).toBe('ON_PROBATION');
    const emp = await Employee.findOne({ _id: id, tenantId: a.tenantId }).lean();
    expect(emp!.history.some((x) => x.type === 'PROBATION_START')).toBe(true);
  });

  it('extending needs a later date and a reason', async () => {
    const id = a.people.employee.employeeId;
    expect((await probation('hr', id, { endDate: '2030-06-01', reason: 'earlier' })).status).toBe(
      400,
    );
    expect((await probation('hr', id, { endDate: '2031-04-01' })).status).toBe(400);
    const ok = await probation('hr', id, { endDate: '2031-04-01', reason: 'Needs more time' });
    expect(ok.status).toBe(200);
    const emp = await Employee.findOne({ _id: id, tenantId: a.tenantId }).lean();
    expect(emp!.history.some((x) => x.type === 'PROBATION_EXTENDED')).toBe(true);
  });

  it('the manager sees probation status of a report, not of a stranger; employee sees own', async () => {
    const id = a.people.employee.employeeId;
    const mgr = await request(app)
      .get(`/api/v1/employees/${String(id)}`)
      .set(h('manager'));
    expect(mgr.status).toBe(200);
    expect(mgr.body.data.probationStatus).toBe('ON_PROBATION');
    const own = await request(app)
      .get(`/api/v1/employees/${String(id)}`)
      .set(h('employee'));
    expect(own.body.data.probationStatus).toBe('ON_PROBATION');
    const stranger = await request(app)
      .get(`/api/v1/employees/${String(id)}`)
      .set(h('employee2'));
    expect(stranger.status).toBe(404);
  });

  it('only people with the confirm permission can confirm, and never their own record', async () => {
    const id = a.people.employee.employeeId;
    expect((await confirm('manager', id)).status).toBe(403);
    expect((await confirm('employee', id)).status).toBe(403);
    // HR on probation cannot confirm themselves; the owner can confirm HR.
    const hrId = a.people.hr.employeeId;
    expect((await probation('hr', hrId, { endDate: '2031-01-01' })).status).toBe(200);
    expect((await confirm('hr', hrId)).status).toBe(403);
    expect((await confirm('owner', hrId, { comment: 'Good work' })).status).toBe(200);
  });

  it('confirms once: history, audit, no second confirmation, no return to probation', async () => {
    const id = a.people.employee.employeeId;
    const ok = await confirm('hr', id, { confirmationDate: '2030-12-01', comment: 'Confirmed' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.probationStatus).toBe('CONFIRMED');
    expect((await confirm('owner', id)).status).toBe(409);
    expect((await probation('hr', id, { endDate: '2032-01-01' })).status).toBe(409);
    const emp = await Employee.findOne({ _id: id, tenantId: a.tenantId }).lean();
    expect(emp!.history.filter((x) => x.type === 'CONFIRMED')).toHaveLength(1);
    expect(
      await AuditLog.countDocuments({
        tenantId: a.tenantId,
        action: 'employee.confirmed',
        entityId: id,
      }),
    ).toBe(1);
  });

  it('cannot confirm someone who is not on probation', async () => {
    expect((await confirm('hr', a.people.employee2.employeeId)).status).toBe(409);
  });

  it('simultaneous confirmations record exactly one', async () => {
    const id = a.people.manager.employeeId;
    expect((await probation('hr', id, { endDate: '2031-01-01' })).status).toBe(200);
    const res = await Promise.all([confirm('hr', id), confirm('owner', id), confirm('hr', id)]);
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
    expect(res.filter((r) => r.status === 409)).toHaveLength(2);
    const emp = await Employee.findOne({ _id: id, tenantId: a.tenantId }).lean();
    expect(emp!.history.filter((x) => x.type === 'CONFIRMED')).toHaveLength(1);
  });

  it('the list can be filtered and the old direct confirmationDate edit is gone', async () => {
    const list = await request(app)
      .get('/api/v1/employees?probationStatus=CONFIRMED&limit=100')
      .set(h('hr'));
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(1);
    for (const e of list.body.data) expect(e.probationStatus).toBe('CONFIRMED');
    const patch = await request(app)
      .patch(`/api/v1/employees/${String(a.people.employee2.employeeId)}`)
      .set(h('hr'))
      .send({ confirmationDate: '2030-01-01' });
    expect(patch.status).toBe(422);
  });

  it("another company cannot touch this company's employees", async () => {
    const id = a.people.employee2.employeeId;
    const r = await request(app)
      .post(`/api/v1/employees/${String(id)}/probation`)
      .set(h('owner', b))
      .send({ endDate: '2031-01-01' });
    expect(r.status).toBe(404);
    expect((await confirm('owner', id, {}, b)).status).toBe(404);
  });
});
