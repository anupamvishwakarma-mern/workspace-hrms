import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AttendanceDay } from '../src/database/models/attendanceDay.model';
import { AttendanceEvent } from '../src/database/models/attendanceEvent.model';
import { AuditLog } from '../src/database/models/auditLog.model';
import { Employee } from '../src/database/models/employee.model';
import { addDays, dayOfWeek } from '../src/modules/attendance/dates';
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
let beta: TestTenant;
let clock: FakeClock;
const tok: Record<string, string> = {};
const call = (m: 'get' | 'post' | 'patch' | 'delete', who: string, path: string, body?: object) => {
  const r = request(app)[m](`/api/v1${path}`).set(bearer(tok[who]!));
  return body ? r.send(body) : r;
};
const eid = (k: keyof TestTenant['people']) => String(t.people[k].employeeId);

async function seedMonth(
  who: keyof TestTenant['people'],
  from: string,
  to: string,
  special: Record<string, string> = {},
) {
  for (let d = from; d <= to; d = addDays(d, 1))
    await AttendanceDay.create({
      tenantId: t.tenantId,
      employeeId: t.people[who].employeeId,
      workDate: d,
      status: special[d] ?? (dayOfWeek(d) === 0 ? 'WEEKLY_OFF' : 'PRESENT'),
      calculationVersion: 1,
    });
}

const structure = (employeeId: string, over: object = {}) => ({
  employeeId,
  effectiveFrom: '2026-03-01',
  components: [
    { code: 'BASIC', name: 'Basic', kind: 'EARNING', calc: 'FIXED', amount: 30000 },
    { code: 'HRA', name: 'HRA', kind: 'EARNING', calc: 'PERCENT_OF_BASIC', percent: 40 },
    {
      code: 'TRAVEL',
      name: 'Travel',
      kind: 'EARNING',
      calc: 'FIXED',
      amount: 2000,
      prorate: false,
    },
    { code: 'PF', name: 'PF', kind: 'DEDUCTION', calc: 'PERCENT_OF_BASIC', percent: 12 },
  ],
  ...over,
});

beforeAll(async () => {
  clock = new FakeClock(ist('2026-04-10', '12:00'));
  ({ app } = await startTestApp({}, { clock }));
  t = await createTenant('acme');
  beta = await createTenant('beta');
  await setupSchedule(t);
  for (const k of Object.keys(t.people) as (keyof TestTenant['people'])[])
    tok[k] = await loginAs(app, t.people[k].email);
  tok.betaHr = await loginAs(app, beta.people.hr.email);
  await Employee.updateOne(
    { _id: t.people.employee.employeeId },
    { joiningDate: new Date('2026-01-01') },
  );
});
afterAll(stopTestApp);

