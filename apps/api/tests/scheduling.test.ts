import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/database/models/auditLog.model';
import { Department } from '../src/database/models/department.model';
import { Employee } from '../src/database/models/employee.model';
import { Shift } from '../src/database/models/shift.model';
import { ShiftAssignment } from '../src/database/models/shiftAssignment.model';
import { WorkLocation } from '../src/database/models/workLocation.model';
import {
  OFFICE,
  bearer,
  createTenant,
  loginAs,
  startTestApp,
  stopTestApp,
  type TestTenant,
} from './helpers';

let app: Express;
let a: TestTenant;
let b: TestTenant;
const tok: Record<string, string> = {};
let tokB: string;
const call = (m: 'get' | 'post' | 'patch', who: string, path: string, body?: object) =>
  request(app)[m](`/api/v1${path}`).set(bearer(tok[who]!)).send(body);

beforeAll(async () => {
  ({ app } = await startTestApp());
  a = await createTenant('acme');
  b = await createTenant('zeta');
  for (const k of Object.keys(a.people) as (keyof TestTenant['people'])[])
    tok[k] = await loginAs(app, a.people[k].email);
  tokB = await loginAs(app, b.people.owner.email);
});
afterAll(stopTestApp);

describe('work locations', () => {
  let id: string;
  it('HR creates a location; coordinates are stored as GeoJSON [longitude, latitude]', async () => {
    const res = await call('post', 'hr', '/work-locations', {
      name: 'HQ',
      address: 'MG Road',
      ...OFFICE,
      radiusMeters: 150,
    });
    expect(res.status).toBe(201);
    id = res.body.data.id;
    expect(res.body.data).toMatchObject({
      latitude: OFFICE.latitude,
      longitude: OFFICE.longitude,
      radiusMeters: 150,
      allowedAttendanceMethods: ['GEOFENCE'],
    });
    const raw = await WorkLocation.findById(id).lean();
    expect(raw!.location!.coordinates).toEqual([OFFICE.longitude, OFFICE.latitude]);
  });
  it('rejects invalid coordinates, tiny radius, duplicates, and non-managers', async () => {
    expect(
      (await call('post', 'hr', '/work-locations', { name: 'Bad', latitude: 120, longitude: 0 }))
        .status,
    ).toBe(422);
    expect(
      (await call('post', 'hr', '/work-locations', { name: 'Bad', latitude: 1, longitude: 200 }))
        .status,
    ).toBe(422);
    expect(
      (
        await call('post', 'hr', '/work-locations', {
          name: 'Bad',
          latitude: 1,
          longitude: 1,
          radiusMeters: 1,
        })
      ).status,
    ).toBe(422);
    expect((await call('post', 'hr', '/work-locations', { name: 'HQ', ...OFFICE })).status).toBe(
      409,
    );
    expect(
      (await call('post', 'employee', '/work-locations', { name: 'Mine', ...OFFICE })).status,
    ).toBe(403);
    expect(
      (await call('post', 'manager', '/work-locations', { name: 'Mine', ...OFFICE })).status,
    ).toBe(403);
  });
  it('the sample-location test reports inside/outside and distance without recording anything', async () => {
    const near = await call('post', 'hr', `/work-locations/${id}/test`, {
      latitude: OFFICE.latitude + 0.0005,
      longitude: OFFICE.longitude,
    });
    expect(near.body.data.inside).toBe(true);
    const far = await call('post', 'hr', `/work-locations/${id}/test`, {
      latitude: OFFICE.latitude + 0.01,
      longitude: OFFICE.longitude,
    });
    expect(far.body.data.inside).toBe(false);
    expect(far.body.data.distanceMeters).toBeGreaterThan(1000);
  });
  it("updating coordinates keeps lon/lat order; everyone can read, nobody sees other tenants' locations", async () => {
    const res = await call('patch', 'hr', `/work-locations/${id}`, { latitude: 13.0 });
    expect(res.body.data).toMatchObject({ latitude: 13.0, longitude: OFFICE.longitude });
    expect((await call('get', 'employee', '/work-locations')).body.data).toHaveLength(1);
    const other = await request(app).get('/api/v1/work-locations').set(bearer(tokB));
    expect(other.body.data).toHaveLength(0);
    expect(
      (
        await request(app)
          .patch(`/api/v1/work-locations/${id}`)
          .set(bearer(tokB))
          .send({ name: 'Hijack' })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(`/api/v1/work-locations/${id}/test`)
          .set(bearer(tokB))
          .send({ latitude: 0, longitude: 0 })
      ).status,
    ).toBe(404);
    expect(await AuditLog.countDocuments({ action: 'work_location.update' })).toBe(1);
  });
  it('employees can be assigned only locations of their own company', async () => {
    const mine = (await WorkLocation.findOne({ tenantId: a.tenantId }).lean())!._id;
    const theirs = await WorkLocation.create({
      tenantId: b.tenantId,
      name: 'Zeta HQ',
      location: { type: 'Point', coordinates: [1, 1] },
    });
    expect(
      (
        await call('patch', 'hr', `/employees/${a.people.employee.employeeId}`, {
          workLocationIds: [String(theirs._id)],
        })
      ).status,
    ).toBe(400);
    const ok = await call('patch', 'hr', `/employees/${a.people.employee.employeeId}`, {
      workLocationIds: [String(mine)],
      attendanceMode: 'OFFICE',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data.workLocationIds).toEqual([String(mine)]);
    await Employee.updateOne(
      { _id: a.people.employee.employeeId },
      { $set: { workLocationIds: [] } },
    );
  });
});

describe('shifts', () => {
  const base = {
    name: 'Day',
    startTime: '09:00',
    endTime: '18:00',
    graceMinutes: 10,
    weeklyOffDays: [0, 6],
    breakPolicy: { type: 'RECORDED', paidAllowanceMinutes: 15, expectedUnpaidMinutes: 45 },
    overtimePolicy: { enabled: true, thresholdMinutes: 30 },
  };
  let shiftId: string;
  it('creates day and overnight shifts; overnight is detected', async () => {
    const day = await call('post', 'hr', '/shifts', base);
    expect(day.status).toBe(201);
    shiftId = day.body.data.id;
    expect(day.body.data.overnight).toBe(false);
    const night = await call('post', 'hr', '/shifts', {
      name: 'Night',
      startTime: '22:00',
      endTime: '06:00',
    });
    expect(night.body.data.overnight).toBe(true);
    expect(night.body.data.weeklyOffDays).toEqual([0]); // default
  });
  it('validates times, thresholds, duplicates and permissions', async () => {
    expect(
      (await call('post', 'hr', '/shifts', { name: 'X', startTime: '9:00', endTime: '18:00' }))
        .status,
    ).toBe(422);
    expect(
      (await call('post', 'hr', '/shifts', { name: 'X', startTime: '25:00', endTime: '18:00' }))
        .status,
    ).toBe(422);
    expect(
      (await call('post', 'hr', '/shifts', { name: 'X', startTime: '09:00', endTime: '09:00' }))
        .status,
    ).toBe(422);
    expect(
      (
        await call('post', 'hr', '/shifts', {
          name: 'X',
          startTime: '09:00',
          endTime: '18:00',
          minHalfDayMinutes: 300,
          minFullDayMinutes: 200,
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call('post', 'hr', '/shifts', {
          name: 'X',
          startTime: '09:00',
          endTime: '18:00',
          timezone: 'Mars/Base',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call('post', 'hr', '/shifts', {
          name: 'X',
          startTime: '09:00',
          endTime: '18:00',
          weeklyOffDays: [7],
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call('post', 'hr', '/shifts', {
          name: 'X',
          startTime: '09:00',
          endTime: '18:00',
          weeklyOffDays: [1, 1],
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call('post', 'hr', '/shifts', {
          name: 'X',
          startTime: '09:00',
          endTime: '18:00',
          tenantId: String(b.tenantId),
        })
      ).status,
    ).toBe(422);
    expect((await call('post', 'hr', '/shifts', base)).status).toBe(409);
    expect(
      (
        await call('post', 'employee', '/shifts', {
          name: 'Y',
          startTime: '09:00',
          endTime: '18:00',
        })
      ).status,
    ).toBe(403);
    expect((await call('get', 'employee', '/shifts')).status).toBe(200);
  });
  it('patch merges nested policy fields and is audited', async () => {
    const res = await call('patch', 'hr', `/shifts/${shiftId}`, {
      graceMinutes: 5,
      breakPolicy: { paidAllowanceMinutes: 30 },
      overtimePolicy: { maxMinutesPerDay: 90 },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.breakPolicy).toMatchObject({
      type: 'RECORDED',
      paidAllowanceMinutes: 30,
      expectedUnpaidMinutes: 45,
    });
    expect(res.body.data.overtimePolicy).toMatchObject({
      enabled: true,
      thresholdMinutes: 30,
      maxMinutesPerDay: 90,
    });
    expect((await call('patch', 'hr', `/shifts/${shiftId}`, { endTime: '09:00' })).status).toBe(
      400,
    );
    expect(await AuditLog.countDocuments({ action: 'shift.update' })).toBe(1);
  });
  it('another company cannot touch it', async () => {
    expect(
      (
        await request(app)
          .patch(`/api/v1/shifts/${shiftId}`)
          .set(bearer(tokB))
          .send({ name: 'Hijack' })
      ).status,
    ).toBe(404);
    expect((await request(app).get('/api/v1/shifts').set(bearer(tokB))).body.data).toHaveLength(0);
  });

  describe('assignments', () => {
    const asg = (over: object) =>
      call('post', 'hr', '/shift-assignments', { shiftId, effectiveFrom: '2026-01-01', ...over });
    it('assigns to employees and detects overlaps without partial writes', async () => {
      const e1 = String(a.people.employee.employeeId);
      const e2 = String(a.people.employee2.employeeId);
      expect(
        (await asg({ employeeIds: [e1], effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30' }))
          .status,
      ).toBe(201);
      const clash = await asg({ employeeIds: [e2, e1], effectiveFrom: '2026-06-30' }); // touches e1's last day
      expect(clash.status).toBe(409);
      expect(clash.body.error.details.conflicts).toHaveLength(1);
      expect(clash.body.error.details.conflicts[0].employeeId).toBe(e1);
      expect(
        await ShiftAssignment.countDocuments({ employeeId: a.people.employee2.employeeId }),
      ).toBe(0); // all-or-nothing
      expect((await asg({ employeeIds: [e1], effectiveFrom: '2026-07-01' })).status).toBe(201); // adjacent, no overlap
      expect(
        (await asg({ employeeIds: [e2], effectiveFrom: '2026-01-01', effectiveTo: '2025-12-31' }))
          .status,
      ).toBe(422);
    });
    it('ending an assignment frees the range', async () => {
      const existing = await ShiftAssignment.findOne({
        employeeId: a.people.employee.employeeId,
        effectiveFrom: '2026-07-01',
      }).lean();
      const ended = await call('patch', 'hr', `/shift-assignments/${existing!._id}`, {
        effectiveTo: '2026-07-31',
      });
      expect(ended.status).toBe(200);
      expect(
        (
          await asg({
            employeeIds: [String(a.people.employee.employeeId)],
            effectiveFrom: '2026-08-01',
          })
        ).status,
      ).toBe(201);
    });
    it('concurrent overlapping assignments for the same employee: only one succeeds', async () => {
      const target = String(a.people.payroll.employeeId);
      const results = await Promise.all(
        [1, 2, 3, 4].map(() => asg({ employeeIds: [target], effectiveFrom: '2027-01-01' })),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(3);
      expect(
        await ShiftAssignment.countDocuments({ employeeId: a.people.payroll.employeeId }),
      ).toBe(1);
    });
    it('assigns a whole department (active members only)', async () => {
      const ops = await Department.create({ tenantId: a.tenantId, name: 'Operations' });
      const mk = (code: string, status: string) =>
        Employee.create({
          tenantId: a.tenantId,
          employeeCode: code,
          firstName: code,
          lastName: 'Ops',
          workEmail: `${code}@acme.test`,
          departmentId: ops._id,
          employmentStatus: status,
        });
      const [x, y, gone] = await Promise.all([
        mk('OPS1', 'ACTIVE'),
        mk('OPS2', 'NOTICE_PERIOD'),
        mk('OPS3', 'TERMINATED'),
      ]);
      const res = await asg({ departmentId: String(ops._id), effectiveFrom: '2028-01-01' });
      expect(res.status).toBe(201);
      const ids = res.body.data.map((r: { employeeId: string }) => r.employeeId).sort();
      expect(ids).toEqual([String(x._id), String(y._id)].sort());
      expect(ids).not.toContain(String(gone._id));
      expect(
        (await asg({ departmentId: String(ops._id), effectiveFrom: '2028-06-01' })).status,
      ).toBe(409); // whole department conflicts
    });
    it('requires exactly one target, valid references and permission', async () => {
      expect((await asg({})).status).toBe(422);
      expect(
        (
          await asg({
            employeeIds: [String(a.people.hr.employeeId)],
            departmentId: String(a.department),
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await call('post', 'employee', '/shift-assignments', {
            shiftId,
            employeeIds: [String(a.people.hr.employeeId)],
            effectiveFrom: '2030-01-01',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await call('post', 'manager', '/shift-assignments', {
            shiftId,
            employeeIds: [String(a.people.hr.employeeId)],
            effectiveFrom: '2030-01-01',
          })
        ).status,
      ).toBe(403);
    });
    it('cross-tenant references are rejected', async () => {
      const zShift = await Shift.create({
        tenantId: b.tenantId,
        name: 'Z',
        startTime: '08:00',
        endTime: '16:00',
      });
      expect(
        (
          await asg({
            shiftId: String(zShift._id),
            employeeIds: [String(a.people.hr.employeeId)],
            effectiveFrom: '2031-01-01',
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await asg({
            employeeIds: [String(b.people.employee.employeeId)],
            effectiveFrom: '2031-01-01',
          })
        ).status,
      ).toBe(400);
      expect(
        (await asg({ departmentId: String(b.department), effectiveFrom: '2031-01-01' })).status,
      ).toBe(400);
      const foreign = await request(app)
        .post('/api/v1/shift-assignments')
        .set(bearer(tokB))
        .send({
          shiftId,
          employeeIds: [String(b.people.employee.employeeId)],
          effectiveFrom: '2031-01-01',
        });
      expect(foreign.status).toBe(400); // acme's shift is invisible to zeta
      const mine = await ShiftAssignment.findOne({ tenantId: a.tenantId }).lean();
      expect(
        (
          await request(app)
            .patch(`/api/v1/shift-assignments/${mine!._id}`)
            .set(bearer(tokB))
            .send({ effectiveTo: '2040-01-01' })
        ).status,
      ).toBe(404);
    });
    it('employees see only their own assignments', async () => {
      const mineOnly = (await call('get', 'employee', '/shift-assignments')).body.data;
      expect(
        mineOnly.every(
          (x: { employeeId: string }) => x.employeeId === String(a.people.employee.employeeId),
        ),
      ).toBe(true);
      expect(
        (await call('get', 'employee', `/shift-assignments?employeeId=${a.people.hr.employeeId}`))
          .status,
      ).toBe(403);
      expect(
        (await call('get', 'hr', `/shift-assignments?employeeId=${a.people.hr.employeeId}`)).status,
      ).toBe(200);
    });
  });
});

describe('holidays', () => {
  it('HR manages holidays; employees can read; location must belong to the company', async () => {
    const res = await call('post', 'hr', '/holidays', { name: 'Founders Day', date: '2026-03-16' });
    expect(res.status).toBe(201);
    expect(
      (await call('post', 'employee', '/holidays', { name: 'X', date: '2026-03-17' })).status,
    ).toBe(403);
    expect((await call('post', 'hr', '/holidays', { name: 'X', date: '2026-02-30' })).status).toBe(
      422,
    );
    expect((await call('post', 'hr', '/holidays', { name: 'X', date: '16-03-2026' })).status).toBe(
      422,
    );
    const foreignLoc = await WorkLocation.create({
      tenantId: b.tenantId,
      name: 'ZL',
      location: { type: 'Point', coordinates: [1, 1] },
    });
    expect(
      (
        await call('post', 'hr', '/holidays', {
          name: 'X',
          date: '2026-03-17',
          workLocationId: String(foreignLoc._id),
        })
      ).status,
    ).toBe(400);
    const list = await call('get', 'employee', '/holidays?from=2026-03-01&to=2026-03-31');
    expect(list.body.data).toHaveLength(1);
    expect((await request(app).get('/api/v1/holidays').set(bearer(tokB))).body.data).toHaveLength(
      0,
    );
    expect(
      (
        await request(app)
          .patch(`/api/v1/holidays/${res.body.data.id}`)
          .set(bearer(tokB))
          .send({ name: 'Hijack' })
      ).status,
    ).toBe(404);
    const off = await call('patch', 'hr', `/holidays/${res.body.data.id}`, { status: 'INACTIVE' });
    expect(off.status).toBe(200);
    expect((await call('get', 'employee', '/holidays')).body.data).toHaveLength(0);
  });
});
