import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AttendanceDay } from '../src/database/models/attendanceDay.model';
import { AuditLog } from '../src/database/models/auditLog.model';
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

// Every rate, ceiling and slab in this file is a made-up example. They only exercise the arithmetic.
let app: Express;
let t: TestTenant;
let other: TestTenant;
const tok: Record<string, string> = {};
const call = (m: 'get' | 'post' | 'patch', who: string, path: string, body?: object) => {
  const r = request(app)[m](`/api/v1${path}`).set(bearer(tok[who]!));
  return body ? r.send(body) : r;
};
const eid = (k: keyof TestTenant['people']) => String(t.people[k].employeeId);
const lineOf = (slip: { lines: { code: string }[] }, code: string) =>
  slip.lines.find((l) => l.code === code) as { amountMinor: number; source: string } | undefined;

beforeAll(async () => {
  ({ app } = await startTestApp({}, { clock: new FakeClock(ist('2026-04-05', '12:00')) }));
  t = await createTenant('stat');
  other = await createTenant('stat-other');
  await setupSchedule(t);
  for (const k of Object.keys(t.people) as (keyof TestTenant['people'])[]) tok[k] = await loginAs(app, t.people[k].email);
  tok.otherHr = await loginAs(app, other.people.hr.email);
  for (let d = '2026-03-01'; d <= '2026-03-31'; d = addDays(d, 1))
    await AttendanceDay.create({
      tenantId: t.tenantId,
      employeeId: t.people.employee.employeeId,
      workDate: d,
      status: dayOfWeek(d) === 0 ? 'WEEKLY_OFF' : 'PRESENT',
      calculationVersion: 1,
    });
  const st = await call('post', 'hr', '/payroll/structures', {
    employeeId: eid('employee'),
    effectiveFrom: '2026-03-01',
    components: [
      { code: 'BASIC', name: 'Basic', kind: 'EARNING', calc: 'FIXED', amount: 20000 },
      { code: 'ALLOW', name: 'Allowance', kind: 'EARNING', calc: 'FIXED', amount: 5000 },
    ],
  });
  expect(st.status).toBe(201);
});
afterAll(stopTestApp);

const rulePct = {
  code: 'emp_pct',
  name: 'Example employee contribution',
  party: 'EMPLOYEE',
  method: 'PERCENT',
  percent: 10,
  wageComponents: ['BASIC'],
  wageCeiling: 15000,
  cap: 1200,
  effectiveFrom: '2026-01-01',
  reference: 'Example notification 1/2026',
};
const ruleEmployer = { code: 'EMPR_PCT', name: 'Example employer contribution', party: 'EMPLOYER', method: 'PERCENT', percent: 8, wageComponents: ['BASIC'], effectiveFrom: '2026-01-01' };
const ruleSlab = {
  code: 'SLAB1',
  name: 'Example slab deduction',
  party: 'EMPLOYEE',
  method: 'SLAB',
  slabs: [{ from: 0, to: 10000, amount: 0 }, { from: 10000, to: 30000, amount: 150 }, { from: 30000, amount: 200 }],
  effectiveFrom: '2026-01-01',
};

describe('statutory rules', () => {
  it('are managed by payroll managers only; figures are validated; versions are unique', async () => {
    for (const who of ['employee', 'manager'])
      expect((await call('post', who, '/payroll/statutory-rules', rulePct)).status).toBe(403);
    expect((await call('get', 'employee', '/payroll/statutory-rules')).status).toBe(403);
    expect((await call('post', 'hr', '/payroll/statutory-rules', { ...rulePct, code: 'BAD', percent: undefined })).status).toBe(422);
    expect((await call('post', 'hr', '/payroll/statutory-rules', { ...rulePct, code: 'BAD', fixed: 5 })).status).toBe(422);
    expect((await call('post', 'hr', '/payroll/statutory-rules', { ...ruleSlab, code: 'BAD', slabs: [{ from: 0, to: 100, amount: 1 }, { from: 50, amount: 2 }] })).status).toBe(422);
    expect((await call('post', 'hr', '/payroll/statutory-rules', { ...rulePct, code: 'BAD', percent: 120 })).status).toBe(422);
    const ok = await call('post', 'hr', '/payroll/statutory-rules', rulePct);
    expect(ok.status).toBe(201);
    expect(ok.body.data.code).toBe('EMP_PCT');
    expect(ok.body.data.percent).toBe(10);
    expect(ok.body.data.cap).toBe(1200);
    expect((await call('post', 'hr', '/payroll/statutory-rules', rulePct)).status).toBe(409);
    expect((await call('post', 'payroll', '/payroll/statutory-rules', ruleEmployer)).status).toBe(201);
    expect((await call('post', 'hr', '/payroll/statutory-rules', ruleSlab)).status).toBe(201);
    expect(await AuditLog.countDocuments({ tenantId: t.tenantId, action: 'payroll.statutory.create' })).toBe(3);
  });

  it('are private to the company', async () => {
    expect((await call('get', 'otherHr', '/payroll/statutory-rules')).body.data).toHaveLength(0);
  });
});