describe('payroll', () => {
  let runId = '';
  let slipId = '';

  it('limits salary structures to payroll managers, blocks self-editing, validates shape', async () => {
    const ok = await call('post', 'hr', '/payroll/structures', structure(eid('employee')));
    expect(ok.status).toBe(201);
    expect(ok.body.data.components[0].value).toBe(3_000_000);
    expect(ok.body.data.components[1].value).toBe(4000);
    for (const who of ['employee', 'manager'])
      expect(
        (await call('post', who, '/payroll/structures', structure(eid('employee2')))).status,
      ).toBe(403);
    expect((await call('post', 'hr', '/payroll/structures', structure(eid('hr')))).status).toBe(
      403,
    );
    expect(
      (await call('post', 'payroll', '/payroll/structures', structure(eid('employee2')))).status,
    ).toBe(201);
    expect(
      (
        await call(
          'post',
          'hr',
          '/payroll/structures',
          structure(eid('manager'), {
            components: [{ code: 'HRA', name: 'HRA', kind: 'EARNING', calc: 'FIXED', amount: 5 }],
          }),
        )
      ).status,
    ).toBe(422);
    expect(
      (await call('post', 'hr', '/payroll/structures', { ...structure(eid('manager')), extra: 1 }))
        .status,
    ).toBe(422);
    expect(
      (await call('post', 'betaHr', '/payroll/structures', structure(eid('employee')))).status,
    ).toBe(404);
    expect(
      (await call('get', 'employee', `/payroll/structures?employeeId=${eid('employee')}`)).status,
    ).toBe(403);
    expect(
      (await call('get', 'hr', `/payroll/structures?employeeId=${eid('employee')}`)).body.data,
    ).toHaveLength(1);
    const mine = await call('get', 'employee', '/payroll/my/structure');
    expect(mine.body.data.components).toHaveLength(4);
    expect((await call('get', 'manager', '/payroll/my/structure')).body.data).toBeNull();
  });

  it('refuses a month that has not ended, and calculates a finished month from attendance', async () => {
    expect((await call('post', 'hr', '/payroll/runs', { month: '2026-04' })).body.error.code).toBe(
      'MONTH_NOT_COMPLETE',
    );
    expect((await call('post', 'hr', '/payroll/runs', { month: '2026-13' })).status).toBe(422);
    await seedMonth('employee', '2026-03-01', '2026-03-31', {
      '2026-03-04': 'ABSENT',
      '2026-03-05': 'ABSENT',
      '2026-03-06': 'HALF_DAY',
    });
    await seedMonth('employee2', '2026-03-01', '2026-03-31');
    const run = await call('post', 'hr', '/payroll/runs', { month: '2026-03' });
    expect(run.status).toBe(201);
    runId = run.body.data.id;
    expect(run.body.data.status).toBe('DRAFT');
    expect(run.body.data.totals.employees).toBe(2);
    expect(run.body.data.skipped.map((s: { reason: string }) => s.reason)).toContain(
      'NO_SALARY_STRUCTURE',
    );

    const detail = await call('get', 'hr', `/payroll/runs/${runId}`);
    const slip = detail.body.data.payslips.find(
      (p: { employeeId: string }) => p.employeeId === eid('employee'),
    );
    slipId = slip.id;
    const full = (await call('get', 'hr', `/payroll/payslips/${slipId}`)).body.data;
    expect(full.attendance).toMatchObject({
      daysInMonth: 31,
      lopDays: 2.5,
      payableDays: 28.5,
      absentDays: 2,
      halfDays: 1,
      weeklyOffs: 5,
      presentDays: 23,
    });
    const basic = full.lines.find((l: { code: string }) => l.code === 'BASIC');
    expect(basic.fullMinor).toBe(3_000_000);
    expect(basic.amountMinor).toBe(Math.round((3_000_000 * 28.5) / 31));
    expect(full.lines.find((l: { code: string }) => l.code === 'TRAVEL').amountMinor).toBe(200_000);
    expect(full.netMinor).toBe(full.grossMinor - full.deductionsMinor);
    expect(JSON.stringify(full)).not.toMatch(/tenantId/);
  });

  it('keeps drafts private, regenerates drafts, then publishes and freezes the month', async () => {
    expect((await call('get', 'employee', '/payroll/my/payslips')).body.data).toHaveLength(0);
    expect((await call('get', 'employee', `/payroll/payslips/${slipId}`)).status).toBe(404);
    expect((await call('get', 'employee', `/payroll/runs/${runId}`)).status).toBe(403);

    const again = await call('post', 'hr', '/payroll/runs', { month: '2026-03' });
    expect(again.status).toBe(201);
    expect(again.body.data.id).toBe(runId);
    expect((await call('get', 'hr', `/payroll/runs/${runId}`)).body.data.payslips).toHaveLength(2);

    const pub = await call('post', 'payroll', `/payroll/runs/${runId}/publish`);
    expect(pub.status).toBe(200);
    expect(pub.body.data.status).toBe('PUBLISHED');
    expect((await call('post', 'hr', `/payroll/runs/${runId}/publish`)).status).toBe(409);
    expect((await call('post', 'hr', '/payroll/runs', { month: '2026-03' })).status).toBe(409);

    const list = await call('get', 'employee', '/payroll/my/payslips');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].month).toBe('2026-03');
    expect(
      (await call('get', 'employee', `/payroll/payslips/${list.body.data[0].id}`)).status,
    ).toBe(200);
    // other people, even a manager, cannot read it; another company cannot either
    for (const who of ['employee2', 'manager', 'betaHr'])
      expect((await call('get', who, `/payroll/payslips/${slipId}`)).status).toBe(404);
    expect(
      await AuditLog.countDocuments({ action: 'payroll.payslip_viewed' }),
    ).toBeGreaterThanOrEqual(1);
  });

  it('refuses to publish when any net pay is negative', async () => {
    await call('post', 'hr', '/payroll/structures', {
      employeeId: eid('manager'),
      effectiveFrom: '2026-02-01',
      components: [
        { code: 'BASIC', name: 'Basic', kind: 'EARNING', calc: 'FIXED', amount: 1000 },
        { code: 'LOAN', name: 'Loan', kind: 'DEDUCTION', calc: 'FIXED', amount: 5000 },
      ],
    });
    await seedMonth('manager', '2026-02-01', '2026-02-28');
    const run = await call('post', 'hr', '/payroll/runs', { month: '2026-02' });
    expect(run.status).toBe(201);
    const slips = (await call('get', 'hr', `/payroll/runs/${run.body.data.id}`)).body.data.payslips;
    expect(slips[0].warnings).toContain('NEGATIVE_NET');
    const pub = await call('post', 'hr', `/payroll/runs/${run.body.data.id}/publish`);
    expect(pub.status).toBe(422);
    expect(pub.body.error.code).toBe('NEGATIVE_NET');
  });
});

