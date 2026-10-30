import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/database/models/auditLog.model';
import { escalateOverdue } from '../src/modules/approvals/approvals.service';
import { addPerson, bearer, createTenant, loginAs, startTestApp, stopTestApp, type TestTenant } from './helpers';

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

  it('conditional steps are skipped when the request does not meet them, and applied when it does', async () => {
    const wf = await api('post', '/approval-workflows', 'hr', {
      name: 'Cond',
      requestType: 'COND_X',
      steps: [
        { approverType: 'MANAGER' },
        { approverType: 'ROLE', role: 'HR_ADMIN', condition: { field: 'days', op: 'GT', value: 3 } },
      ],
    });
    expect(wf.status, JSON.stringify(wf.body)).toBe(201);
    expect(wf.body.data.steps[1].condition).toEqual({ field: 'days', op: 'GT', value: 3 });
    const raise = (details?: object) =>
      api('post', '/approvals', 'employee', { requestType: 'COND_X', title: 'Cond', ...(details ? { details } : {}) });

    // 2 days: the HR step is skipped, so the manager's approval completes the request
    const short = await raise({ days: 2 });
    expect(short.body.data.steps[1].status).toBe('SKIPPED');
    expect(short.body.data.steps[1].skippedReason).toBe('CONDITION');
    const done = await api('post', `/approvals/${short.body.data.id}/decision`, 'manager', { decision: 'APPROVE' });
    expect(done.body.data.status).toBe('APPROVED');

    // 5 days: HR must approve too
    const long = await raise({ days: 5 });
    expect(long.body.data.steps[1].status).toBe('WAITING');
    const mid = await api('post', `/approvals/${long.body.data.id}/decision`, 'manager', { decision: 'APPROVE' });
    expect(mid.body.data.status).toBe('PENDING');
    expect(mid.body.data.currentStep).toBe(1);

    // no days in the details: fail safe, the step applies
    const unknown = await raise();
    expect(unknown.body.data.steps[1].status).toBe('WAITING');
  });

  it('rejects workflows where every step is conditional, and malformed conditions', async () => {
    const cond = { field: 'days', op: 'GT', value: 3 };
    const base = { name: 'Bad', requestType: 'BADC' };
    expect((await api('post', '/approval-workflows', 'hr', { ...base, steps: [{ approverType: 'MANAGER', condition: cond }] })).status).toBe(422);
    const ok = { approverType: 'MANAGER' };
    expect((await api('post', '/approval-workflows', 'hr', { ...base, steps: [ok, { approverType: 'ROLE', role: 'HR_ADMIN', condition: { ...cond, value: 'many' } }] })).status).toBe(422);
    expect((await api('post', '/approval-workflows', 'hr', { ...base, steps: [ok, { approverType: 'ROLE', role: 'HR_ADMIN', condition: { ...cond, field: 'a b' } }] })).status).toBe(422);
    expect((await api('post', '/approval-workflows', 'hr', { ...base, steps: [ok, { approverType: 'ROLE', role: 'HR_ADMIN', condition: { ...cond, op: 'LIKE' } }] })).status).toBe(422);
    // an existing workflow cannot be edited into the same trap
    const w = await api('post', '/approval-workflows', 'hr', { ...base, steps: [ok] });
    expect(w.status).toBe(201);
    expect((await api('patch', `/approval-workflows/${w.body.data.id}`, 'hr', { steps: [{ approverType: 'MANAGER', condition: cond }] })).status).toBe(422);
  });

  it('escalates an overdue step by adding approvers, once, measured from when that step began', async () => {
    const wf = await api('post', '/approval-workflows', 'hr', {
      name: 'Esc',
      requestType: 'ESC_X',
      steps: [
        { approverType: 'MANAGER', escalation: { afterHours: 2, approverType: 'ROLE', role: 'HR_ADMIN' } },
      ],
    });
    expect(wf.status, JSON.stringify(wf.body)).toBe(201);
    expect(wf.body.data.steps[0].escalation).toMatchObject({ afterHours: 2, approverType: 'ROLE', role: 'HR_ADMIN' });
    const hours = (n: number) => new Date(Date.now() + n * 3_600_000);
    const r = await api('post', '/approvals', 'employee', { requestType: 'ESC_X', title: 'Slow one' });
    const id = r.body.data.id;
    const decide = (who: string) => api('post', `/approvals/${id}/decision`, who, { decision: 'APPROVE' });

    expect((await decide('hr')).status).toBe(404); // not an approver yet
    expect((await escalateOverdue(a.tenantId, hours(1))).escalated).toBe(0); // not overdue
    const run = await escalateOverdue(a.tenantId, hours(3));
    expect(run.escalated).toBe(1);
    expect(run.notify.map((n) => String(n.employeeId))).toContain(String(a.people.hr.employeeId));
    expect((await escalateOverdue(a.tenantId, hours(4))).escalated).toBe(0); // only once

    const view = await api('get', `/approvals/${id}`, 'employee');
    expect(view.body.data.steps[0].escalatedAt).toBeTruthy();
    expect(view.body.data.steps[0].approverNames.length).toBeGreaterThan(1);
    // the original approver can still act, and so can the escalation approver
    const done = await decide('hr');
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe('APPROVED');

    // a request that was already decided is never escalated
    const r2 = await api('post', '/approvals', 'employee', { requestType: 'ESC_X', title: 'Quick one' });
    expect((await api('post', `/approvals/${r2.body.data.id}/decision`, 'manager', { decision: 'APPROVE' })).status).toBe(200);
    expect((await escalateOverdue(a.tenantId, hours(10))).escalated).toBe(0);

    // the clock for step 2 starts when step 2 starts, not when the request was raised
    const two = await api('post', '/approval-workflows', 'hr', {
      name: 'Esc2',
      requestType: 'ESC_Y',
      steps: [
        { approverType: 'MANAGER' },
        { approverType: 'ROLE', role: 'HR_ADMIN', escalation: { afterHours: 1, approverType: 'ROLE', role: 'COMPANY_OWNER' } },
      ],
    });
    expect(two.status).toBe(201);
    const r3 = await api('post', '/approvals', 'employee', { requestType: 'ESC_Y', title: 'Two step' });
    await api('post', `/approvals/${r3.body.data.id}/decision`, 'manager', { decision: 'APPROVE' });
    expect((await escalateOverdue(a.tenantId, new Date(Date.now() + 20 * 60_000))).escalated).toBe(0);
    expect((await escalateOverdue(a.tenantId, hours(2))).escalated).toBe(1);
  });

  it('steps can need every approver or a quorum, each person counts once, and one rejection ends it', async () => {
    const extra = [] as { key: string; id: unknown }[];
    for (const key of ['par2', 'par3']) {
      const p = await addPerson(a.tenantId, 'appr-a', key, ['MANAGER'], a.department);
      tok[`a-${key}`] = await loginAs(app, p.email);
      extra.push({ key, id: p.employeeId });
    }
    const mk = (requestType: string, step: object) =>
      api('post', '/approval-workflows', 'hr', { name: requestType, requestType, steps: [{ approverType: 'ROLE', role: 'MANAGER', ...step }] });
    expect((await mk('PAR_ALL', { mode: 'ALL' })).status).toBe(201);
    expect((await mk('PAR_Q', { mode: 'QUORUM', quorum: 2 })).status).toBe(201);
    const raise = (type: string) => api('post', '/approvals', 'employee', { requestType: type, title: 'Parallel' });
    const dec = (id: string, who: string, decision = 'APPROVE') => api('post', `/approvals/${id}/decision`, who, { decision });
    const inbox = async (who: string) => (await api('get', '/approvals?scope=inbox&limit=100', who)).body.data.map((r: { id: string }) => r.id);

    // ALL: three managers must each approve
    const all = await raise('PAR_ALL');
    const id = all.body.data.id;
    expect(all.body.data.steps[0]).toMatchObject({ mode: 'ALL', required: 3, approvedCount: 0 });
    expect(await inbox('par2')).toContain(id);
    const first = await dec(id, 'par2');
    expect(first.body.data.status).toBe('PENDING');
    expect(first.body.data.steps[0].approvedCount).toBe(1);
    expect((await dec(id, 'par2')).status).toBe(409); // once per person
    expect(await inbox('par2')).not.toContain(id); // nothing left for them to do
    expect(await inbox('manager')).toContain(id);
    expect((await dec(id, 'employee2')).status).toBe(404); // not an approver
    // two approve at the same moment: nobody's approval is lost
    const both = await Promise.all([dec(id, 'manager'), dec(id, 'par3')]);
    expect(both.every((r) => [200, 409].includes(r.status))).toBe(true);
    for (const [who, r] of [['manager', both[0]], ['par3', both[1]]] as const)
      if (r!.status === 409) expect((await dec(id, who)).status).toBe(200);
    const final = await api('get', `/approvals/${id}`, 'employee');
    expect(final.body.data.status).toBe('APPROVED');
    expect(final.body.data.steps[0].approvedCount).toBe(3);

    // one rejection ends it straight away, whatever the others did
    const rej = await raise('PAR_ALL');
    await dec(rej.body.data.id, 'par2');
    const out = await dec(rej.body.data.id, 'par3', 'REJECT');
    expect(out.body.data.status).toBe('REJECTED');

    // QUORUM 2 of 3
    const q = await raise('PAR_Q');
    expect(q.body.data.steps[0]).toMatchObject({ mode: 'QUORUM', required: 2 });
    expect((await dec(q.body.data.id, 'par2')).body.data.status).toBe('PENDING');
    expect((await dec(q.body.data.id, 'par3')).body.data.status).toBe('APPROVED');
  });

  it('validates mode and quorum', async () => {
    const mk = (step: object, requestType: string) =>
      api('post', '/approval-workflows', 'hr', { name: 'M', requestType, steps: [{ approverType: 'MANAGER', ...step }] });
    expect((await mk({ mode: 'QUORUM' }, 'MODV1')).status).toBe(422);
    expect((await mk({ mode: 'ALL', quorum: 2 }, 'MODV2')).status).toBe(422);
    expect((await mk({ mode: 'QUORUM', quorum: 1 }, 'MODV3')).status).toBe(422);
    expect((await mk({ mode: 'SOME' }, 'MODV4')).status).toBe(422);
    expect((await mk({ mode: 'QUORUM', quorum: 2 }, 'MODV5')).status).toBe(201);
  });

  it('validates escalation rules', async () => {
    const mk = (escalation: object, requestType: string) =>
      api('post', '/approval-workflows', 'hr', { name: 'E', requestType, steps: [{ approverType: 'MANAGER', escalation }] });
    expect((await mk({ afterHours: 0, approverType: 'MANAGER' }, 'ESCV1')).status).toBe(422);
    expect((await mk({ afterHours: 1000, approverType: 'MANAGER' }, 'ESCV2')).status).toBe(422);
    expect((await mk({ afterHours: 4, approverType: 'ROLE' }, 'ESCV3')).status).toBe(422);
    expect((await mk({ afterHours: 4, approverType: 'MANAGER', extra: 1 }, 'ESCV4')).status).toBe(422);
    expect((await mk({ afterHours: 4, approverType: 'EMPLOYEE', employeeId: '64b64b64b64b64b64b64b64b' }, 'ESCV5')).status).toBe(400);
    expect((await mk({ afterHours: 4, approverType: 'MANAGER', level: 2 }, 'ESCV6')).status).toBe(201);
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