describe('adjustments', () => {
  it('are validated, listed and can be voided before publishing', async () => {
    const base = { employeeId: eid('employee'), month: '2026-03', kind: 'EARNING', code: 'bonus', label: 'Example bonus', amount: 3000, reason: 'Quarterly target' };
    expect((await call('post', 'employee', '/payroll/adjustments', base)).status).toBe(403);
    expect((await call('post', 'hr', '/payroll/adjustments', { ...base, amount: 0 })).status).toBe(422);
    expect((await call('post', 'hr', '/payroll/adjustments', { ...base, amount: 10.005 })).status).toBe(422);
    expect((await call('post', 'hr', '/payroll/adjustments', { ...base, reason: '' })).status).toBe(422);
    expect((await call('post', 'hr', '/payroll/adjustments', { ...base, employeeId: String(other.people.employee.employeeId) })).status).toBe(404);
    expect((await call('post', 'hr', '/payroll/adjustments', base)).status).toBe(201);
    const ded = await call('post', 'hr', '/payroll/adjustments', { ...base, kind: 'DEDUCTION', code: 'TDS', label: 'Example tax already deducted', amount: 500 });
    expect(ded.status).toBe(201);
    const mistake = await call('post', 'hr', '/payroll/adjustments', { ...base, label: 'Mistake', amount: 99999 });
    expect((await call('post', 'hr', `/payroll/adjustments/${mistake.body.data.id}/void`)).body.data.status).toBe('VOIDED');
    const list = await call('get', 'hr', '/payroll/adjustments?month=2026-03');
    expect(list.body.data).toHaveLength(3);
    expect(await AuditLog.countDocuments({ tenantId: t.tenantId, action: 'payroll.adjustment.create' })).toBe(3);
  });
});

