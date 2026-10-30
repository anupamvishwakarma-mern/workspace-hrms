import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/database/models/auditLog.model';
import { bearer, createTenant, loginAs, startTestApp, stopTestApp, type TestTenant } from './helpers';

let app: Express;
let a: TestTenant;
let b: TestTenant;
const tok: Record<string, string> = {};
const h = (role: string, t: TestTenant = a) => ({
  ...bearer(tok[`${t === a ? 'a' : 'b'}-${role}`]!),
  'X-Tenant-Id': String(t.tenantId),
});
const api = (m: 'get' | 'post' | 'patch', url: string, role: string, body?: object, t: TestTenant = a) => {
  const r = request(app)[m](`/api/v1${url}`).set(h(role, t));
  return body ? r.send(body) : r;
};

beforeAll(async () => {
  ({ app } = await startTestApp());
  a = await createTenant('appr-a');
  b = await createTenant('appr-b');
  for (const r of ['owner', 'hr', 'manager', 'employee', 'employee2', 'payroll'] as const)
    tok[`a-${r}`] = await loginAs(app, a.people[r].email);
  tok['b-owner'] = await loginAs(app, b.people.owner.email);
  // Two-step chain: the requester's manager, then HR.
  const wf = await api('post', '/approval-workflows', 'hr', {
    name: 'Leave',
    requestType: 'leave_x',
    steps: [{ approverType: 'MANAGER' }, { approverType: 'ROLE', role: 'HR_ADMIN' }],
  });
  expect(wf.status).toBe(201);
  expect((await api('post', '/approval-workflows', 'hr', { name: 'Solo', requestType: 'SOLO', steps: [{ approverType: 'MANAGER' }] })).status).toBe(201);
  expect((await api('post', '/approval-workflows', 'hr', { name: 'HRonly', requestType: 'HRONLY', steps: [{ approverType: 'ROLE', role: 'HR_ADMIN' }] })).status).toBe(201);
});
afterAll(stopTestApp);

const submit = (role: string, requestType = 'LEAVE_X', t: TestTenant = a) =>
  api('post', '/approvals', role, { requestType, title: 'Test request', details: { days: 2 } }, t);

describe('approval workflows', () => {
  it('only approval managers define workflows; one active per type; validated', async () => {
    const body = { name: 'X', requestType: 'ABC', steps: [{ approverType: 'MANAGER' }] };
    expect((await api('post', '/approval-workflows', 'employee', body)).status).toBe(403);
    expect((await api('post', '/approval-workflows', 'manager', body)).status).toBe(403);
    expect((await api('post', '/approval-workflows', 'hr', { ...body, requestType: 'LEAVE_X' })).status).toBe(409);
    expect((await api('post', '/approval-workflows', 'hr', { ...body, steps: [{ approverType: 'ROLE' }] })).status).toBe(422);
    expect((await api('post', '/approval-workflows', 'hr', { ...body, steps: [] })).status).toBe(422);
    expect((await api('get', '/approval-workflows', 'hr')).status).toBe(200);
    expect((await api('get', '/approval-workflows', 'employee')).status).toBe(403);
  });

  it('inactive workflow cannot be used; editing does not alter raised requests', async () => {
    const wf = await api('post', '/approval-workflows', 'hr', { name: 'Tmp', requestType: 'TMPX', steps: [{ approverType: 'MANAGER' }] });
    const r = await submit('employee', 'TMPX');
    expect(r.status).toBe(201);
    const p = await api('patch', `/approval-workflows/${wf.body.data.id}`, 'hr', { steps: [{ approverType: 'ROLE', role: 'HR_ADMIN' }] });
    expect(p.status).toBe(200);
    const again = await api('get', `/approvals/${r.body.data.id}`, 'employee');
    expect(again.body.data.steps[0].approverType).toBe('MANAGER');
    await api('patch', `/approval-workflows/${wf.body.data.id}`, 'hr', { status: 'INACTIVE' });
    expect((await submit('employee', 'TMPX')).status).toBe(404);
  });
});

