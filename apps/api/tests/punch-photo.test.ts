import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Express } from 'express';
import S3rver from 's3rver';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { purgePunchPhotos } from '../src/jobs/handlers';
import { AttendanceEvent } from '../src/database/models/attendanceEvent.model';
import { AuditLog } from '../src/database/models/auditLog.model';
import { PunchPhoto } from '../src/database/models/punchPhoto.model';
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
  testEnv,
  type TestTenant,
} from './helpers';

let app: Express;
let t: TestTenant;
let beta: TestTenant;
let clock: FakeClock;
let s3: S3rver;
let dir: string;
const tok: Record<string, string> = {};
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
const PORT = 4870 + Math.floor(Math.random() * 100);
const MON = '2026-03-02';

const post = (who: string, path: string, body: object = {}) =>
  request(app).post(`/api/v1${path}`).set(bearer(tok[who]!)).send(body);
const get = (who: string, path: string) =>
  request(app).get(`/api/v1${path}`).set(bearer(tok[who]!));

async function newPhoto(who = 'employee', body: Buffer | null = JPEG) {
  const r = await post(who, '/attendance/photos', {
    contentType: 'image/jpeg',
    sizeBytes: JPEG.length,
  });
  expect(r.status).toBe(201);
  if (body) {
    const put = await fetch(r.body.data.upload.url, {
      method: 'PUT',
      headers: r.body.data.upload.headers,
      body,
    });
    expect(put.status).toBe(200);
  }
  return r.body.data.photoId as string;
}
const punch = (who: string, action: string, extra: object = {}) =>
  post(who, `/attendance/${action}`, {
    idempotencyKey: newKey(action),
    location: inside(),
    ...extra,
  });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 's3p-'));
  s3 = new S3rver({
    port: PORT,
    address: '127.0.0.1',
    silent: true,
    directory: dir,
    configureBuckets: [{ name: 'docs', configs: [] }],
  });
  await s3.run();
  clock = new FakeClock(ist(MON, '08:55'));
  ({ app } = await startTestApp(
    {
      OBJECT_STORAGE_ENDPOINT: `http://127.0.0.1:${PORT}`,
      OBJECT_STORAGE_BUCKET: 'docs',
      OBJECT_STORAGE_ACCESS_KEY: 'S3RVER',
      OBJECT_STORAGE_SECRET_KEY: 'S3RVER',
    },
    { clock },
  ));
  t = await createTenant('acme');
  beta = await createTenant('beta');
  await setupSchedule(t);
  for (const k of Object.keys(t.people) as (keyof TestTenant['people'])[])
    tok[k] = await loginAs(app, t.people[k].email);
  tok.betaHr = await loginAs(app, beta.people.hr.email);
});
afterAll(async () => {
  await s3.close();
  rmSync(dir, { recursive: true, force: true });
  await stopTestApp();
});

