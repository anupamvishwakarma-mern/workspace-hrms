import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AttendanceDay } from '../src/database/models/attendanceDay.model';
import { AuditLog } from '../src/database/models/auditLog.model';
import { Holiday } from '../src/database/models/holiday.model';
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
let annual: string; // capped at 5 days
let casual: string; // uncapped, no half days
const tok: Record<string, string> = {};
const call = (m: 'get' | 'post' | 'patch', who: string, path: string) =>
  request(app)[m](`/api/v1${path}`).set(bearer(tok[who]!));
const THU = '2026-03-05';

beforeAll(async () => {
  clock = new FakeClock(ist(THU, '12:00'));
  ({ app } = await startTestApp({}, { clock }));
  t = await createTenant('acme');
  beta = await createTenant('beta');
  await setupSchedule(t);
  await setupSchedule(beta);
  for (const k of Object.keys(t.people) as (keyof TestTenant['people'])[])
    tok[k] = await loginAs(app, t.people[k].email);
  tok.betaHr = await loginAs(app, beta.people.hr.email);
  await Holiday.create({
    tenantId: t.tenantId,
    name: 'Mid-week',
    date: '2026-03-11',
    holidayType: 'COMPANY',
  });
});
afterAll(stopTestApp);

const apply = (who: string, body: object) => call('post', who, '/leave/requests').send(body);

describe('leave types', () => {
  it('HR creates types; employees can list but not manage', async () => {
    const a = await call('post', 'hr', '/leave-types').send({
      name: 'Annual',
      code: 'al',
      annualAllowanceDays: 5,
    });
    expect(a.status).toBe(201);
    expect(a.body.data.code).toBe('AL');
    annual = a.body.data.id;
    const c = await call('post', 'hr', '/leave-types').send({
      name: 'Casual',
      code: 'CL',
      allowHalfDay: false,
    });
    casual = c.body.data.id;
    expect(
      (await call('post', 'hr', '/leave-types').send({ name: 'Annual', code: 'AL2' })).status,
    ).toBe(409);
    expect((await call('post', 'hr', '/leave-types').send({ name: 'X', code: 'x y' })).status).toBe(
      422,
    );
    for (const who of ['employee', 'manager', 'payroll']) {
      expect(
        (await call('post', who, '/leave-types').send({ name: 'Nope', code: 'NO' })).status,
      ).toBe(403);
      expect((await call('get', who, '/leave-types')).body.data.length).toBe(2);
    }
    // another company sees none of them
    expect((await call('get', 'betaHr', '/leave-types')).body.data).toHaveLength(0);
    expect(
      (await call('patch', 'betaHr', `/leave-types/${annual}`).send({ name: 'Hacked' })).status,
    ).toBe(404);
  });
});