describe('approval requests', () => {
  it('runs manager then HR; nobody approves out of turn or their own', async () => {
    const r = await submit('employee');
    expect(r.status).toBe(201);
    const id = r.body.data.id;
    expect(r.body.data.steps[0].status).toBe('PENDING');
    const dec = (role: string, decision = 'APPROVE') => api('post', `/approvals/${id}/decision`, role, { decision });

    expect((await dec('employee')).status).toBe(403); // own request
    expect((await dec('hr')).status).toBe(404); // not their step yet
    expect((await dec('employee2')).status).toBe(404);
    const m = await dec('manager');
    expect(m.status).toBe(200);
    expect(m.body.data.status).toBe('PENDING');
    expect(m.body.data.currentStep).toBe(1);
    expect((await dec('manager')).status).toBe(404); // step 2 belongs to HR
    const hr = await dec('hr');
    expect(hr.body.data.status).toBe('APPROVED');
    expect((await dec('hr')).status).toBe(409); // already decided
  });

  it('a rejection ends the request', async () => {
    const r = await submit('employee');
    const rej = await api('post', `/approvals/${r.body.data.id}/decision`, 'manager', { decision: 'REJECT', comment: 'Busy week' });
    expect(rej.body.data.status).toBe('REJECTED');
    expect(rej.body.data.steps[0].comment).toBe('Busy week');
    const again = (role: string) => api('post', `/approvals/${r.body.data.id}/decision`, role, { decision: 'APPROVE' });
    expect((await again('manager')).status).toBe(409); // the approver tries again: already decided
    expect((await again('hr')).status).toBe(404); // HR was never on this step
  });

  it('unmanaged requester goes to the owner; owner with no one above gets 422', async () => {
    const r = await submit('employee2', 'SOLO');
    expect(r.status).toBe(201);
    expect((await api('post', `/approvals/${r.body.data.id}/decision`, 'manager', { decision: 'APPROVE' })).status).toBe(404);
    expect((await api('post', `/approvals/${r.body.data.id}/decision`, 'owner', { decision: 'APPROVE' })).body.data.status).toBe('APPROVED');
    expect((await submit('owner', 'SOLO')).status).toBe(422);
  });

  it('a requester is never an eligible approver even by role', async () => {
    const r = await submit('hr', 'HRONLY');
    expect(r.status).toBe(422);
  });

  it('inbox and visibility', async () => {
    const r = await submit('employee');
    const id = r.body.data.id;
    const inbox = await api('get', '/approvals?scope=inbox', 'manager');
    expect(inbox.body.data.map((x: { id: string }) => x.id)).toContain(id);
    const item = inbox.body.data.find((x: { id: string }) => x.id === id);
    expect(item.requesterName).toBeTruthy();
    expect(item.steps[0].approverNames.length).toBeGreaterThan(0);
    const other = await api('get', '/approvals?scope=inbox', 'employee2');
    expect(other.body.data.map((x: { id: string }) => x.id)).not.toContain(id);
    expect((await api('get', `/approvals/${id}`, 'employee2')).status).toBe(404);
    expect((await api('get', `/approvals/${id}`, 'manager')).status).toBe(200);
    expect((await api('get', `/approvals/${id}`, 'hr')).status).toBe(200); // approval manager
    expect((await api('get', '/approvals?scope=all', 'employee')).status).toBe(403);
    expect((await api('get', '/approvals?scope=all', 'hr')).status).toBe(200);
    const mine = await api('get', '/approvals', 'employee');
    expect(mine.body.data.map((x: { id: string }) => x.id)).toContain(id);
  });

  it('only the requester can cancel, and only while pending', async () => {
    const r = await submit('employee');
    const id = r.body.data.id;
    expect((await api('post', `/approvals/${id}/cancel`, 'manager')).status).toBe(404);
    expect((await api('post', `/approvals/${id}/cancel`, 'employee')).body.data.status).toBe('CANCELLED');
    expect((await api('post', `/approvals/${id}/cancel`, 'employee')).status).toBe(404);
    expect((await api('post', `/approvals/${id}/decision`, 'manager', { decision: 'APPROVE' })).status).toBe(409);
  });

  it('decisions are audited and validated', async () => {
    const r = await submit('employee');
    const id = r.body.data.id;
    expect((await api('post', `/approvals/${id}/decision`, 'manager', { decision: 'MAYBE' })).status).toBe(422);
    await api('post', `/approvals/${id}/decision`, 'manager', { decision: 'APPROVE' });
    expect(await AuditLog.countDocuments({ tenantId: a.tenantId, action: 'approval.approve', entityId: id })).toBe(1);
  });

  it('is isolated per company', async () => {
    const r = await submit('employee');
    expect((await api('get', `/approvals/${r.body.data.id}`, 'owner', undefined, b)).status).toBe(404);
    expect((await submit('owner', 'LEAVE_X', b)).status).toBe(404); // b has no workflow
  });
});

