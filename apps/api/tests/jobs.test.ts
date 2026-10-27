import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { QueueEvents } from 'bullmq';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AttendanceDay } from '../src/database/models/attendanceDay.model';
import { AttendanceEvent } from '../src/database/models/attendanceEvent.model';
import { AttendanceException } from '../src/database/models/attendanceException.model';
import { Tenant } from '../src/database/models/tenant.model';
import { dailyAttendanceSweep, purgeLocationData } from '../src/jobs/handlers';
import {
  JOBS,
  QUEUE_NAME,
  createQueue,
  createWorker,
  redisConnection,
  registerSchedules,
} from '../src/jobs/queue';
import {
  FakeClock,
  OFFICE,
  addPerson,
  bearer,
  createTenant,
  ist,
  loginAs,
  newKey,
  inside,
  setupSchedule,
  startTestApp,
  stopTestApp,
  testEnv,
  type TestTenant,
} from './helpers';
import { createLogger } from '../src/config/logger';

let app: Express;
let t: TestTenant;
let beta: TestTenant;
let clock: FakeClock;
const THU = '2026-03-05';
const MON = '2026-03-02';

beforeAll(async () => {
  clock = new FakeClock(ist(MON, '09:00'));
  ({ app } = await startTestApp({}, { clock }));
  t = await createTenant('acme');
  beta = await createTenant('beta');
  await setupSchedule(t);
  await setupSchedule(beta);
  const tok = await loginAs(app, t.people.employee.email);
  // employee checks in Monday and never checks out
  await request(app)
    .post('/api/v1/attendance/check-in')
    .set(bearer(tok))
    .send({ idempotencyKey: newKey('ci'), location: inside() });
  clock.set(ist(THU, '02:00'));
});
afterAll(stopTestApp);

const dayRows = (tid: TestTenant, who: keyof TestTenant['people']) =>
  AttendanceDay.find({ tenantId: tid.tenantId, employeeId: tid.people[who].employeeId })
    .sort({ workDate: 1 })
    .lean();

describe('daily attendance sweep', () => {
  it('only runs for tenants whose local hour is in the window', async () => {
    const r = await dailyAttendanceSweep(ist(THU, '12:00'), { localHours: [1, 2] });
    expect(r.tenants).toBe(0);
    expect(r.skipped).toBeGreaterThanOrEqual(2);
    expect(await dayRows(t, 'employee2')).toHaveLength(0);
  });

  it('materialises past days, never today, is idempotent, and finishes stale open sessions', async () => {
    const r = await dailyAttendanceSweep(ist(THU, '02:00'), {
      localHours: [1, 2],
      lookbackDays: 3,
    });
    expect(r.failed).toBe(0);
    expect(r.tenants).toBeGreaterThanOrEqual(2);
    const rows = await dayRows(t, 'employee2');
    // Mon, Tue, Wed absent (lookback 3 from Wed); Thursday (today) untouched
    expect(rows.map((x) => `${x.workDate}:${x.status}`)).toEqual([
      `${MON}:ABSENT`,
      '2026-03-03:ABSENT',
      '2026-03-04:ABSENT',
    ]);
    // the forgotten check-out is flagged, not silently counted
    const mon = (await dayRows(t, 'employee')).find((x) => x.workDate === MON)!;
    expect(mon.status).toBe('INCOMPLETE');
    expect(mon.isOpen).toBe(false);

    const again = await dailyAttendanceSweep(ist(THU, '02:30'), {
      localHours: [1, 2],
      lookbackDays: 3,
    });
    expect(again.failed).toBe(0);
    expect(await AttendanceDay.countDocuments({ tenantId: t.tenantId })).toBe(
      await AttendanceDay.countDocuments({ tenantId: t.tenantId }),
    );
    expect((await dayRows(t, 'employee2')).length).toBe(3);
  });

  it('skips people with no shift and days before joining', async () => {
    const p = await addPerson(t.tenantId, 'acme', 'noshift', ['EMPLOYEE'], t.department);
    await dailyAttendanceSweep(ist(THU, '02:00'), { localHours: [1, 2], lookbackDays: 3 });
    expect(await AttendanceDay.countDocuments({ employeeId: p.employeeId })).toBe(0);
  });

  it('one broken tenant does not stop the others', async () => {
    const bad = await Tenant.create({ name: 'Bad', slug: 'bad-tz', timezone: 'Asia/Kolkata' });
    await Tenant.collection.updateOne({ _id: bad._id }, { $set: { timezone: 'Not/AZone' } });
    const errors: unknown[] = [];
    const r = await dailyAttendanceSweep(ist(THU, '02:00'), {
      lookbackDays: 3,
      log: { error: (...a: unknown[]) => void errors.push(a), info: () => undefined },
    });
    expect(r.failed).toBe(1);
    expect(r.tenants).toBeGreaterThanOrEqual(2);
    expect(errors).toHaveLength(1);
    await Tenant.deleteOne({ _id: bad._id });
  });
});

