import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AttendanceDay } from '../src/database/models/attendanceDay.model';
import { AttendanceEvent } from '../src/database/models/attendanceEvent.model';
import { AttendanceException } from '../src/database/models/attendanceException.model';
import { AuditLog } from '../src/database/models/auditLog.model';
import { Employee } from '../src/database/models/employee.model';
import { Holiday } from '../src/database/models/holiday.model';
import { Shift } from '../src/database/models/shift.model';
import { punch as servicePunch } from '../src/modules/attendance/attendance.service';
import { ShiftAssignment } from '../src/database/models/shiftAssignment.model';
import {
  FakeClock,
  addPerson,
  bearer,
  createTenant,
  inside,
  ist,
  loginAs,
  newKey,
  outside,
  setupSchedule,
  startTestApp,
  stopTestApp,
  testEnv,
  type TestTenant,
} from './helpers';

let app: Express;
let t: TestTenant;
let clock: FakeClock;
const tok: Record<string, string> = {};
const MON = '2026-03-02';
const TUE = '2026-03-03';

const post = (who: string, path: string, body: object = {}) =>
  request(app).post(`/api/v1${path}`).set(bearer(tok[who]!)).send(body);
const get = (who: string, path: string) =>
  request(app).get(`/api/v1${path}`).set(bearer(tok[who]!));
const punch = (
  who: string,
  action: 'check-in' | 'check-out' | 'break-start' | 'break-end',
  extra: object = {},
) =>
  post(who, `/attendance/${action}`, {
    idempotencyKey: newKey(action),
    location: inside(),
    ...extra,
  });
const at = (date: string, time: string) => clock.set(ist(date, time));

beforeAll(async () => {
  clock = new FakeClock(ist(MON, '08:55'));
  ({ app } = await startTestApp({}, { clock }));
  t = await createTenant('acme');
  await setupSchedule(t);
  for (const k of Object.keys(t.people) as (keyof TestTenant['people'])[])
    tok[k] = await loginAs(app, t.people[k].email);
});
afterAll(stopTestApp);

describe('check-in / check-out happy path', () => {
  it('records a verified check-in with a server timestamp, then breaks and check-out produce a correct daily summary', async () => {
    at(MON, '09:05');
    const ci = await punch('employee', 'check-in', { clientTimestamp: '2020-01-01T00:00:00Z' }); // client clock is ignored for time
    expect(ci.status).toBe(201);
    expect(ci.body.data.state).toBe('WORKING');
    expect(ci.body.data.event.verification.status).toBe('VERIFIED');
    expect(new Date(ci.body.data.event.occurredAt).toISOString()).toBe(
      ist(MON, '09:05').toISOString(),
    );
    const stored = await AttendanceEvent.findById(ci.body.data.event.id).lean();
    expect(stored!.clientTimestamp!.toISOString()).toBe('2020-01-01T00:00:00.000Z'); // kept for diagnostics only
    expect(stored!.workDate).toBe(MON);

    at(MON, '13:00');
    expect((await punch('employee', 'break-start')).body.data.state).toBe('ON_BREAK');
    at(MON, '13:45');
    expect((await punch('employee', 'break-end')).body.data.state).toBe('WORKING');
    at(MON, '18:00');
    const co = await punch('employee', 'check-out');
    expect(co.status).toBe(201);
    expect(co.body.data.state).toBe('OFF');

    const day = await AttendanceDay.findOne({
      employeeId: t.people.employee.employeeId,
      workDate: MON,
    }).lean();
    expect(day).toMatchObject({
      status: 'PRESENT',
      workedMinutes: 535 - 45,
      breakMinutes: 45,
      lateMinutes: 0,
      earlyDepartureMinutes: 0,
      calculationVersion: 1,
      isOpen: false,
    });
    expect(await AttendanceEvent.countDocuments({ employeeId: t.people.employee.employeeId })).toBe(
      4,
    );
  });

  it('me/today reflects state, allowed actions and punches; me/history lists the day', async () => {
    at(MON, '19:00');
    const today = (await get('employee', '/attendance/me/today')).body.data;
    expect(today.state).toBe('OFF');
    expect(today.workDate).toBe(MON);
    expect(today.shift.name).toBe('Day');
    expect(today.timezone).toBe('Asia/Kolkata');
    expect(today.summary.workedMinutes).toBe(490);
    expect(today.events).toHaveLength(4);
    const enabled = today.allowedActions
      .filter((a: { enabled: boolean }) => a.enabled)
      .map((a: { action: string }) => a.action);
    expect(enabled).toEqual(['check-in']);
    expect(
      today.allowedActions.find((a: { action: string }) => a.action === 'check-out').reason,
    ).toBe('You are not checked in');
    expect(JSON.stringify(today.events)).not.toMatch(/coordinates/); // own view carries no GPS coordinates
    const hist = (await get('employee', `/attendance/me/history?from=${MON}&to=${MON}`)).body;
    expect(hist.data).toHaveLength(1);
    expect(hist.data[0].status).toBe('PRESENT');
  });

  it('late arrival beyond grace is recorded', async () => {
    at(MON, '09:11');
    await punch('employee2', 'check-in');
    at(MON, '18:00');
    await punch('employee2', 'check-out');
    const day = await AttendanceDay.findOne({
      employeeId: t.people.employee2.employeeId,
      workDate: MON,
    }).lean();
    expect(day!.lateMinutes).toBe(11);
  });
});

