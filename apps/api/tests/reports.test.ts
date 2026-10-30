import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AttendanceDay } from '../src/database/models/attendanceDay.model';
import { AuditLog } from '../src/database/models/auditLog.model';
import { Employee } from '../src/database/models/employee.model';
import { Holiday } from '../src/database/models/holiday.model';
import {
  FakeClock,
  addPerson,
  bearer,
  createTenant,
  inside,
  ist,
  loginAs,
  newKey,
  setupSchedule,
  startTestApp,
  stopTestApp,
  type TestTenant,
} from './helpers';

let app: Express;
let t: TestTenant;
let beta: TestTenant;
let clock: FakeClock;
let unscheduled: Awaited<ReturnType<typeof addPerson>>;
let lateJoiner: Awaited<ReturnType<typeof addPerson>>;
const tok: Record<string, string> = {};
const MON = '2026-03-02';
const TUE = '2026-03-03';
const WED = '2026-03-04';
const THU = '2026-03-05';

const get = (who: string, path: string) =>
  request(app).get(`/api/v1${path}`).set(bearer(tok[who]!));
const post = (who: string, path: string, body: object = {}) =>
  request(app).post(`/api/v1${path}`).set(bearer(tok[who]!)).send(body);
const at = (d: string, time: string) => clock.set(ist(d, time));
const punch = (who: string, a: string) =>
  post(who, `/attendance/${a}`, { idempotencyKey: newKey(a), location: inside() });
type Row = {
  employeeId: string;
  employeeCode: string;
  present: number;
  absent: number;
  holiday: number;
  late: number;
  lateDays: number;
  weeklyOff: number;
  name: string;
};
const rowFor = (rows: Row[], emp: { employeeId: unknown }) =>
  rows.find((r) => r.employeeId === String(emp.employeeId));

beforeAll(async () => {
  clock = new FakeClock(ist(MON, '08:00'));
  ({ app } = await startTestApp({}, { clock }));
  t = await createTenant('acme');
  beta = await createTenant('beta');
  await setupSchedule(t);
  await setupSchedule(beta);
  // 'unscheduled' has no shift; 'lateJoiner' joined on Wednesday.
  unscheduled = await addPerson(t.tenantId, 'acme', 'unsched', ['EMPLOYEE'], t.department);
  lateJoiner = await addPerson(t.tenantId, 'acme', 'latejoin', ['EMPLOYEE'], t.department);
  const { ShiftAssignment } = await import('../src/database/models/shiftAssignment.model');
  const { Shift } = await import('../src/database/models/shift.model');
  const shift = (await Shift.findOne({ tenantId: t.tenantId }).lean())!;
  await ShiftAssignment.create({
    tenantId: t.tenantId,
    employeeId: lateJoiner.employeeId,
    shiftId: shift._id,
    effectiveFrom: '2026-01-01',
  });
  await Employee.updateOne(
    { _id: lateJoiner.employeeId },
    { $set: { joiningDate: new Date('2026-03-04') } },
  );

  for (const k of Object.keys(t.people) as (keyof TestTenant['people'])[])
    tok[k] = await loginAs(app, t.people[k].email);
  for (const k of Object.keys(beta.people) as (keyof TestTenant['people'])[])
    tok[`beta-${k}`] = await loginAs(app, beta.people[k].email);

  // Monday: employee is on time and works a full day; beta's employee also punches (must never leak).
  at(MON, '09:05');
  await punch('employee', 'check-in');
  await punch('beta-employee', 'check-in');
  at(MON, '13:00');
  await punch('employee', 'break-start');
  at(MON, '14:00');
  await punch('employee', 'break-end');
  at(MON, '18:05');
  await punch('employee', 'check-out');
  await punch('beta-employee', 'check-out');
  // Tuesday: a company holiday.
  await Holiday.create({
    tenantId: t.tenantId,
    name: 'Founders Day',
    date: TUE,
    holidayType: 'COMPANY',
  });
  // Wednesday: employee arrives late (09:40).
  at(WED, '09:40');
  await punch('employee', 'check-in');
  at(WED, '18:00');
  await punch('employee', 'check-out');
  at(THU, '12:00');
});
afterAll(stopTestApp);