describe('letters', () => {
  let templateId = '';
  let letterId = '';

  it('only HR/owner manage templates, and unknown placeholders are refused', async () => {
    const body = {
      title: 'Experience letter',
      category: 'EXPERIENCE',
      body: 'This certifies that {{employee.name}} worked at {{company.name}} as {{employee.designation}} on {{date.today}}.',
    };
    expect((await call('post', 'employee', '/letter-templates', body)).status).toBe(403);
    expect((await call('post', 'manager', '/letter-templates', body)).status).toBe(403);
    expect(
      (
        await call('post', 'hr', '/letter-templates', {
          ...body,
          body: 'Hello {{employee.salary}} {{nope}}',
        })
      ).body.error.code,
    ).toBe('UNKNOWN_PLACEHOLDER');
    const ok = await call('post', 'hr', '/letter-templates', body);
    expect(ok.status).toBe(201);
    templateId = ok.body.data.id;
    expect((await call('get', 'owner', '/letter-templates')).body.data).toHaveLength(1);
    expect((await call('get', 'betaHr', '/letter-templates')).body.data).toHaveLength(0);
  });

  it('fills placeholders once, fails on missing data, numbers letters, and shows them only to the employee', async () => {
    const missing = await call('post', 'hr', '/letters', {
      employeeId: eid('employee'),
      templateId,
    });
    expect(missing.status).toBe(422);
    expect(missing.body.error.code).toBe('MISSING_PLACEHOLDER_VALUE');
    await Employee.updateOne({ _id: t.people.employee.employeeId }, { designation: 'Engineer' });
    const ok = await call('post', 'hr', '/letters', { employeeId: eid('employee'), templateId });
    expect(ok.status).toBe(201);
    letterId = ok.body.data.id;
    expect(ok.body.data.referenceNo).toBe('LTR-2026-0001');
    expect(ok.body.data.body).toBe(
      'This certifies that employee acme worked at Company acme as Engineer on 10 April 2026.',
    );
    expect(
      (await call('post', 'hr', '/letters', { employeeId: eid('employee'), templateId })).body.data
        .referenceNo,
    ).toBe('LTR-2026-0002');

    // editing the template later does not touch the issued text
    await call('patch', 'hr', `/letter-templates/${templateId}`, {
      body: 'Something completely different now.',
    });
    expect((await call('get', 'employee', `/letters/${letterId}`)).body.data.body).toMatch(
      /certifies/,
    );

    expect((await call('get', 'employee', '/letters/my')).body.data).toHaveLength(2);
    expect((await call('get', 'employee2', '/letters/my')).body.data).toHaveLength(0);
    for (const who of ['employee2', 'manager', 'betaHr'])
      expect((await call('get', who, `/letters/${letterId}`)).status).toBe(404);
    expect((await call('get', 'hr', `/letters/${letterId}`)).status).toBe(200);
    expect(
      (await call('post', 'employee', '/letters', { employeeId: eid('employee'), templateId }))
        .status,
    ).toBe(403);
    expect((await call('get', 'employee', '/letters')).status).toBe(403);
  });

  it('supports salary placeholders for payroll managers, custom text, and revoking', async () => {
    const sal = await call('post', 'hr', '/letters', {
      employeeId: eid('employee'),
      title: 'Salary certificate',
      category: 'SALARY_CERTIFICATE',
      body: 'Monthly gross salary: {{salary.monthlyGross}}. Annual: {{salary.annualGross}}.',
    });
    expect(sal.status).toBe(201);
    expect(sal.body.data.body).toBe('Monthly gross salary: INR 44,000.00. Annual: INR 528,000.00.');
    const rev = await call('post', 'hr', `/letters/${letterId}/revoke`, {
      reason: 'Issued in error',
    });
    expect(rev.body.data.status).toBe('REVOKED');
    expect(
      (await call('post', 'hr', `/letters/${letterId}/revoke`, { reason: 'again again' })).status,
    ).toBe(404);
    expect((await call('get', 'employee', `/letters/${letterId}`)).body.data.status).toBe(
      'REVOKED',
    );
  });
});

