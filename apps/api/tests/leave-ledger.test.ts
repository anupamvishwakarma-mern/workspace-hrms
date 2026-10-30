import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/database/models/auditLog.model';
import { Employee } from '../src/database/models/employee.model';
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
let other: TestTenant;
const tok: Record<string, string> = {};
const call = (m: 'get' | 'post' | 'patch', who: string, path: string, body?: object) => {
  const r = request(app)[m](`/api/v1${path}`).set(bearer(tok[who]!));
  return body ? r.send(body) : r;
};
let monthly: string;
let carry: string;
let annual: string;
const balance = async (who: string, typeId: string, year = 2026, employeeId?: string) => {
  const r = await call('get', who, `/leave/balances?year=${year}${employeeId ? `&employeeId=${employeeId}` : ''}`);
  return r.body.data.find((b: { leaveTypeId: string }) => b.leaveTypeId === typeId);
};
const eid = (k: keyof TestTenant['people']) => String(t.people[k].employeeId);

beforeAll(async () => {
  ({ app } = await startTestApp({}, { clock: new FakeClock(ist('2026-03-05', '12:00')) }));
  t = await createTenant('ledger');
  other = await createTenant('ledger-other');
  await setupSchedule(t);
  // employee2 joins in March 2026, so January and February must never credit them.
  await Employee.updateOne({ _id: t.people.employee2.employeeId, tenantId: t.tenantId }, { $set: { joiningDate: new Date('2026-03-01T00:00:00Z') } });
  for (const k of Object.keys(t.people) as (keyof TestTenant['people'])[])
    tok[k] = await loginAs(app, t.people[k].email);
  tok.otherHr = await loginAs(app, other.people.hr.email);
  monthly = (await call('post', 'hr', '/leave-types', { name: 'Earned', code: 'ERN', annualAllowanceDays: 12, accrualMode: 'MONTHLY', carryForwardMaxDays: 5 })).body.data.id;
  annual = (await call('post', 'hr', '/leave-types', { name: 'Annual', code: 'ANN', annualAllowanceDays: 5 })).body.data.id;
  carry = (await call('post', 'hr', '/leave-types', { name: 'Carry', code: 'CRY', annualAllowanceDays: 10, carryForwardMaxDays: 4 })).body.data.id;
});
afterAll(stopTestApp);

describe('leave types with a policy', () => {
  it('default to the original behaviour; policy fields are validated', async () => {
    const list = await call('get', 'hr', '/leave-types');
    const ann = list.body.data.find((x: { id: string }) => x.id === annual);
    expect(ann.accrualMode).toBe('ANNUAL');
    expect(ann.carryForwardMaxDays).toBe(0);
    expect((await call('post', 'hr', '/leave-types', { name: 'Bad', code: 'BAD', accrualMode: 'WEEKLY' })).status).toBe(422);
    expect((await call('post', 'hr', '/leave-types', { name: 'Bad', code: 'BAD', carryForwardMaxDays: -1 })).status).toBe(422);
  });
});

describe('monthly accrual', () => {
  it('nothing is available until credited', async () => {
    expect((await balance('employee', monthly)).allowanceDays).toBe(0);
    const r = await call('post', 'employee', '/leave/requests', { leaveTypeId: monthly, startDate: '2026-03-02', endDate: '2026-03-02' });
    expect(r.status).toBe(422);
  });

  it('only HR runs it; future months are refused; reruns add nothing', async () => {
    expect((await call('post', 'employee', '/leave/ledger/accrue', { month: '2026-01' })).status).toBe(403);
    expect((await call('post', 'manager', '/leave/ledger/accrue', { month: '2026-01' })).status).toBe(403);
    expect((await call('post', 'hr', '/leave/ledger/accrue', { month: '2026-4' })).status).toBe(422);
    expect((await call('post', 'hr', '/leave/ledger/accrue', { month: '2026-04' })).status).toBe(422);
    const first = await call('post', 'hr', '/leave/ledger/accrue', { month: '2026-01' });
    expect(first.status).toBe(200);
    expect(first.body.data.entriesCreated).toBe(5); // everyone except employee2, who joins in March
    expect((await call('post', 'hr', '/leave/ledger/accrue', { month: '2026-01' })).body.data.entriesCreated).toBe(0);
    await call('post', 'hr', '/leave/ledger/accrue', { month: '2026-02' });
    const b = await balance('employee', monthly);
    expect(b.allowanceDays).toBe(2);
    expect(b.entitlement).toMatchObject({ base: 0, accrued: 2, carriedForward: 0, adjustments: 0, total: 2 });
  });

  it('credited days can be taken, and no more', async () => {
    const ok = await call('post', 'employee', '/leave/requests', { leaveTypeId: monthly, startDate: '2026-03-02', endDate: '2026-03-03' });
    expect(ok.status).toBe(201);
    const over = await call('post', 'employee', '/leave/requests', { leaveTypeId: monthly, startDate: '2026-03-04', endDate: '2026-03-04' });
    expect(over.status).toBe(422);
    expect(over.body.error.message).toMatch(/Insufficient/);
  });

  it('a person is credited only from the month they joined, with no back-fill', async () => {
    expect((await balance('employee2', monthly)).entitlement.accrued).toBe(0); // Jan and Feb skipped them
    await call('post', 'hr', '/leave/ledger/accrue', { month: '2026-03' });
    expect((await balance('employee2', monthly)).entitlement.accrued).toBe(1); // March only
    expect((await balance('employee', monthly)).entitlement.accrued).toBe(3);
  });
});