const summary = (who: string, qs = `from=${MON}&to=${WED}&limit=100`) =>
  get(who, `/reports/attendance/summary?${qs}`);

describe('summary report', () => {
  it('counts presence, holidays, lateness and absences (including days with no punches)', async () => {
    const res = await summary('hr');
    expect(res.status).toBe(200);
    const rows: Row[] = res.body.data;
    const emp = rowFor(rows, t.people.employee)!;
    expect(emp).toMatchObject({ present: 2, holiday: 1, absent: 0, lateDays: 1 });
    const emp2 = rowFor(rows, t.people.employee2)!;
    expect(emp2).toMatchObject({ present: 0, holiday: 1, absent: 2 }); // Mon + Wed, Tue is a holiday
  });

  it('does not mark unscheduled people absent, and respects the joining date', async () => {
    const rows: Row[] = (await summary('hr')).body.data;
    expect(rowFor(rows, unscheduled)).toMatchObject({ absent: 0, present: 0 });
    // joined Wed: Mon is before joining (not absent); Tue is a holiday that predates joining; Wed is absent (no punch)
    expect(rowFor(rows, lateJoiner)).toMatchObject({ absent: 1, holiday: 0 });
  });

  it('is idempotent and never materialises today', async () => {
    const before = await AttendanceDay.countDocuments({ tenantId: t.tenantId });
    await summary('hr');
    await summary('hr');
    expect(await AttendanceDay.countDocuments({ tenantId: t.tenantId })).toBe(before);
    const rows: Row[] = (await summary('hr', `from=${THU}&to=${THU}&limit=100`)).body.data;
    expect(await AttendanceDay.countDocuments({ tenantId: t.tenantId, workDate: THU })).toBe(0);
    expect(rows.every((r) => r.absent === 0)).toBe(true);
  });

  it('paginates employees and reports the total', async () => {
    const res = await summary('hr', `from=${MON}&to=${WED}&limit=2&page=2`);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(8);
  });

  it('validates the range', async () => {
    expect((await summary('hr', `from=${WED}&to=${MON}`)).status).toBe(422);
    expect((await summary('hr', `from=2025-01-01&to=2026-03-01`)).status).toBe(422);
    expect((await summary('hr', `from=2026-02-30&to=2026-03-01`)).status).toBe(422);
  });
});

describe('who can see what', () => {
  it('plain employees cannot use reports', async () => {
    for (const p of [
      '/reports/dashboard',
      `/reports/attendance/summary?from=${MON}&to=${WED}`,
      `/reports/attendance/export?from=${MON}&to=${WED}`,
    ])
      expect((await get('employee', p)).status).toBe(403);
    expect((await request(app).get('/api/v1/reports/dashboard')).status).toBe(401);
  });

  it('a manager sees only themselves and their direct reports', async () => {
    const rows: Row[] = (await summary('manager')).body.data;
    const ids = rows.map((r) => r.employeeId).sort();
    expect(ids).toEqual(
      [String(t.people.manager.employeeId), String(t.people.employee.employeeId)].sort(),
    );
    // asking for someone outside the scope returns nothing rather than leaking
    const other = await summary(
      'manager',
      `from=${MON}&to=${WED}&employeeId=${t.people.employee2.employeeId}`,
    );
    expect(other.body.data).toEqual([]);
  });

  it('payroll can read summaries and export, HR/owner see everyone', async () => {
    expect((await summary('payroll')).status).toBe(200);
    expect((await get('payroll', `/reports/attendance/export?from=${MON}&to=${WED}`)).status).toBe(
      200,
    );
    expect((await summary('owner')).body.meta.total).toBe((await summary('hr')).body.meta.total);
  });

  it("another company's data never appears, even when asked for by id", async () => {
    const rows: Row[] = (await summary('hr')).body.data;
    expect(rows.some((r) => r.employeeId === String(beta.people.employee.employeeId))).toBe(false);
    const byId = await summary(
      'hr',
      `from=${MON}&to=${WED}&employeeId=${beta.people.employee.employeeId}`,
    );
    expect(byId.body.data).toEqual([]);
    const betaRows: Row[] = (await summary('beta-hr')).body.data;
    expect(rowFor(betaRows, beta.people.employee)).toMatchObject({ present: 1 });
    const csv = (await get('hr', `/reports/attendance/export?type=daily&from=${MON}&to=${WED}`))
      .text;
    expect(csv).not.toContain('beta');
  });
});