describe('proof photo on punches', () => {
  it('is optional until the company turns the setting on', async () => {
    clock.set(ist(MON, '09:00'));
    const ci = await punch('employee2', 'check-in');
    expect(ci.status).toBe(201);
    expect(ci.body.data.event.hasPhoto).toBe(false);
    await punch('employee2', 'check-out');
  });

  it('requires a photo for check in/out (not breaks) once enabled, and links it to the punch', async () => {
    await Tenant.updateOne(
      { _id: t.tenantId },
      { $set: { 'settings.attendance.requirePhoto': true } },
    );
    clock.set(ist(MON, '09:05'));
    const missing = await punch('employee', 'check-in');
    expect(missing.status).toBe(422);
    expect(missing.body.error.code).toBe('PHOTO_REQUIRED');

    const photoId = await newPhoto();
    const ci = await punch('employee', 'check-in', { photoId });
    expect(ci.status).toBe(201);
    expect(ci.body.data.event.hasPhoto).toBe(true);
    expect(JSON.stringify(ci.body)).not.toMatch(/storageKey|tenants\//);
    expect((await PunchPhoto.findById(photoId).lean())!.status).toBe('USED');

    // breaks do not need one
    clock.set(ist(MON, '12:00'));
    expect((await punch('employee', 'break-start')).status).toBe(201);
    expect((await punch('employee', 'break-end')).status).toBe(201);
    // check-out does
    clock.set(ist(MON, '18:05'));
    expect((await punch('employee', 'check-out')).body.error.code).toBe('PHOTO_REQUIRED');
    expect((await punch('employee', 'check-out', { photoId: await newPhoto() })).status).toBe(201);
  });

  it('rejects reused, foreign, never-uploaded and malformed photos', async () => {
    clock.set(ist('2026-03-03', '09:00'));
    const used = (await AttendanceEvent.findOne({ photoId: { $exists: true } }).lean())!.photoId!;
    const reuse = await punch('employee', 'check-in', { photoId: String(used) });
    expect(reuse.status).toBe(422);
    expect(reuse.body.error.code).toBe('PHOTO_ALREADY_USED');

    const foreign = await newPhoto('employee2');
    expect((await punch('employee', 'check-in', { photoId: foreign })).body.error.code).toBe(
      'PHOTO_INVALID',
    );
    const never = await newPhoto('employee', null);
    expect((await punch('employee', 'check-in', { photoId: never })).body.error.code).toBe(
      'PHOTO_INVALID',
    );
    expect((await punch('employee', 'check-in', { photoId: 'not-an-id' })).status).toBe(422);

    for (const bad of [
      { contentType: 'text/html', sizeBytes: 100 },
      { contentType: 'image/jpeg', sizeBytes: 4 * 1024 * 1024 },
      { contentType: 'image/jpeg', sizeBytes: 0 },
      { contentType: 'image/jpeg', sizeBytes: 10, storageKey: 'x' },
    ])
      expect((await post('employee', '/attendance/photos', bad)).status).toBe(422);

    // a good photo still works after all those failures (nothing was consumed)
    expect((await punch('employee', 'check-in', { photoId: await newPhoto() })).status).toBe(201);
  });

  it('lets only the employee, HR and their manager view the photo; others get 404; HR views are audited', async () => {
    const ev = (await AttendanceEvent.findOne({
      tenantId: t.tenantId,
      employeeId: t.people.employee.employeeId,
      photoId: { $exists: true },
    }).lean())!;
    const path = `/attendance/events/${ev._id}/photo`;
    for (const who of ['employee', 'hr']) {
      const r = await get(who, path);
      expect(r.status).toBe(200);
      const file = await fetch(r.body.data.url);
      expect(file.status).toBe(200);
      expect(Buffer.from(await file.arrayBuffer()).equals(JPEG)).toBe(true);
    }
    expect(
      await AuditLog.countDocuments({ action: 'attendance.photo_viewed', entityId: ev._id }),
    ).toBe(1);
    for (const who of ['employee2', 'payroll', 'betaHr'])
      expect((await get(who, path)).status).toBe(404);
    const noPhoto = (await AttendanceEvent.findOne({
      tenantId: t.tenantId,
      employeeId: t.people.employee2.employeeId,
    }).lean())!;
    expect((await get('hr', `/attendance/events/${noPhoto._id}/photo`)).status).toBe(404);
  });
});

describe('retention', () => {
  it('deletes old photos from storage, keeps the punch, and the photo is then gone for viewers', async () => {
    const ev = (await AttendanceEvent.findOne({
      tenantId: t.tenantId,
      employeeId: t.people.employee.employeeId,
      photoId: { $exists: true },
    }).lean())!;
    const env = testEnv({
      OBJECT_STORAGE_ENDPOINT: `http://127.0.0.1:${PORT}`,
      OBJECT_STORAGE_BUCKET: 'docs',
      OBJECT_STORAGE_ACCESS_KEY: 'S3RVER',
      OBJECT_STORAGE_SECRET_KEY: 'S3RVER',
    });
    const future = new Date(Date.now() + 200 * 86_400_000);
    const r = await purgePunchPhotos(env, future, 90);
    expect(r.purged).toBeGreaterThanOrEqual(1);
    expect((await PunchPhoto.findById(ev.photoId).lean())!.status).toBe('DELETED');
    expect(await AttendanceEvent.exists({ _id: ev._id })).toBeTruthy();
    expect((await get('hr', `/attendance/events/${ev._id}/photo`)).status).toBe(404);
    expect((await purgePunchPhotos(env, future, 90)).purged).toBe(0);
  });
});

describe('storage not configured', () => {
  it('answers 503 for photo uploads instead of pretending', async () => {
    const { app: bare } = await startTestApp();
    const t2 = await createTenant('nostore2');
    const e = await loginAs(bare, t2.people.employee.email);
    const r = await request(bare)
      .post('/api/v1/attendance/photos')
      .set(bearer(e))
      .send({ contentType: 'image/jpeg', sizeBytes: 10 });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('STORAGE_NOT_CONFIGURED');
  });
});
