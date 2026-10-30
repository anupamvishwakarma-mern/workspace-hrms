import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AttendanceDay } from '../src/database/models/attendanceDay.model';
import {
  FakeClock,
  bearer,
  createTenant,
  ist,
  loginAs,
  setupSchedule,
  startTestApp,
  stopTestApp,
  type TestTenant,
} from './helpers';

let app: Express;
let t: TestTenant;
let clock: FakeClock;
let annual: string;
let workflowId: string;
const tok: Record<string, string> = {};
const call = (m: 'get' | 'post' | 'patch', who: string, path: string, body?: object) => {
  const r = request(app)[m](`/api/v1${path}`).set(bearer(tok[who]!));
  return body ? r.send(body) : r;
};
const apply = (who: string, day: string) =>
  call('post', who, '/leave/requests', { leaveTypeId: annual, startDate: day, endDate: day });
const leaveStatus = async (who: string, id: string) =>
  (await call('get', who, '/leave/requests')).body.data.find((x: { id: string }) => x.id === id)?.status;
const dayStatus = async (who: keyof TestTenant['people'], day: string) =>
  (await AttendanceDay.findOne({ employeeId: t.people[who].employeeId, workDate: day }).lean())?.status;
/** The engine request behind a leave request, found in the named approver's inbox by its date. */
const approvalFor = async (who: string, day: string) => {
  const inbox = await call('get', who, '/approvals?scope=inbox&limit=100');
  return inbox.body.data.find((x: { details?: { startDate?: string } }) => x.details?.startDate === day);
};

beforeAll(async () => {
  clock = new FakeClock(ist('2026-03-05', '12:00'));
  ({ app } = await startTestApp({}, { clock }));
  t = await createTenant('lw');
  await setupSchedule(t);
  for (const k of Object.keys(t.people) as (keyof TestTenant['people'])[])
    tok[k] = await loginAs(app, t.people[k].email);
  const lt = await call('post', 'hr', '/leave-types', { name: 'Annual', code: 'AL', annualAllowanceDays: 5 });
  annual = lt.body.data.id;
});
afterAll(stopTestApp);

describe('leave through an approval workflow', () => {
  it('without a workflow the built-in rule still applies', async () => {
    const r = await apply('employee', '2026-03-09');
    expect(r.status).toBe(201);
    expect((await call('post', 'hr', `/leave/requests/${r.body.data.id}/approve`, {})).status).toBe(404);
    expect((await call('post', 'manager', `/leave/requests/${r.body.data.id}/approve`, {})).status).toBe(200);
  });

  it('manager then HR: the leave stays pending until the last step', async () => {
    const wf = await call('post', 'hr', '/approval-workflows', {
      name: 'Leave',
      requestType: 'LEAVE',
      steps: [{ approverType: 'MANAGER' }, { approverType: 'ROLE', role: 'HR_ADMIN' }],
    });
    expect(wf.status).toBe(201);
    workflowId = wf.body.data.id;

    const r = await apply('employee', '2026-03-02');
    expect(r.status).toBe(201);
    const id = r.body.data.id;
    const dec = (who: string) => call('post', who, `/leave/requests/${id}/approve`, {});

    expect((await dec('hr')).status).toBe(404); // not HR's turn yet
    expect((await dec('employee')).status).toBe(403);
    const first = await dec('manager');
    expect(first.status).toBe(200);
    expect(first.body.data.status).toBe('PENDING');
    expect(await dayStatus('employee', '2026-03-02')).not.toBe('ON_LEAVE');
    expect((await dec('manager')).status).toBe(404); // step 2 is HR's

    const last = await dec('hr');
    expect(last.status).toBe(200);
    expect(last.body.data.status).toBe('APPROVED');
    expect(await dayStatus('employee', '2026-03-02')).toBe('ON_LEAVE');
    expect((await dec('hr')).status).toBe(409);
  });

  it('the generic approvals endpoint finishes a leave request too', async () => {
    const r = await apply('employee', '2026-03-03');
    const id = r.body.data.id;
    const ap = await approvalFor('manager', '2026-03-03');
    expect(ap.requestType).toBe('LEAVE');
    expect((await call('post', 'manager', `/approvals/${ap.id}/decision`, { decision: 'APPROVE' })).status).toBe(200);
    expect((await call('post', 'hr', `/approvals/${ap.id}/decision`, { decision: 'APPROVE' })).body.data.status).toBe('APPROVED');
    expect(await leaveStatus('employee', id)).toBe('APPROVED');
    expect(await dayStatus('employee', '2026-03-03')).toBe('ON_LEAVE');
  });

  it('a rejection at any step rejects the leave with the comment', async () => {
    const r = await apply('employee', '2026-03-04');
    const ap = await approvalFor('manager', '2026-03-04');
    await call('post', 'manager', `/approvals/${ap.id}/decision`, { decision: 'REJECT', comment: 'Release week' });
    expect(await leaveStatus('employee', r.body.data.id)).toBe('REJECTED');
    expect(await dayStatus('employee', '2026-03-04')).not.toBe('ON_LEAVE');
  });

  it('withdrawing either side withdraws both', async () => {
    const a = await apply('employee', '2026-03-12');
    const apA = await approvalFor('manager', '2026-03-12');
    expect((await call('post', 'employee', `/leave/requests/${a.body.data.id}/cancel`, {})).status).toBe(200);
    expect((await call('get', 'employee', `/approvals/${apA.id}`)).body.data.status).toBe('CANCELLED');

    const b = await apply('employee', '2026-03-18');
    const apB = await approvalFor('manager', '2026-03-18');
    expect((await call('post', 'employee', `/approvals/${apB.id}/cancel`, {})).status).toBe(200);
    expect(await leaveStatus('employee', b.body.data.id)).toBe('CANCELLED');
  });

  it('refuses the request, and leaves nothing behind, when nobody can approve it', async () => {
    await call('patch', 'hr', `/approval-workflows/${workflowId}`, { steps: [{ approverType: 'ROLE', role: 'COMPANY_OWNER' }] });
    const before = (await call('get', 'owner', '/leave/requests?limit=100')).body.data.length;
    expect((await apply('owner', '2026-03-16')).status).toBe(422);
    expect((await call('get', 'owner', '/leave/requests?limit=100')).body.data.length).toBe(before);
  });

  it('an inactive workflow returns leave to the built-in rule', async () => {
    await call('patch', 'hr', `/approval-workflows/${workflowId}`, { status: 'INACTIVE' });
    const r = await apply('employee2', '2026-03-17');
    expect((await call('post', 'owner', `/leave/requests/${r.body.data.id}/approve`, {})).status).toBe(200);
  });
});