describe('dashboard', () => {
  it("returns today's breakdown, a 14-day trend and pending approvals", async () => {
    await post('employee', '/attendance/corrections', {
      workDate: MON,
      checkOut: ist(MON, '18:00').toISOString(),
      reason: 'Forgot to check out',
    });
    const hr = (await get('hr', '/reports/dashboard')).body.data;
    expect(hr.workDate).toBe(THU);
    expect(hr.scope).toBe('ALL');
    expect(hr.trend).toHaveLength(14);
    expect(hr.trend.at(-1).date).toBe(THU);
    expect(hr.today.notYetIn).toBeGreaterThan(0); // Thursday, nobody has checked in
    expect(hr.today.unscheduled).toBe(1);
    // HR no longer decides others' requests, so nothing is waiting on them; the employee's manager has it.
    expect(hr.pending).toEqual({ corrections: 0, exceptions: 0 });
    const monday = hr.trend.find((d: { date: string }) => d.date === MON);
    expect(monday.present).toBe(1);
    const mgr = (await get('manager', '/reports/dashboard')).body.data;
    expect(mgr.scope).toBe('TEAM');
    expect(mgr.headcount).toBe(2);
    expect(mgr.pending).toEqual({ corrections: 1, exceptions: 0 });
    expect((await get('payroll', '/reports/dashboard')).body.data.pending).toBeNull();
  });

  it("a reviewer's own request is not counted as waiting on them", async () => {
    await post('manager', '/attendance/corrections', {
      workDate: MON,
      checkIn: ist(MON, '09:00').toISOString(),
      reason: 'Forgot to check in',
    });
    expect((await get('manager', '/reports/dashboard')).body.data.pending.corrections).toBe(1);
    // the manager has no manager, so their own request waits on the owner
    expect(
      (await get('owner', '/reports/dashboard')).body.data.pending.corrections,
    ).toBeGreaterThanOrEqual(1);
  });
});

describe('CSV export', () => {
  it('downloads a summary CSV with safe headers and writes an audit record', async () => {
    const res = await get('hr', `/reports/attendance/export?from=${MON}&to=${WED}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toContain(
      'attendance-summary_2026-03-02_2026-03-04.csv',
    );
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text.startsWith('﻿Employee code,Employee,Department,Present')).toBe(true);
    expect(res.text).toContain('EMPLOYEE');
    const audit = await AuditLog.findOne({
      tenantId: t.tenantId,
      action: 'report.exported',
    }).lean();
    expect(audit?.sanitizedAfter).toMatchObject({ type: 'summary', from: MON, to: WED });
  });

  it('daily export shows times in the company timezone', async () => {
    const res = await get('hr', `/reports/attendance/export?type=daily&from=${MON}&to=${MON}`);
    expect(res.text).toMatch(/2026-03-02,EMPLOYEE,employee acme,Engineering,PRESENT,09:05,18:05/);
  });

  it('neutralises formulas typed into employee names', async () => {
    await Employee.updateOne(
      { _id: t.people.employee2.employeeId },
      { $set: { firstName: '=HYPERLINK("http://evil.test","click")' } },
    );
    const csv = (await get('hr', `/reports/attendance/export?type=daily&from=${MON}&to=${MON}`))
      .text;
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.test"",""click"") acme"`);
  });

  it('rejects unknown query parameters and bad types', async () => {
    expect(
      (await get('hr', `/reports/attendance/export?from=${MON}&to=${WED}&type=xlsx`)).status,
    ).toBe(422);
    expect(
      (await get('hr', `/reports/attendance/export?from=${MON}&to=${WED}&format=csv`)).status,
    ).toBe(422);
  });
});