describe('idempotency and state machine', () => {
  const key = 'idem-fixed-key-0001';
  it('a retried request with the same key returns the original event and creates no duplicate', async () => {
    at(TUE, '09:00');
    const first = await post('manager', '/attendance/check-in', {
      idempotencyKey: key,
      location: inside(),
    });
    const retry = await post('manager', '/attendance/check-in', {
      idempotencyKey: key,
      location: inside(),
    });
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.data.replayed).toBe(true);
    expect(retry.body.data.event.id).toBe(first.body.data.event.id);
    expect(await AttendanceEvent.countDocuments({ employeeId: t.people.manager.employeeId })).toBe(
      1,
    );
  });

  it('reusing a key for a different action is rejected', async () => {
    const res = await post('manager', '/attendance/check-out', {
      idempotencyKey: key,
      location: inside(),
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('rejects invalid transitions with clear messages and the actions that are allowed', async () => {
    const dup = await punch('manager', 'check-in');
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('INVALID_TRANSITION');
    expect(dup.body.error.message).toBe('You are already checked in');
    expect(dup.body.error.details.allowedActions).toEqual(['check-out', 'break-start']);
    expect((await punch('manager', 'break-end')).body.error.message).toBe('You are not on a break');
    await punch('manager', 'break-start');
    expect((await punch('manager', 'check-out')).body.error.message).toBe(
      'End your break before checking out',
    );
    expect((await punch('manager', 'break-start')).body.error.message).toBe(
      'You are already on a break',
    );
    await punch('manager', 'break-end');
    await punch('manager', 'check-out');
    expect((await punch('manager', 'check-out')).body.error.message).toBe('You are not checked in');
    expect((await punch('manager', 'break-start')).status).toBe(409);
    expect(await AttendanceEvent.countDocuments({ employeeId: t.people.manager.employeeId })).toBe(
      4,
    );
  });

  it('validates the request body (bad key, coordinates out of range, extra fields)', async () => {
    expect(
      (
        await post('payroll', '/attendance/check-in', {
          idempotencyKey: 'short',
          location: inside(),
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await post('payroll', '/attendance/check-in', {
          idempotencyKey: newKey(),
          location: { latitude: 91, longitude: 0, accuracyMeters: 5 },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await post('payroll', '/attendance/check-in', {
          idempotencyKey: newKey(),
          location: inside(),
          occurredAt: '2026-01-01T00:00:00Z',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await post('payroll', '/attendance/check-in', {
          idempotencyKey: newKey(),
          location: inside(),
          employeeId: String(t.people.hr.employeeId),
        })
      ).status,
    ).toBe(422);
  });
});

describe('concurrency', () => {
  it('parallel check-ins with different keys create exactly one session', async () => {
    at(TUE, '09:30');
    const results = await Promise.all(Array.from({ length: 6 }, () => punch('hr', 'check-in')));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect(
      await AttendanceEvent.countDocuments({
        employeeId: t.people.hr.employeeId,
        eventType: 'CHECK_IN',
      }),
    ).toBe(1);
  });

  it('service level: 12 simultaneous check-ins with distinct keys record exactly one', async () => {
    // A fresh employee so earlier tests' punches cannot change the starting state.
    const fresh = await addPerson(t.tenantId, t.slug, 'svcperson', ['EMPLOYEE'], t.department);
    const shift = await Shift.findOne({ tenantId: t.tenantId }).lean();
    await ShiftAssignment.create({
      tenantId: t.tenantId,
      employeeId: fresh.employeeId,
      shiftId: shift!._id,
      effectiveFrom: '2026-01-01',
    });
    const now = ist(TUE, '09:30');
    const settled = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        servicePunch(
          t.tenantId,
          fresh.employeeId,
          { type: 'CHECK_IN', idempotencyKey: newKey('svc'), location: inside(), source: 'MOBILE' },
          now,
          testEnv(),
        ),
      ),
    );
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await AttendanceEvent.countDocuments({ employeeId: fresh.employeeId })).toBe(1);
  });

  it('parallel requests with the same key all return the one event', async () => {
    const k = 'idem-parallel-key-1';
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        post('owner', '/attendance/check-in', { idempotencyKey: k, location: inside() }),
      ),
    );
    expect(results.every((r) => r.status === 201 || r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.data.event.id)).size).toBe(1);
    expect(await AttendanceEvent.countDocuments({ employeeId: t.people.owner.employeeId })).toBe(1);
  });
});

describe('geofence and GPS quality', () => {
  it('rejects a punch outside the geofence, records nothing, and says an exception can be requested', async () => {
    at(TUE, '09:10');
    const res = await punch('payroll', 'check-in', { location: outside() });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('OUTSIDE_GEOFENCE');
    expect(res.body.error.details.exceptionAllowed).toBe(true);
    expect(res.body.error.details.distanceMeters).toBeGreaterThan(2000);
    expect(await AttendanceEvent.countDocuments({ employeeId: t.people.payroll.employeeId })).toBe(
      0,
    );
  });

  it('rejects poor GPS accuracy and missing location', async () => {
    expect((await punch('payroll', 'check-in', { location: inside(250) })).body.error.code).toBe(
      'POOR_ACCURACY',
    );
    expect((await punch('payroll', 'check-in', { location: undefined })).body.error.code).toBe(
      'LOCATION_REQUIRED',
    );
  });

  it('records mock-location as a risk signal without rejecting', async () => {
    const res = await punch('payroll', 'check-in', {
      location: { ...inside(), mockLocationDetected: true },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.event.verification.riskSignals.mockLocationDetected).toBe(true);
    await punch('payroll', 'check-out');
  });

  it('REMOTE employees need no location; FIELD employees need a good fix but no fence', async () => {
    await Employee.updateOne(
      { _id: t.people.employee2.employeeId },
      { $set: { attendanceMode: 'REMOTE' } },
    );
    const remote = await post('employee2', '/attendance/check-in', { idempotencyKey: newKey() });
    expect(remote.status).toBe(201);
    expect(remote.body.data.event.verification.status).toBe('NOT_REQUIRED');
    await post('employee2', '/attendance/check-out', { idempotencyKey: newKey() });
    await Employee.updateOne(
      { _id: t.people.employee2.employeeId },
      { $set: { attendanceMode: 'FIELD' } },
    );
    expect(
      (await post('employee2', '/attendance/check-in', { idempotencyKey: newKey() })).body.error
        .code,
    ).toBe('LOCATION_REQUIRED');
    expect(
      (
        await post('employee2', '/attendance/check-in', {
          idempotencyKey: newKey(),
          location: outside(),
        })
      ).status,
    ).toBe(201);
    await post('employee2', '/attendance/check-out', {
      idempotencyKey: newKey(),
      location: outside(),
    });
    await Employee.updateOne(
      { _id: t.people.employee2.employeeId },
      { $set: { attendanceMode: 'OFFICE' } },
    );
  });

  it('terminated employees cannot punch', async () => {
    await Employee.updateOne(
      { _id: t.people.payroll.employeeId },
      { $set: { employmentStatus: 'TERMINATED' } },
    );
    expect((await punch('payroll', 'check-in')).status).toBe(403);
    await Employee.updateOne(
      { _id: t.people.payroll.employeeId },
      { $set: { employmentStatus: 'ACTIVE' } },
    );
  });

  it('audit records for punches contain no coordinates', async () => {
    const dump = JSON.stringify(await AuditLog.find({ action: /^attendance\./ }).lean());
    expect(dump).toContain('attendance.check_in');
    expect(dump).not.toMatch(/12\.97|77\.59|coordinates/);
  });
});

describe('GPS exception workflow', () => {
  let exId: string;
  it('an out-of-fence punch with a reason becomes a pending exception (202) and records no event', async () => {
    at(TUE, '09:20');
    const res = await punch('employee', 'check-in', {
      location: outside(),
      exceptionReason: 'Client site visit, office GPS unavailable',
    });
    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe('PENDING_REVIEW');
    exId = res.body.data.exception.id;
    expect(
      await AttendanceEvent.countDocuments({
        employeeId: t.people.employee.employeeId,
        workDate: TUE,
      }),
    ).toBe(0);
    // retrying the same request is idempotent
    const k = (await AttendanceException.findById(exId).lean())!.idempotencyKey;
    const retry = await post('employee', '/attendance/check-in', {
      idempotencyKey: k,
      location: outside(),
      exceptionReason: 'Client site visit, office GPS unavailable',
    });
    expect(retry.status).toBe(202);
    expect(retry.body.data.exception.id).toBe(exId);
  });

  it('an employee sees only their own exceptions, without coordinates', async () => {
    const mine = await get('employee', '/attendance/me/exceptions');
    expect(mine.status).toBe(200);
    expect(mine.body.data.map((x: { id: string }) => x.id)).toContain(exId);
    expect(JSON.stringify(mine.body)).not.toMatch(/latitude|coordinates/);
    const other = await get('employee2', '/attendance/me/exceptions');
    expect(other.body.data.map((x: { id: string }) => x.id)).not.toContain(exId);
  });

  it('the employee and unrelated people cannot decide it; self-review is blocked; the manager can approve', async () => {
    at(TUE, '09:40');
    expect((await post('employee', `/attendance/exceptions/${exId}/approve`)).status).toBe(403);
    expect((await post('employee2', `/attendance/exceptions/${exId}/approve`)).status).toBe(403);
    const approve = await post('manager', `/attendance/exceptions/${exId}/approve`, {
      comment: 'Confirmed with client',
    });
    expect(approve.status).toBe(200);
    expect(approve.body.data.event.verification.status).toBe('EXCEPTION_APPROVED');
    // event is stamped with the time of the original attempt, not the approval time
    expect(new Date(approve.body.data.event.occurredAt).toISOString()).toBe(
      ist(TUE, '09:20').toISOString(),
    );
    expect((await post('manager', `/attendance/exceptions/${exId}/approve`)).status).toBe(409); // no double approval
    const state = (await get('employee', '/attendance/me/today')).body.data.state;
    expect(state).toBe('WORKING');
  });

  it('rejecting an exception leaves no event; rejection needs a comment', async () => {
    await punch('employee', 'check-out', { location: inside() });
    at(TUE, '10:00');
    const ex = await punch('employee', 'check-in', {
      location: outside(),
      exceptionReason: 'Working from cafe today',
    });
    expect(
      (await post('manager', `/attendance/exceptions/${ex.body.data.exception.id}/reject`, {}))
        .status,
    ).toBe(422);
    const rej = await post(
      'manager',
      `/attendance/exceptions/${ex.body.data.exception.id}/reject`,
      {
        comment: 'Not a valid location',
      },
    );
    expect(rej.status).toBe(200);
    expect(rej.body.data.event).toBeNull();
    expect(
      await AttendanceEvent.countDocuments({
        employeeId: t.people.employee.employeeId,
        workDate: TUE,
        eventType: 'CHECK_IN',
      }),
    ).toBe(1);
  });

  it('an exception cannot be approved after later punches exist (history is never rewritten)', async () => {
    at(TUE, '10:30');
    const ex = await punch('employee', 'check-in', {
      location: outside(),
      exceptionReason: 'Still at the client office',
    });
    at(TUE, '10:40');
    await punch('employee', 'check-in', { location: inside() }); // legitimate punch arrives first
    const res = await post(
      'manager',
      `/attendance/exceptions/${ex.body.data.exception.id}/approve`,
    );
    expect(res.status).toBe(409);
    await punch('employee', 'check-out');
  });

  it('exceptions can be disabled per tenant: the punch is simply rejected', async () => {
    const { Tenant } = await import('../src/database/models/tenant.model');
    await Tenant.updateOne(
      { _id: t.tenantId },
      { $set: { 'settings.attendance.allowGpsExceptions': false } },
    );
    at(TUE, '12:00');
    const res = await punch('employee2', 'check-in', {
      location: outside(),
      exceptionReason: 'please let me in',
    });
    expect(res.status).toBe(422);
    expect(res.body.error.details.exceptionAllowed).toBe(false);
    await Tenant.updateOne(
      { _id: t.tenantId },
      { $set: { 'settings.attendance.allowGpsExceptions': true } },
    );
  });
});

describe('overnight shifts and timezones', () => {
  const WED = '2026-03-04';
  it('an overnight shift keeps check-out (next morning) on the original work date', async () => {
    const night = await Shift.create({
      tenantId: t.tenantId,
      name: 'Night',
      startTime: '22:00',
      endTime: '06:00',
      graceMinutes: 10,
      weeklyOffDays: [],
    });
    const emp = t.people.employee2;
    await ShiftAssignment.deleteMany({ employeeId: emp.employeeId });
    await ShiftAssignment.create({
      tenantId: t.tenantId,
      employeeId: emp.employeeId,
      shiftId: night._id,
      effectiveFrom: '2026-01-01',
    });
    at(WED, '22:03');
    const ci = await punch('employee2', 'check-in');
    expect(ci.status).toBe(201);
    at('2026-03-05', '06:02');
    const today = (await get('employee2', '/attendance/me/today')).body.data;
    expect(today.workDate).toBe(WED); // after midnight we are still in Wednesday's shift
    expect(today.shift.overnight).toBe(true);
    const co = await punch('employee2', 'check-out');
    expect(co.status).toBe(201);
    const ev = await AttendanceEvent.findById(co.body.data.event.id).lean();
    expect(ev!.workDate).toBe(WED);
    const day = await AttendanceDay.findOne({ employeeId: emp.employeeId, workDate: WED }).lean();
    expect(day).toMatchObject({
      status: 'PRESENT',
      workedMinutes: 479,
      lateMinutes: 0,
      earlyDepartureMinutes: 0,
    });
    expect(
      await AttendanceDay.countDocuments({ employeeId: emp.employeeId, workDate: '2026-03-05' }),
    ).toBe(0);
  });

  it('a late check-in after midnight is still assigned to the shift that started the evening before', async () => {
    at('2026-03-05', '22:00'); // Thursday's shift
    await punch('employee2', 'check-in');
    at('2026-03-06', '06:00');
    await punch('employee2', 'check-out');
    at('2026-03-06', '23:40'); // Friday night: arrives 1h40 late
    await punch('employee2', 'check-in');
    const day = await AttendanceDay.findOne({
      employeeId: t.people.employee2.employeeId,
      workDate: '2026-03-06',
    }).lean();
    expect(day!.lateMinutes).toBe(100);
    at('2026-03-07', '00:10');
    expect((await punch('employee2', 'check-out')).status).toBe(201);
  });

  it('the work date follows the company timezone, not UTC', async () => {
    // 2026-03-08 19:00 UTC is 00:30 on 9 March in India.
    clock.set(new Date('2026-03-08T19:00:00Z'));
    const res = await punch('hr', 'check-in');
    expect(res.status).toBe(201);
    expect(res.body.data.event.workDate).toBe('2026-03-09');
    await AttendanceEvent.countDocuments();
  });
});

describe('missing check-out', () => {
  const FRI = '2026-03-13';
  it("a forgotten check-out is flagged INCOMPLETE and does not block tomorrow's check-in", async () => {
    at(FRI, '09:00');
    await punch('owner', 'check-out').catch(() => undefined);
    // owner has an open session from TUE; by now it is stale
    const today = (await get('owner', '/attendance/me/today')).body.data;
    expect(today.state).toBe('OFF');
    expect(today.previousSessionIncomplete).toBeDefined();
    const ci = await punch('owner', 'check-in');
    expect(ci.status).toBe(201);
    const stale = await AttendanceDay.findOne({
      employeeId: t.people.owner.employeeId,
      workDate: TUE,
    }).lean();
    expect(stale!.status).toBe('INCOMPLETE');
    expect(stale!.workedMinutes).toBe(0);
  });
});

describe('holidays', () => {
  it('punching on a company holiday yields HOLIDAY status with no lateness', async () => {
    await Holiday.create({ tenantId: t.tenantId, name: 'Founders Day', date: '2026-03-16' });
    at('2026-03-16', '11:00');
    await punch('hr', 'check-in').catch(() => undefined); // hr has a stale session; stale rule lets this through
    const day = await AttendanceDay.findOne({
      employeeId: t.people.hr.employeeId,
      workDate: '2026-03-16',
    }).lean();
    expect(day!.status).toBe('HOLIDAY');
    expect(day!.lateMinutes).toBe(0);
  });
});

describe('immutability of punches', () => {
  it('events cannot be updated or deleted through the application layer', async () => {
    const ev = await AttendanceEvent.findOne().lean();
    await expect(
      AttendanceEvent.updateOne({ _id: ev!._id }, { $set: { eventType: 'CHECK_OUT' } }),
    ).rejects.toThrow(/immutable/);
    await expect(AttendanceEvent.deleteMany({})).rejects.toThrow(/immutable/);
    const doc = await AttendanceEvent.findById(ev!._id);
    doc!.workDate = '1999-01-01';
    await expect(doc!.save()).rejects.toThrow(/immutable/);
  });
});