describe('delegation', () => {
  it('a delegate can act while the delegation is active, and the step records who they acted for', async () => {
    const r = await submit('employee');
    const id = r.body.data.id;
    const dec = () => api('post', `/approvals/${id}/decision`, 'payroll', { decision: 'APPROVE' });
    expect((await dec()).status).toBe(404);

    const from = new Date(Date.now() - 3600e3).toISOString();
    const to = new Date(Date.now() + 86400e3).toISOString();
    const d = await api('post', '/approval-delegations', 'manager', { delegateEmployeeId: String(a.people.payroll.employeeId), from, to });
    expect(d.status).toBe(201);
    const inbox = await api('get', '/approvals?scope=inbox', 'payroll');
    expect(inbox.body.data.map((x: { id: string }) => x.id)).toContain(id);
    const ok = await dec();
    expect(ok.status).toBe(200);
    expect(ok.body.data.steps[0].onBehalfOfEmployeeId).toBe(String(a.people.manager.employeeId));

    const r2 = await submit('employee');
    await api('post', `/approval-delegations/${d.body.data.id}/revoke`, 'manager');
    expect((await api('post', `/approvals/${r2.body.data.id}/decision`, 'payroll', { decision: 'APPROVE' })).status).toBe(404);
  });

  it('a requester cannot use a delegation to approve their own request', async () => {
    const from = new Date(Date.now() - 3600e3).toISOString();
    const to = new Date(Date.now() + 86400e3).toISOString();
    await api('post', '/approval-delegations', 'manager', { delegateEmployeeId: String(a.people.employee.employeeId), from, to });
    const r = await submit('employee');
    expect((await api('post', `/approvals/${r.body.data.id}/decision`, 'employee', { decision: 'APPROVE' })).status).toBe(403);
  });

  it('validates delegations', async () => {
    const now = Date.now();
    const iso = (ms: number) => new Date(now + ms).toISOString();
    const me = String(a.people.manager.employeeId);
    const other = String(a.people.hr.employeeId);
    const post = (body: object) => api('post', '/approval-delegations', 'manager', body);
    expect((await post({ delegateEmployeeId: me, from: iso(0), to: iso(1e6) })).status).toBe(400);
    expect((await post({ delegateEmployeeId: other, from: iso(1e6), to: iso(0) })).status).toBe(400);
    expect((await post({ delegateEmployeeId: other, from: iso(0), to: iso(100 * 864e5) })).status).toBe(400);
    expect((await post({ delegateEmployeeId: String(b.people.owner.employeeId), from: iso(0), to: iso(1e6) })).status).toBe(400);
    expect((await api('get', '/approval-delegations', 'manager')).status).toBe(200);
  });
});