describe('handbook', () => {
  it('HR writes sections; employees read only published ones', async () => {
    const body = { title: 'Leave policy', body: '## Casual leave\n- 12 days a year', order: 2 };
    expect((await call('post', 'employee', '/handbook', body)).status).toBe(403);
    expect((await call('post', 'manager', '/handbook', body)).status).toBe(403);
    const draft = await call('post', 'hr', '/handbook', body);
    expect(draft.status).toBe(201);
    expect(draft.body.data.status).toBe('DRAFT');
    const pub = await call('post', 'owner', '/handbook', {
      title: 'Welcome',
      body: 'Hello team',
      order: 1,
      status: 'PUBLISHED',
    });
    expect(pub.body.data.status).toBe('PUBLISHED');

    expect(
      (await call('get', 'employee', '/handbook')).body.data.map((s: { title: string }) => s.title),
    ).toEqual(['Welcome']);
    // an employee asking for drafts simply does not get them
    expect((await call('get', 'employee', '/handbook?includeDrafts=true')).body.data).toHaveLength(
      1,
    );
    expect(
      (await call('get', 'hr', '/handbook?includeDrafts=true')).body.data.map(
        (s: { title: string }) => s.title,
      ),
    ).toEqual(['Welcome', 'Leave policy']);
    expect((await call('get', 'betaHr', '/handbook?includeDrafts=true')).body.data).toHaveLength(0);

    await call('patch', 'hr', `/handbook/${draft.body.data.id}`, { status: 'PUBLISHED' });
    expect((await call('get', 'employee', '/handbook')).body.data).toHaveLength(2);
    expect((await call('delete', 'employee', `/handbook/${draft.body.data.id}`)).status).toBe(403);
    expect((await call('delete', 'betaHr', `/handbook/${draft.body.data.id}`)).status).toBe(404);
    expect((await call('delete', 'hr', `/handbook/${draft.body.data.id}`)).status).toBe(204);
  });
});

describe('team today', () => {
  it('managers see their reports, HR sees everyone else, employees see nothing', async () => {
    await AttendanceEvent.create({
      tenantId: t.tenantId,
      employeeId: t.people.employee.employeeId,
      eventType: 'CHECK_IN',
      occurredAt: new Date(clock.now().getTime() - 3_600_000),
      receivedAt: clock.now(),
      workDate: '2026-04-10',
      verification: { status: 'NOT_REQUIRED' },
      idempotencyKey: 'team-test-key-1',
    });
    const mgr = await call('get', 'manager', '/team/today');
    expect(mgr.status).toBe(200);
    expect(mgr.body.data.members.map((m: { name: string }) => m.name)).toEqual(['employee acme']);
    expect(mgr.body.data.members[0].status).toBe('WORKING');
    expect(mgr.body.data.counts.WORKING).toBe(1);
    expect(JSON.stringify(mgr.body)).not.toMatch(/location|coordinates|photo/);

    const hr = await call('get', 'hr', '/team/today');
    expect(hr.body.data.members).toHaveLength(5); // everyone except HR themself
    expect(
      hr.body.data.members.find((m: { name: string }) => m.name === 'employee2 acme').status,
    ).toBe('NOT_IN');
    expect((await call('get', 'employee', '/team/today')).status).toBe(403);
    expect((await call('get', 'betaHr', '/team/today')).body.data.members).toHaveLength(5);
  });
});