describe('applying', () => {
  it('counts only working days (weekly off and holidays are free) and ignores identity fields', async () => {
    // Mon 9th - Fri 13th, holiday on Wed 11th => 4 days
    const r = await apply('employee', {
      leaveTypeId: annual,
      startDate: '2026-03-09',
      endDate: '2026-03-13',
      reason: 'Trip',
    });
    expect(r.status).toBe(201);
    expect(r.body.data.days).toBe(4);
    expect(r.body.data.status).toBe('PENDING');
    expect(r.body.data.employeeId).toBe(String(t.people.employee.employeeId));
    // mass assignment of someone else's identity is rejected, not ignored
    const inj = await apply('employee2', {
      leaveTypeId: annual,
      startDate: '2026-03-16',
      endDate: '2026-03-16',
      employeeId: String(t.people.hr.employeeId),
    });
    expect(inj.status).toBe(422);
    const bal = await call('get', 'employee', '/leave/balances?year=2026');
    const al = bal.body.data.find((b: { code: string }) => b.code === 'AL');
    expect(al).toMatchObject({
      allowanceDays: 5,
      pendingDays: 4,
      approvedDays: 0,
      remainingDays: 1,
    });
  });

  it('validates dates, balance, overlap and half days', async () => {
    const bad = (b: object) => apply('employee2', { leaveTypeId: annual, ...b });
    expect((await bad({ startDate: '2026-03-12', endDate: '2026-03-10' })).status).toBe(400);
    expect((await bad({ startDate: '2026-12-30', endDate: '2027-01-02' })).status).toBe(400); // spans years
    expect(
      (await bad({ startDate: '2026-03-16', endDate: '2026-03-17', halfDay: true })).status,
    ).toBe(400);
    expect((await bad({ startDate: '2026-01-01', endDate: '2026-01-02' })).status).toBe(400); // too far in the past
    expect((await bad({ startDate: '2026-03-08', endDate: '2026-03-08' })).status).toBe(422); // Sunday only
    expect((await bad({ startDate: '2026-03-02', endDate: '2026-06-30' })).status).toBe(400); // > 60 days
    expect((await bad({ startDate: '2026-03-16', endDate: '2026-03-23' })).status).toBe(422); // 6 days > 5 allowance
    expect(
      (
        await bad({
          leaveTypeId: '507f1f77bcf86cd799439011',
          startDate: '2026-03-16',
          endDate: '2026-03-16',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await apply('employee2', {
          leaveTypeId: casual,
          startDate: '2026-03-16',
          endDate: '2026-03-16',
          halfDay: true,
        })
      ).status,
    ).toBe(400); // type disallows half days
    // overlap with employee's own pending request
    expect(
      (
        await apply('employee', {
          leaveTypeId: casual,
          startDate: '2026-03-12',
          endDate: '2026-03-12',
        })
      ).status,
    ).toBe(409);
    // cannot exceed balance even across requests: 4 pending + 2 > 5
    expect(
      (
        await apply('employee', {
          leaveTypeId: annual,
          startDate: '2026-03-16',
          endDate: '2026-03-17',
        })
      ).status,
    ).toBe(422);
  });
});

describe('review', () => {
  let reqId: string;
  it('only the right reviewer can decide, never for themselves, and only once', async () => {
    const list = await call('get', 'employee', '/leave/requests');
    reqId = list.body.data[0].id;
    expect(
      (await call('post', 'employee', `/leave/requests/${reqId}/approve`).send({})).status,
    ).toBe(403);
    expect(
      (await call('post', 'employee2', `/leave/requests/${reqId}/approve`).send({})).status,
    ).toBe(403);
    expect(
      (await call('post', 'payroll', `/leave/requests/${reqId}/approve`).send({})).status,
    ).toBe(403);
    expect((await call('post', 'betaHr', `/leave/requests/${reqId}/approve`).send({})).status).toBe(
      404,
    );
    expect((await call('post', 'manager', `/leave/requests/${reqId}/reject`).send({})).status).toBe(
      422,
    ); // needs a comment

    // a manager cannot review a non-report's request
    const other = await apply('employee2', {
      leaveTypeId: casual,
      startDate: '2026-03-16',
      endDate: '2026-03-16',
    });
    expect(
      (await call('post', 'manager', `/leave/requests/${other.body.data.id}/approve`).send({}))
        .status,
    ).toBe(404);
    // and nobody approves their own
    const mgrOwn = await apply('manager', {
      leaveTypeId: casual,
      startDate: '2026-03-17',
      endDate: '2026-03-17',
    });
    expect(
      (await call('post', 'manager', `/leave/requests/${mgrOwn.body.data.id}/approve`).send({}))
        .status,
    ).toBe(403);
    expect(
      (await call('post', 'hr', `/leave/requests/${mgrOwn.body.data.id}/approve`).send({})).status,
    ).toBe(200);
    // HR cannot approve their own either (separation of duties is the default)
    const hrOwn = await apply('hr', {
      leaveTypeId: casual,
      startDate: '2026-03-18',
      endDate: '2026-03-18',
    });
    expect(
      (await call('post', 'hr', `/leave/requests/${hrOwn.body.data.id}/approve`).send({})).status,
    ).toBe(403);
    expect(
      (await call('post', 'owner', `/leave/requests/${hrOwn.body.data.id}/approve`).send({}))
        .status,
    ).toBe(200);

    const ok = await call('post', 'manager', `/leave/requests/${reqId}/approve`).send({
      comment: 'Enjoy',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('APPROVED');
    expect(
      (await call('post', 'manager', `/leave/requests/${reqId}/approve`).send({})).status,
    ).toBe(409);
    expect(
      (await call('post', 'hr', `/leave/requests/${reqId}/reject`).send({ comment: 'too late' }))
        .status,
    ).toBe(409);
    expect(await AuditLog.countDocuments({ entityId: reqId, action: 'leave.approved' })).toBe(1);
    const bal = await call('get', 'employee', '/leave/balances?year=2026');
    expect(bal.body.data.find((b: { code: string }) => b.code === 'AL')).toMatchObject({
      approvedDays: 4,
      pendingDays: 0,
    });
  });

  it('rejection needs a comment and frees the balance', async () => {
    const r = await apply('employee2', {
      leaveTypeId: annual,
      startDate: '2026-03-23',
      endDate: '2026-03-25',
    });
    expect(
      (await call('get', 'employee2', '/leave/balances?year=2026')).body.data.find(
        (b: { code: string }) => b.code === 'AL',
      ).pendingDays,
    ).toBe(3);
    expect(
      (
        await call('post', 'hr', `/leave/requests/${r.body.data.id}/reject`).send({
          comment: 'Busy period',
        })
      ).status,
    ).toBe(200);
    expect(
      (await call('get', 'employee2', '/leave/balances?year=2026')).body.data.find(
        (b: { code: string }) => b.code === 'AL',
      ).pendingDays,
    ).toBe(0);
  });
});

describe('visibility', () => {
  it('employee sees only own; manager their reports; HR all; payroll sees no reasons', async () => {
    const mine = await call('get', 'employee', '/leave/requests?scope=mine');
    for (const r of mine.body.data) expect(r.employeeId).toBe(String(t.people.employee.employeeId));
    expect((await call('get', 'employee', '/leave/requests?scope=review')).status).toBe(403);
    const team = await call('get', 'manager', '/leave/requests?scope=review');
    for (const r of team.body.data) expect(r.employeeId).toBe(String(t.people.employee.employeeId));
    expect(team.body.data.length).toBeGreaterThan(0);
    const hr = await call('get', 'hr', '/leave/requests?scope=review&limit=100');
    expect(hr.body.data.length).toBeGreaterThan(team.body.data.length);
    expect(hr.body.data.some((r: { reason?: string }) => r.reason === 'Trip')).toBe(true);
    const pay = await call('get', 'payroll', '/leave/requests?scope=review&limit=100');
    expect(pay.body.data.length).toBe(hr.body.data.length);
    expect(pay.body.data.every((r: { reason?: string }) => r.reason === undefined)).toBe(true);
    const foreign = await call('get', 'betaHr', '/leave/requests?scope=review&limit=100');
    expect(foreign.body.data).toHaveLength(0);
  });

  it('balances of others only within scope', async () => {
    const id = String(t.people.employee.employeeId);
    expect((await call('get', 'manager', `/leave/balances?employeeId=${id}`)).status).toBe(200);
    expect((await call('get', 'hr', `/leave/balances?employeeId=${id}`)).status).toBe(200);
    expect((await call('get', 'employee2', `/leave/balances?employeeId=${id}`)).status).toBe(404);
    expect((await call('get', 'betaHr', `/leave/balances?employeeId=${id}`)).status).toBe(404);
  });
});

describe('attendance integration', () => {
  it('approved leave on past days becomes ON_LEAVE (full) / HALF_DAY, and cancelling restores ABSENT', async () => {
    // Mon 2nd & Tue 3rd are past (today is Thu 5th), no punches
    const full = await apply('employee2', {
      leaveTypeId: annual,
      startDate: '2026-03-02',
      endDate: '2026-03-03',
    });
    expect(full.status).toBe(201);
    expect(
      (await call('post', 'hr', `/leave/requests/${full.body.data.id}/approve`).send({})).status,
    ).toBe(200);
    const rows = await AttendanceDay.find({
      employeeId: t.people.employee2.employeeId,
      workDate: { $in: ['2026-03-02', '2026-03-03'] },
    }).lean();
    expect(rows.map((r) => r.status).sort()).toEqual(['ON_LEAVE', 'ON_LEAVE']);

    const half = await apply('employee2', {
      leaveTypeId: annual,
      startDate: '2026-03-04',
      endDate: '2026-03-04',
      halfDay: true,
      halfDaySession: 'SECOND',
    });
    expect(half.body.data.days).toBe(0.5);
    await call('post', 'hr', `/leave/requests/${half.body.data.id}/approve`).send({});
    const wed = await AttendanceDay.findOne({
      employeeId: t.people.employee2.employeeId,
      workDate: '2026-03-04',
    }).lean();
    expect(wed!.status).toBe('HALF_DAY');

    // the employee cannot cancel leave that has already started; HR can
    expect(
      (await call('post', 'employee2', `/leave/requests/${full.body.data.id}/cancel`).send({}))
        .status,
    ).toBe(409);
    expect(
      (await call('post', 'employee', `/leave/requests/${full.body.data.id}/cancel`).send({}))
        .status,
    ).toBe(404);
    const cancelled = await call('post', 'hr', `/leave/requests/${full.body.data.id}/cancel`).send(
      {},
    );
    expect(cancelled.status).toBe(200);
    const after = await AttendanceDay.find({
      employeeId: t.people.employee2.employeeId,
      workDate: { $in: ['2026-03-02', '2026-03-03'] },
    }).lean();
    expect(after.map((r) => r.status).sort()).toEqual(['ABSENT', 'ABSENT']);
    expect(
      (await call('post', 'hr', `/leave/requests/${full.body.data.id}/cancel`).send({})).status,
    ).toBe(409);
  });

  it('future leave can be cancelled by its owner, and the report counts leave', async () => {
    const f = await apply('payroll', {
      leaveTypeId: casual,
      startDate: '2026-04-06',
      endDate: '2026-04-07',
    });
    expect(
      (await call('post', 'hr', `/leave/requests/${f.body.data.id}/approve`).send({})).status,
    ).toBe(200);
    expect(
      (await call('post', 'payroll', `/leave/requests/${f.body.data.id}/cancel`).send({})).status,
    ).toBe(200);

    const rep = await call(
      'get',
      'hr',
      '/reports/attendance/summary?from=2026-03-02&to=2026-03-04&limit=100',
    );
    const row = rep.body.data.find(
      (r: { employeeId: string }) => r.employeeId === String(t.people.employee2.employeeId),
    );
    expect(row.onLeave).toBe(0); // the 2nd/3rd leave was cancelled
    expect(row.halfDay).toBe(1); // half-day leave on the 4th
  });
});
