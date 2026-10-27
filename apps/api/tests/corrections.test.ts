import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AttendanceCorrection } from '../src/database/models/attendanceCorrection.model';
import { AttendanceDay } from '../src/database/models/attendanceDay.model';
import { AttendanceEvent } from '../src/database/models/attendanceEvent.model';
import { AuditLog } from '../src/database/models/auditLog.model';
import { Tenant } from '../src/database/models/tenant.model';
import {
  FakeClock,
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
let other: TestTenant;
let clock: FakeClock;
const tok: Record<string, string> = {};
let otherTok: string;
const MON = '2026-03-02';
const post = (who: string, path: string, body: object = {}) =>
  request(app).post(`/api/v1${path}`).set(bearer(tok[who]!)).send(body);
const get = (who: string, path: string) =>
  request(app).get(`/api/v1${path}`).set(bearer(tok[who]!));
const punch = (who: string, action: string) =>
  post(who, `/attendance/${action}`, { idempotencyKey: newKey(action), location: inside() });
const day = (who: keyof TestTenant['people'], date = MON) =>
  AttendanceDay.findOne({ employeeId: t.people[who].employeeId, workDate: date }).lean();

beforeAll(async () => {
  clock = new FakeClock(ist(MON, '09:00'));
  ({ app } = await startTestApp({}, { clock }));
  t = await createTenant('acme');
  other = await createTenant('zeta');
  await setupSchedule(t);
  await setupSchedule(other);
  for (const k of Object.keys(t.people) as (keyof TestTenant['people'])[])
    tok[k] = await loginAs(app, t.people[k].email);
  otherTok = await loginAs(app, other.people.owner.email);
  // employee forgets to check out on Monday
  clock.set(ist(MON, '09:00'));
  await punch('employee', 'check-in');
  // a normal complete day for hr
  await punch('hr', 'check-in');
  clock.set(ist(MON, '18:00'));
  await punch('hr', 'check-out');
  // move on to Wednesday
  clock.set(ist('2026-03-04', '10:00'));
});
afterAll(stopTestApp);

const corr = (over: object = {}) => ({
  workDate: MON,
  checkOut: ist(MON, '18:00').toISOString(),
  reason: 'Forgot to check out',
  ...over,
});

describe('requesting corrections', () => {
  it('the day with a missing check-out is INCOMPLETE after the stale cut-off', async () => {
    clock.set(ist('2026-03-04', '10:00'));
    await punch('employee', 'check-in'); // closes the stale view and recalculates Monday
    await punch('employee', 'check-out');
    expect((await day('employee'))!.status).toBe('INCOMPLETE');
  });

  it('validates requests', async () => {
    expect(
      (
        await post('employee', '/attendance/corrections', {
          workDate: MON,
          reason: 'no times at all',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post(
          'employee',
          '/attendance/corrections',
          corr({
            checkIn: ist(MON, '18:00').toISOString(),
            checkOut: ist(MON, '09:00').toISOString(),
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await post(
          'employee',
          '/attendance/corrections',
          corr({ checkOut: ist('2026-03-05', '18:00').toISOString() }),
        )
      ).status,
    ).toBe(400); // future
    expect(
      (await post('employee', '/attendance/corrections', corr({ workDate: '2025-11-01' }))).status,
    ).toBe(400); // outside window
    expect(
      (await post('employee', '/attendance/corrections', corr({ workDate: '2026-03-20' }))).status,
    ).toBe(400); // future day
    expect(
      (
        await post(
          'employee',
          '/attendance/corrections',
          corr({ checkOut: ist('2026-03-03', '18:00').toISOString() }),
        )
      ).status,
    ).toBe(201); // within 24h-of-day window is accepted ...
    // ... but only one pending correction per day
    expect((await post('employee', '/attendance/corrections', corr())).status).toBe(409);
    await AttendanceCorrection.deleteMany({});
    await AttendanceDay.updateOne(
      { employeeId: t.people.employee.employeeId, workDate: MON },
      { $set: { correctionStatus: 'NONE' } },
    );
    expect((await post('employee', '/attendance/corrections', corr({ reason: 'x' }))).status).toBe(
      422,
    );
    expect(
      (
        await post('employee', '/attendance/corrections', {
          ...corr(),
          employeeId: String(t.people.hr.employeeId),
        })
      ).status,
    ).toBe(403); // cannot file for someone else
  });
});

describe('approval workflow', () => {
  let id: string;
  it('creates a pending correction and marks the day', async () => {
    const res = await post('employee', '/attendance/corrections', corr());
    expect(res.status).toBe(201);
    id = res.body.data.id;
    expect(res.body.data.status).toBe('PENDING');
    expect((await day('employee'))!.correctionStatus).toBe('PENDING');
  });

  it('the requester cannot approve their own; an unrelated employee cannot; a manager from outside the scope sees nothing', async () => {
    expect((await post('employee', `/attendance/corrections/${id}/approve`)).status).toBe(403);
    expect((await post('employee2', `/attendance/corrections/${id}/approve`)).status).toBe(403);
    expect((await post('payroll', `/attendance/corrections/${id}/approve`)).status).toBe(403);
    expect((await post('manager', `/attendance/corrections/${id}/reject`, {})).status).toBe(422); // reject needs a comment
  });

  it("the employee's manager approves; the day is recalculated and original events are untouched", async () => {
    const before = await AttendanceEvent.find({ employeeId: t.people.employee.employeeId }).lean();
    const res = await post('manager', `/attendance/corrections/${id}/approve`, {
      comment: 'Confirmed',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('APPROVED');
    expect(res.body.data.reviewedBy).toBe(String(t.people.manager.userId));
    const d = await day('employee');
    expect(d).toMatchObject({ status: 'PRESENT', workedMinutes: 540, correctionStatus: 'APPLIED' });
    const after = await AttendanceEvent.find({ employeeId: t.people.employee.employeeId }).lean();
    expect(JSON.stringify(after)).toBe(JSON.stringify(before)); // ledger identical
    const audit = await AuditLog.findOne({
      action: 'attendance.correction_approved',
      entityId: id,
    }).lean();
    expect(audit?.actorUserId?.toString()).toBe(String(t.people.manager.userId));
    expect(audit?.reason).toBe('Confirmed');
  });

  it('cannot be decided twice', async () => {
    expect((await post('manager', `/attendance/corrections/${id}/approve`)).status).toBe(409);
    expect(
      (await post('hr', `/attendance/corrections/${id}/reject`, { comment: 'too late' })).status,
    ).toBe(409);
  });

  it('concurrent approvals: exactly one wins', async () => {
    clock.set(ist('2026-03-04', '12:00'));
    const c = await post(
      'employee2',
      '/attendance/corrections',
      corr({
        checkIn: ist(MON, '09:00').toISOString(),
        checkOut: ist(MON, '18:00').toISOString(),
        reason: 'Phone was dead all day',
      }),
    );
    const results = await Promise.all([
      post('hr', `/attendance/corrections/${c.body.data.id}/approve`),
      post('owner', `/attendance/corrections/${c.body.data.id}/approve`),
      post('hr', `/attendance/corrections/${c.body.data.id}/approve`),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    expect(await day('employee2')).toMatchObject({ status: 'PRESENT', workedMinutes: 540 }); // rebuilt entirely from a correction
  });

  it('rejection records the comment and leaves the day unchanged', async () => {
    const c = await post('hr', '/attendance/corrections', {
      workDate: '2026-03-03',
      checkIn: ist('2026-03-03', '09:00').toISOString(),
      checkOut: ist('2026-03-03', '18:00').toISOString(),
      reason: 'HR files for a colleague',
      employeeId: String(t.people.payroll.employeeId),
    });
    expect(c.status).toBe(201);
    const rej = await post('manager', `/attendance/corrections/${c.body.data.id}/reject`, {
      comment: 'No evidence',
    });
    expect(rej.status).toBe(404); // payroll is not the manager's report: out of scope, existence hidden
    const ok = await post('owner', `/attendance/corrections/${c.body.data.id}/reject`, {
      comment: 'No evidence',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('REJECTED');
    expect(await day('payroll', '2026-03-03')).toMatchObject({
      status: 'ABSENT',
      workedMinutes: 0,
    }); // nothing credited; no punches exist
  });

  it('a corrected time that contradicts recorded punches is refused at approval, and nothing changes', async () => {
    clock.set(ist('2026-03-04', '12:30'));
    const c = await post('hr', '/attendance/corrections', {
      workDate: MON,
      checkOut: ist(MON, '08:00').toISOString(),
      reason: 'Bogus request here',
    });
    expect(c.status).toBe(201);
    const res = await post('owner', `/attendance/corrections/${c.body.data.id}/approve`);
    expect(res.status).toBe(400);
    expect((await AttendanceCorrection.findById(c.body.data.id).lean())!.status).toBe('PENDING'); // rolled back with the transaction
    expect((await day('hr'))!.workedMinutes).toBe(540);
  });
});

describe('self-approval policy', () => {
  it('HR cannot approve a request they raised for themselves; owner can only with the company setting', async () => {
    clock.set(ist('2026-03-04', '13:00'));
    const c = await post('owner', '/attendance/corrections', {
      workDate: '2026-03-03',
      checkIn: ist('2026-03-03', '09:00').toISOString(),
      checkOut: ist('2026-03-03', '18:00').toISOString(),
      reason: 'Own correction request',
    });
    expect(c.status).toBe(201);
    expect((await post('owner', `/attendance/corrections/${c.body.data.id}/approve`)).status).toBe(
      403,
    );
    expect((await post('hr', `/attendance/corrections/${c.body.data.id}/approve`)).status).toBe(
      200,
    ); // someone else may
    const c2 = await post('owner', '/attendance/corrections', {
      workDate: '2026-03-02',
      checkIn: ist(MON, '09:00').toISOString(),
      checkOut: ist(MON, '18:00').toISOString(),
      reason: 'Another own request',
    });
    await Tenant.updateOne(
      { _id: t.tenantId },
      { $set: { 'settings.attendance.allowSelfApproval': true } },
    );
    expect((await post('owner', `/attendance/corrections/${c2.body.data.id}/approve`)).status).toBe(
      200,
    );
    expect(
      (
        await post('manager', '/attendance/corrections', {
          workDate: '2026-03-03',
          checkOut: ist('2026-03-03', '18:00').toISOString(),
          reason: 'Manager own request',
        })
      ).status,
    ).toBe(201);
    const mine = await get('manager', '/attendance/corrections?status=PENDING');
    const id = mine.body.data[0].id;
    expect((await post('manager', `/attendance/corrections/${id}/approve`)).status).toBe(403); // managers never self-approve, even when enabled
    await Tenant.updateOne(
      { _id: t.tenantId },
      { $set: { 'settings.attendance.allowSelfApproval': false } },
    );
  });
});

describe('listing scope', () => {
  it('employees see their own; managers see themselves and reports; HR sees all', async () => {
    const mineIds = (await get('employee', '/attendance/corrections')).body.data.map(
      (c: { employeeId: string }) => c.employeeId,
    );
    expect(new Set(mineIds)).toEqual(new Set([String(t.people.employee.employeeId)]));
    const mgr = (await get('manager', '/attendance/corrections')).body.data.map(
      (c: { employeeId: string }) => c.employeeId,
    );
    expect(
      mgr.every((id: string) =>
        [String(t.people.manager.employeeId), String(t.people.employee.employeeId)].includes(id),
      ),
    ).toBe(true);
    const all = (await get('hr', '/attendance/corrections?limit=100')).body.meta.total;
    expect(all).toBeGreaterThanOrEqual(5);
  });
});

describe('cross-tenant isolation (attendance)', () => {
  it("another company cannot approve, reject, list or read this company's corrections, exceptions or days", async () => {
    clock.set(ist('2026-03-04', '14:00'));
    const c = await post(
      'employee',
      '/attendance/corrections',
      corr({
        workDate: '2026-03-03',
        checkOut: ist('2026-03-03', '18:00').toISOString(),
        checkIn: ist('2026-03-03', '09:00').toISOString(),
      }),
    );
    const cid = c.body.data.id;
    const foreign = (m: 'post' | 'get', path: string, body: object = {}) =>
      request(app)
        [m](`/api/v1${path}`)
        .set(bearer(otherTok))
        .send(m === 'post' ? body : undefined);
    expect((await foreign('post', `/attendance/corrections/${cid}/approve`)).status).toBe(404);
    expect(
      (await foreign('post', `/attendance/corrections/${cid}/reject`, { comment: 'nope nope' }))
        .status,
    ).toBe(404);
    expect((await AttendanceCorrection.findById(cid).lean())!.status).toBe('PENDING');
    expect(
      (await foreign('get', '/attendance/corrections')).body.data.find(
        (x: { id: string }) => x.id === cid,
      ),
    ).toBeUndefined();
    const dayId = String((await day('hr'))!._id);
    expect((await foreign('get', `/attendance/days/${dayId}`)).status).toBe(404);
    const range = (
      await foreign(
        'get',
        `/attendance/days?from=${MON}&to=${MON}&employeeId=${t.people.hr.employeeId}`,
      )
    ).body;
    expect(range.data).toHaveLength(0);
    expect(
      (await foreign('get', `/attendance/days?from=${MON}&to=${MON}&limit=100`)).body.data.every(
        (d: { employeeId: string }) =>
          !Object.values(t.people).some((p) => String(p.employeeId) === d.employeeId),
      ),
    ).toBe(true);
    expect((await foreign('post', `/attendance/exceptions/${'a'.repeat(24)}/approve`)).status).toBe(
      404,
    );
  });

  it("an employee cannot file corrections for another tenant's employee", async () => {
    const res = await request(app)
      .post('/api/v1/attendance/corrections')
      .set(bearer(otherTok))
      .send({ ...corr(), employeeId: String(t.people.hr.employeeId) });
    expect(res.status).toBe(404);
  });
});

describe('days listing and detail permissions', () => {
  it('HR sees all days (with names); managers only their team; payroll sees summaries but not GPS detail; employees cannot list', async () => {
    const q = `?from=${MON}&to=2026-03-04&limit=100`;
    const hr = (await get('hr', `/attendance/days${q}`)).body;
    expect(hr.data.length).toBeGreaterThanOrEqual(3);
    expect(hr.data[0].employee.firstName).toBeDefined();
    const mgr = (await get('manager', `/attendance/days${q}`)).body.data;
    expect(
      mgr.every((d: { employeeId: string }) =>
        [String(t.people.manager.employeeId), String(t.people.employee.employeeId)].includes(
          d.employeeId,
        ),
      ),
    ).toBe(true);
    expect((await get('payroll', `/attendance/days${q}`)).status).toBe(200);
    expect((await get('employee', `/attendance/days${q}`)).status).toBe(403);
    const id = String((await day('hr'))!._id);
    const detail = await get('hr', `/attendance/days/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.events[0].location.coordinates).toHaveLength(2);
    expect(detail.body.data.events[0].verification.status).toBe('VERIFIED');
    expect((await get('payroll', `/attendance/days/${id}`)).status).toBe(403);
    const empDay = String((await day('employee'))!._id);
    expect((await get('manager', `/attendance/days/${empDay}`)).status).toBe(200);
    expect((await get('manager', `/attendance/days/${id}`)).status).toBe(404); // not on the manager's team
  });

  it('rejects ranges over 93 days and bad dates', async () => {
    expect((await get('hr', '/attendance/days?from=2026-01-01&to=2026-12-31')).status).toBe(422);
    expect((await get('hr', '/attendance/days?from=2026-02-30x&to=2026-03-01')).status).toBe(422);
    expect((await get('hr', '/attendance/days?from=2026-03-05&to=2026-03-01')).status).toBe(422);
  });
});