describe('location retention', () => {
  it('erases coordinates from old punches only, keeping the ledger intact', async () => {
    const old = await AttendanceEvent.create({
      tenantId: t.tenantId,
      employeeId: t.people.employee.employeeId,
      eventType: 'CHECK_IN',
      occurredAt: new Date('2025-10-01T04:00:00Z'),
      receivedAt: new Date('2025-10-01T04:00:00Z'),
      workDate: '2025-10-01',
      location: { type: 'Point', coordinates: [OFFICE.longitude, OFFICE.latitude] },
      locationAccuracyMeters: 9,
      verification: { status: 'VERIFIED', method: 'GEOFENCE', distanceMeters: 12 },
      idempotencyKey: newKey('old'),
    });
    const fresh = await AttendanceEvent.create({
      tenantId: t.tenantId,
      employeeId: t.people.employee.employeeId,
      eventType: 'CHECK_IN',
      occurredAt: ist('2026-03-04', '09:00'),
      receivedAt: ist('2026-03-04', '09:00'),
      workDate: '2026-03-04',
      location: { type: 'Point', coordinates: [OFFICE.longitude, OFFICE.latitude] },
      verification: { status: 'VERIFIED' },
      idempotencyKey: newKey('fresh'),
    });
    const oldEx = await AttendanceException.create({
      tenantId: t.tenantId,
      employeeId: t.people.employee.employeeId,
      eventType: 'CHECK_IN',
      occurredAt: new Date('2025-10-02T04:00:00Z'),
      failure: 'OUTSIDE_GEOFENCE',
      employeeReason: 'x',
      location: { type: 'Point', coordinates: [OFFICE.longitude, OFFICE.latitude] },
      status: 'REJECTED',
      idempotencyKey: newKey('ex'),
    });
    const pendingEx = await AttendanceException.create({
      tenantId: t.tenantId,
      employeeId: t.people.employee.employeeId,
      eventType: 'CHECK_IN',
      occurredAt: new Date('2025-10-03T04:00:00Z'),
      failure: 'OUTSIDE_GEOFENCE',
      employeeReason: 'x',
      location: { type: 'Point', coordinates: [OFFICE.longitude, OFFICE.latitude] },
      status: 'PENDING',
      idempotencyKey: newKey('ex'),
    });

    const now = ist(THU, '03:00');
    const r = await purgeLocationData(now, 90);
    expect(r.events).toBe(1);
    expect(r.exceptions).toBe(1);

    const o = (await AttendanceEvent.collection.findOne({ _id: old._id }))!;
    expect(o.location).toBeUndefined();
    expect(o.locationAccuracyMeters).toBeUndefined();
    expect(o.locationPurgedAt).toEqual(now);
    expect(o.occurredAt).toEqual(new Date('2025-10-01T04:00:00Z'));
    expect(o.eventType).toBe('CHECK_IN');
    expect(o.verification.distanceMeters).toBe(12);
    expect((await AttendanceEvent.collection.findOne({ _id: fresh._id }))!.location).toBeDefined();
    expect(
      (await AttendanceException.collection.findOne({ _id: oldEx._id }))!.location,
    ).toBeUndefined();
    expect(
      (await AttendanceException.collection.findOne({ _id: pendingEx._id }))!.location,
    ).toBeDefined();

    expect((await purgeLocationData(now, 90)).events).toBe(0); // idempotent
    // the ordinary application path is still locked down
    await expect(
      AttendanceEvent.updateOne({ _id: old._id }, { $set: { eventType: 'CHECK_OUT' } }),
    ).rejects.toThrow(/immutable/);
  });
});

const REDIS_BIN = ['/usr/bin/redis-server', '/usr/local/bin/redis-server'].find(existsSync);
describe.skipIf(!REDIS_BIN && !process.env.TEST_REDIS_URL)('BullMQ with a real Redis', () => {
  let proc: ChildProcess | undefined;
  let url: string;
  beforeAll(async () => {
    if (process.env.TEST_REDIS_URL) url = process.env.TEST_REDIS_URL;
    else {
      const port = 6390 + Math.floor(Math.random() * 100);
      proc = spawn(REDIS_BIN!, ['--port', String(port), '--save', '', '--appendonly', 'no'], {
        stdio: 'ignore',
      });
      url = `redis://127.0.0.1:${port}`;
    }
    const c = redisConnection(url);
    c.on('error', () => undefined); // expected while redis-server is still starting
    for (let i = 0; i < 50; i++) {
      try {
        await c.ping();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    c.disconnect();
  });
  afterAll(() => void proc?.kill());

  it('registers schedules idempotently', async () => {
    const q = createQueue(url);
    await registerSchedules(q);
    await registerSchedules(q);
    const s = await q.getJobSchedulers();
    expect(s.map((x) => x.name).sort()).toEqual([JOBS.purge, JOBS.sweep, JOBS.uploads].sort());
    await q.close();
  });

  it('a worker runs a queued job and the handler changes the database', async () => {
    const q = createQueue(url);
    const events = new QueueEvents(QUEUE_NAME, { connection: redisConnection(url) });
    await events.waitUntilReady();
    const env = testEnv({ LOCATION_RETENTION_DAYS: '30' });
    const ev = await AttendanceEvent.create({
      tenantId: t.tenantId,
      employeeId: t.people.employee2.employeeId,
      eventType: 'CHECK_IN',
      occurredAt: new Date('2025-01-01T04:00:00Z'),
      receivedAt: new Date('2025-01-01T04:00:00Z'),
      workDate: '2025-01-01',
      location: { type: 'Point', coordinates: [1, 2] },
      verification: { status: 'VERIFIED' },
      idempotencyKey: newKey('w'),
    });
    const worker = createWorker(url, {
      env,
      log: createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' }),
      now: () => ist(THU, '03:00'),
    });
    const job = await q.add(JOBS.purge, {});
    const result = (await job.waitUntilFinished(events, 20_000)) as { events: number };
    expect(result.events).toBeGreaterThanOrEqual(1);
    expect((await AttendanceEvent.collection.findOne({ _id: ev._id }))!.location).toBeUndefined();

    const bad = await q.add('no-such-job', {}, { attempts: 1 });
    await expect(bad.waitUntilFinished(events, 20_000)).rejects.toThrow(/Unknown job/);
    await worker.close();
    await events.close();
    await q.close();
  });
});