describe('payroll run with rules and adjustments', () => {
  let runId = '';
  let slipId = '';
  const slip = async () => (await call('get', 'hr', `/payroll/payslips/${slipId}`)).body.data;

  it('adds adjustments, then statutory deductions measured on what was actually paid', async () => {
    // an adjustment for someone with no salary structure is reported, not silently dropped
    await call('post', 'hr', '/payroll/adjustments', { employeeId: eid('employee2'), month: '2026-03', kind: 'EARNING', label: 'Orphan', amount: 100, reason: 'No structure' });
    const run = await call('post', 'hr', '/payroll/runs', { month: '2026-03' });
    expect(run.status).toBe(201);
    runId = run.body.data.id;
    expect(run.body.data.skipped.map((s: { reason: string }) => s.reason)).toContain('ADJUSTMENT_NOT_APPLIED');
    const detail = await call('get', 'hr', `/payroll/runs/${runId}`);
    slipId = detail.body.data.payslips.find((p: { employeeId: string }) => p.employeeId === eid('employee')).id;
    const s = await slip();

    expect(lineOf(s, 'BONUS')).toMatchObject({ amountMinor: 300_000, source: 'ADJUSTMENT' });
    expect(lineOf(s, 'TDS')).toMatchObject({ amountMinor: 50_000, source: 'ADJUSTMENT' });
    // wage 20,000 capped at 15,000 -> 10% = 1,500 -> capped at 1,200
    expect(lineOf(s, 'STAT_EMP_PCT')).toMatchObject({ amountMinor: 120_000, source: 'STATUTORY' });
    // all earnings = 20,000 + 5,000 + 3,000 = 28,000 -> slab 10,000-30,000 -> 150
    expect(lineOf(s, 'STAT_SLAB1')!.amountMinor).toBe(15_000);
    expect(s.grossMinor).toBe(2_800_000);
    expect(s.deductionsMinor).toBe(50_000 + 120_000 + 15_000);
    expect(s.netMinor).toBe(s.grossMinor - s.deductionsMinor);
    // employer side: 8% of 20,000 = 1,600, shown but not deducted
    expect(s.employerLines).toEqual([expect.objectContaining({ code: 'EMPR_PCT', wageMinor: 2_000_000, amountMinor: 160_000 })]);
    expect(s.employerMinor).toBe(160_000);
    expect(lineOf(s, 'STAT_EMPR_PCT')).toBeUndefined();
    expect(detail.body.data.totals.employerMinor).toBe(160_000);
  });

  it('a rule change takes effect on the next regeneration of a draft', async () => {
    const rules = (await call('get', 'hr', '/payroll/statutory-rules')).body.data;
    const pct = rules.find((r: { code: string }) => r.code === 'EMP_PCT');
    // a new version starting mid-March with a higher cap replaces the old one for March
    expect((await call('post', 'hr', '/payroll/statutory-rules', { ...rulePct, code: 'EMP_PCT', effectiveFrom: '2026-03-15', cap: 2500, percent: 20 })).status).toBe(201);
    // a version that starts in April does not touch March
    expect((await call('post', 'hr', '/payroll/statutory-rules', { ...rulePct, code: 'EMP_PCT', effectiveFrom: '2026-04-01', cap: 9999 })).status).toBe(201);
    expect((await call('post', 'hr', '/payroll/runs', { month: '2026-03' })).status).toBe(201);
    const d = await call('get', 'hr', `/payroll/runs/${runId}`);
    slipId = d.body.data.payslips.find((p: { employeeId: string }) => p.employeeId === eid('employee')).id;
    // 20% of 15,000 ceiling = 3,000 -> capped at 2,500
    expect(lineOf(await slip(), 'STAT_EMP_PCT')!.amountMinor).toBe(250_000);
    // switching an old version's method clears the old method's figures
    const sw = await call('patch', 'hr', `/payroll/statutory-rules/${pct.id}`, { method: 'FIXED', fixed: 75 });
    expect(sw.status).toBe(200);
    expect(sw.body.data.fixed).toBe(75);
    expect(sw.body.data.percent).toBeUndefined();
    expect((await call('patch', 'hr', `/payroll/statutory-rules/${pct.id}`, { method: 'PERCENT' })).status).toBe(422);
  });

  it('publishing freezes the month: payslips, adjustments and later rule edits cannot change it', async () => {
    const before = await slip();
    expect((await call('post', 'payroll', `/payroll/runs/${runId}/publish`)).status).toBe(200);
    expect((await call('post', 'hr', '/payroll/adjustments', { employeeId: eid('employee'), month: '2026-03', kind: 'EARNING', label: 'Late', amount: 1, reason: 'too late' })).status).toBe(409);
    const adj = (await call('get', 'hr', '/payroll/adjustments?month=2026-03')).body.data.find((a: { status: string }) => a.status === 'ACTIVE');
    expect((await call('post', 'hr', `/payroll/adjustments/${adj.id}/void`)).status).toBe(409);
    await call('post', 'hr', '/payroll/statutory-rules', { ...ruleSlab, code: 'SLAB1', effectiveFrom: '2026-03-20', slabs: [{ from: 0, amount: 1 }] });
    expect(await slip()).toEqual({ ...before, status: 'PUBLISHED', publishedAt: expect.anything() });
    const mine = await call('get', 'employee', '/payroll/my/payslips');
    const full = await call('get', 'employee', `/payroll/payslips/${mine.body.data[0].id}`);
    expect(lineOf(full.body.data, 'STAT_EMP_PCT')!.amountMinor).toBe(250_000);
    const pdf = await call('get', 'employee', `/payroll/payslips/${mine.body.data[0].id}/pdf`).buffer(true).parse((res, cb) => {
      const c: Buffer[] = [];
      res.on('data', (d: Buffer) => c.push(d));
      res.on('end', () => cb(null, Buffer.concat(c)));
    });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await call('get', 'manager', `/payroll/payslips/${mine.body.data[0].id}/pdf`)).status).toBe(404);
    expect(full.body.data.employerLines).toHaveLength(1);
  });
});