describe('manual adjustments', () => {
  it('HR adjusts with a reason; it shows in the balance, the ledger and the audit trail', async () => {
    const body = { employeeId: eid('employee'), leaveTypeId: annual, year: 2026, days: 2, reason: 'Granted for weekend work' };
    expect((await call('post', 'employee', '/leave/ledger/adjustments', body)).status).toBe(403);
    expect((await call('post', 'hr', '/leave/ledger/adjustments', { ...body, reason: '' })).status).toBe(422);
    expect((await call('post', 'hr', '/leave/ledger/adjustments', { ...body, days: 0 })).status).toBe(422);
    expect((await call('post', 'hr', '/leave/ledger/adjustments', { ...body, days: 0.3 })).status).toBe(422);
    expect((await call('post', 'hr', '/leave/ledger/adjustments', { ...body, employeeId: String(other.people.employee.employeeId) })).status).toBe(404);
    const ok = await call('post', 'hr', '/leave/ledger/adjustments', body);
    expect(ok.status).toBe(201);
    const b = await balance('employee', annual);
    expect(b.allowanceDays).toBe(7); // 5 + 2
    expect(b.entitlement.adjustments).toBe(2);
    const own = await call('get', 'employee', `/leave/ledger?leaveTypeId=${annual}`);
    expect(own.body.data.map((x: { reason: string }) => x.reason)).toContain('Granted for weekend work');
    expect(await AuditLog.countDocuments({ tenantId: t.tenantId, action: 'leave.ledger.adjust' })).toBeGreaterThan(0);
  });

  it('a negative adjustment takes days back', async () => {
    await call('post', 'hr', '/leave/ledger/adjustments', { employeeId: eid('employee'), leaveTypeId: annual, year: 2026, days: -3, reason: 'Corrects double credit' });
    expect((await balance('employee', annual)).allowanceDays).toBe(4);
  });

  it('who can read the ledger', async () => {
    expect((await call('get', 'manager', `/leave/ledger?employeeId=${eid('employee')}`)).status).toBe(200); // direct report
    expect((await call('get', 'manager', `/leave/ledger?employeeId=${eid('employee2')}`)).status).toBe(404);
    expect((await call('get', 'employee', `/leave/ledger?employeeId=${eid('employee2')}`)).status).toBe(404);
    expect((await call('get', 'hr', `/leave/ledger?employeeId=${eid('employee')}`)).status).toBe(200);
    expect((await call('get', 'otherHr', `/leave/ledger?employeeId=${eid('employee')}`)).body.data ?? []).toHaveLength(0);
  });
});

describe('year-end carry-forward', () => {
  it('carries unused days up to the limit, once, and only for a finished year', async () => {
    expect((await call('post', 'employee', '/leave/ledger/carry-forward', { fromYear: 2025 })).status).toBe(403);
    expect((await call('post', 'hr', '/leave/ledger/carry-forward', { fromYear: 2026 })).status).toBe(422);
    const run = await call('post', 'hr', '/leave/ledger/carry-forward', { fromYear: 2025 });
    expect(run.status).toBe(200);
    // "Carry" (10 days, limit 4) carries 4 each for 6 people. "Earned" has nothing credited in 2025.
    expect(run.body.data.entriesCreated).toBe(6);
    expect(run.body.data.daysCarried).toBe(24);
    const b = await balance('employee', carry);
    expect(b.entitlement).toMatchObject({ base: 10, carriedForward: 4, total: 14 });
    expect((await call('post', 'hr', '/leave/ledger/carry-forward', { fromYear: 2025 })).body.data.entriesCreated).toBe(0);
  });
});

describe('isolation', () => {
  it('another company\'s HR cannot adjust this company\'s employees', async () => {
    const r = await call('post', 'otherHr', '/leave/ledger/adjustments', { employeeId: eid('employee'), leaveTypeId: annual, year: 2026, days: 1, reason: 'Should not work' });
    expect(r.status).toBe(404);
  });
});
