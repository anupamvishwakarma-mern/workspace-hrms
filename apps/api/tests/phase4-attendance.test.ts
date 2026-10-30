import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApprovalRequest } from '../src/database/models/approvalRequest.model';
import { AttendanceCorrection } from '../src/database/models/attendanceCorrection.model';
import { AttendanceDay } from '../src/database/models/attendanceDay.model';
import { AuditLog } from '../src/database/models/auditLog.model';
import { Employee } from '../src/database/models/employee.model';
import {
  FakeClock,
  bearer,
  createTenant,
  inside,
  ist,
  loginAs,
  outside,
  setupSchedule,
  startTestApp,
  stopTestApp,
  type TestTenant,
} from './helpers';

let app: Express;
let t: TestTenant;
let flex: TestTenant;
let clock: FakeClock;
const tok: Record<string, string> = {};
const call = (m: 'get' | 'post' | 'patch', who: string, path: string, body?: object) => {
  const r = request(app)[m](`/api/v1${path}`).set(bearer(tok[who]!));
  return body ? r.send(body) : r;
};
let n = 0;
const punch = (who: string, action: 'check-in' | 'check-out', location: object = inside()) =>
  call('post', who, `/attendance/${action}`, { idempotencyKey: `p4-${++n}-${action}`, location });
const at = (date: string, time: string) => clock.set(ist(date, time));
const eid = (k: keyof TestTenant['people'], tt: TestTenant = t) => String(tt.people[k].employeeId);
const day = (tt: TestTenant, who: keyof TestTenant['people'], date: string) =>
  AttendanceDay.findOne({ tenantId: tt.tenantId, employeeId: tt.people[who].employeeId, workDate: date }).lean();

beforeAll(async () => {
  clock = new FakeClock(ist('2026-03-04', '08:00'));
  ({ app } = await startTestApp({}, { clock }));
  t = await createTenant('p4');
  flex = await createTenant('p4flex');
  await setupSchedule(t);
  await setupSchedule(flex, {
    shiftType: 'FLEXIBLE',
    minFullDayMinutes: 480,
    minHalfDayMinutes: 240,
    breakPolicy: { type: 'RECORDED', expectedUnpaidMinutes: 0 },
  });
  for (const k of Object.keys(t.people) as (keyof TestTenant['people'])[]) {
    tok[k] = await loginAs(app, t.people[k].email);
    tok[`f-${k}`] = await loginAs(app, flex.people[k].email);
  }
});
afterAll(stopTestApp);

describe('manual attendance by HR', () => {
  const body = (over: object = {}) => ({
    employeeId: eid('employee'),
    workDate: '2026-03-02',
    checkIn: ist('2026-03-02', '09:00').toISOString(),
    checkOut: ist('2026-03-02', '18:00').toISOString(),
    reason: 'Biometric device was down',
    ...over,
  });

  it('only HR and the owner, never for themselves, always with a reason', async () => {
    expect((await call('post', 'employee', '/attendance/manual', body())).status).toBe(403);
    expect((await call('post', 'manager', '/attendance/manual', body())).status).toBe(403);
    expect((await call('post', 'hr', '/attendance/manual', body({ employeeId: eid('hr') }))).status).toBe(403);
    expect((await call('post', 'hr', '/attendance/manual', body({ reason: 'x' }))).status).toBe(422);
    expect((await call('post', 'hr', '/attendance/manual', body({ employeeId: eid('employee', flex) }))).status).toBe(404);
  });

  it('records the day as approved, marks it HR_MANUAL, and audits it', async () => {
    const r = await call('post', 'hr', '/attendance/manual', body());
    expect(r.status).toBe(201);
    expect(r.body.data.status).toBe('APPROVED');
    expect(r.body.data.origin).toBe('HR_MANUAL');
    const d = await day(t, 'employee', '2026-03-02');
    expect(d!.status).toBe('PRESENT');
    const c = await AttendanceCorrection.findOne({ tenantId: t.tenantId, _id: r.body.data.id }).lean();
    expect(c!.origin).toBe('HR_MANUAL');
    expect(await AuditLog.countDocuments({ tenantId: t.tenantId, action: 'attendance.manual_entry' })).toBe(1);
    // the owner may do it too
    const o = await call('post', 'owner', '/attendance/manual', body({ employeeId: eid('employee2'), reason: 'Owner confirmed in person' }));
    expect(o.status).toBe(201);
  });

  it('refuses times in the future or that clash with real punches, and leaves nothing pending', async () => {
    expect((await call('post', 'hr', '/attendance/manual', body({ workDate: '2026-03-04', checkIn: ist('2026-03-04', '09:00').toISOString(), checkOut: ist('2026-03-04', '18:00').toISOString() }))).status).toBe(400); // later today
    at('2026-03-03', '10:00');
    expect((await punch('manager', 'check-in')).status).toBe(201);
    at('2026-03-04', '08:00');
    const clash = await call('post', 'hr', '/attendance/manual', body({ employeeId: eid('manager'), workDate: '2026-03-03', checkIn: undefined, checkOut: ist('2026-03-03', '09:00').toISOString() }));
    expect(clash.status).toBe(400);
    expect(await AttendanceCorrection.countDocuments({ tenantId: t.tenantId, employeeId: t.people.manager.employeeId, status: 'PENDING' })).toBe(0);
  });
});

describe('shift types', () => {
  it('a flexible shift needs the hours that make a full day', async () => {
    const base = { name: 'Flex A', startTime: '09:00', endTime: '18:00', shiftType: 'FLEXIBLE' };
    expect((await call('post', 'hr', '/shifts', base)).status).toBe(422);
    const ok = await call('post', 'hr', '/shifts', { ...base, minFullDayMinutes: 480 });
    expect(ok.status).toBe(201);
    expect(ok.body.data.shiftType).toBe('FLEXIBLE');
    const fixed = await call('post', 'hr', '/shifts', { name: 'Fixed A', startTime: '09:00', endTime: '18:00' });
    expect(fixed.body.data.shiftType).toBe('FIXED');
    expect((await call('patch', 'hr', `/shifts/${fixed.body.data.id}`, { shiftType: 'FLEXIBLE' })).status).toBe(422);
  });

  it('a fixed shift marks a late arrival; a flexible one does not and counts hours instead', async () => {
    at('2026-03-04', '11:30');
    expect((await punch('employee2', 'check-in')).status).toBe(201);
    expect((await punch('f-employee', 'check-in')).status).toBe(201);
    at('2026-03-04', '20:00');
    expect((await punch('employee2', 'check-out')).status).toBe(201);
    expect((await punch('f-employee', 'check-out')).status).toBe(201);
    const fixedDay = await day(t, 'employee2', '2026-03-04');
    const flexDay = await day(flex, 'employee', '2026-03-04');
    expect(fixedDay!.lateMinutes).toBe(150);
    expect(flexDay!.lateMinutes).toBe(0);
    expect(flexDay!.earlyDepartureMinutes).toBe(0);
    expect(flexDay!.status).toBe('PRESENT'); // 8h30 worked >= 8h
  });
});

describe('work from home', () => {
  const wfh = (who: string, body: object, tt = t) => call('post', who, '/wfh/requests', body);
  let id: string;

  it('is validated: dates, remote staff, overlaps', async () => {
    at('2026-03-04', '08:00');
    expect((await wfh('employee', { startDate: '2026-03-06', endDate: '2026-03-05' })).status).toBe(400);
    expect((await wfh('employee', { startDate: '2026-01-01', endDate: '2026-01-02' })).status).toBe(400);
    expect((await wfh('employee', { startDate: '2026-03-05', endDate: '2026-05-30' })).status).toBe(400);
    await Employee.updateOne({ _id: t.people.payroll.employeeId, tenantId: t.tenantId }, { $set: { attendanceMode: 'REMOTE' } });
    expect((await wfh('payroll', { startDate: '2026-03-05', endDate: '2026-03-05' })).status).toBe(422);
  });

  it('goes to the manager through an automatically created workflow; HR cannot approve it', async () => {
    const r = await wfh('employee', { startDate: '2026-03-05', endDate: '2026-03-05', reason: 'Plumber visit' });
    expect(r.status).toBe(201);
    expect(r.body.data.status).toBe('PENDING');
    id = r.body.data.id;
    expect((await wfh('employee', { startDate: '2026-03-05', endDate: '2026-03-06' })).status).toBe(409); // overlap
    const wfs = await call('get', 'hr', '/approval-workflows');
    expect(wfs.body.data.map((w: { requestType: string }) => w.requestType)).toContain('WFH');
    const inbox = await call('get', 'manager', '/approvals?scope=inbox');
    const ap = inbox.body.data.find((x: { requestType: string }) => x.requestType === 'WFH');
    expect(ap).toBeTruthy();
    expect((await call('post', 'hr', `/approvals/${ap.id}/decision`, { decision: 'APPROVE' })).status).toBe(404);
    expect((await call('post', 'manager', `/approvals/${ap.id}/decision`, { decision: 'APPROVE' })).status).toBe(200);
    const mine = await call('get', 'employee', '/wfh/requests');
    expect(mine.body.data.find((x: { id: string }) => x.id === id).status).toBe('APPROVED');
  });

  it('relaxes the office location rule on the approved day only', async () => {
    at('2026-03-05', '08:55');
    expect((await punch('employee2', 'check-in', outside())).status).toBe(422); // no approval: still enforced
    const ok = await punch('employee', 'check-in', outside());
    expect(ok.status).toBe(201);
    expect(ok.body.data.event.verification.status).toBe('NOT_REQUIRED');
    await punch('employee', 'check-out', outside());
    at('2026-03-06', '08:55');
    expect((await punch('employee', 'check-in', outside())).status).toBe(422); // the next day is not covered
  });

  it('approved days that have started cannot be withdrawn; pending ones can', async () => {
    at('2026-03-05', '12:00');
    expect((await call('post', 'employee', `/wfh/requests/${id}/cancel`, {})).status).toBe(409);
    at('2026-03-05', '12:30');
    const r = await wfh('employee2', { startDate: '2026-03-10', endDate: '2026-03-11' });
    expect(r.status).toBe(201);
    const ap = await ApprovalRequest.findOne({ tenantId: t.tenantId, requestType: 'WFH', requesterEmployeeId: t.people.employee2.employeeId }).lean();
    expect((await call('post', 'employee2', `/wfh/requests/${r.body.data.id}/cancel`, {})).body.data.status).toBe('CANCELLED');
    const after = await ApprovalRequest.findOne({ _id: ap!._id, tenantId: t.tenantId }).lean();
    expect(after!.status).toBe('CANCELLED');
    expect((await call('post', 'manager', `/wfh/requests/${r.body.data.id}/cancel`, {})).status).toBe(404);
  });

  it('only HR sees everyone\'s requests', async () => {
    expect((await call('get', 'employee', '/wfh/requests?scope=all')).status).toBe(403);
    const all = await call('get', 'hr', '/wfh/requests?scope=all');
    expect(all.status).toBe(200);
    expect(all.body.data.length).toBeGreaterThan(0);
    expect(all.body.data[0].employeeName).toBeTruthy();
  });

  it('is isolated per company', async () => {
    const mine = await call('get', 'f-employee', '/wfh/requests');
    expect(mine.body.data).toHaveLength(0);
  });
});
