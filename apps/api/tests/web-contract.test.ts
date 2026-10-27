import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FakeClock,
  PASSWORD,
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

/** What the Next.js admin app relies on. Failing here means the web UI would break or over-expose. */
let app: Express;
let t: TestTenant;
let beta: TestTenant;
let clock: FakeClock;
const tok: Record<string, string> = {};
const MON = '2026-03-02';
const get = (who: string, path: string) =>
  request(app).get(`/api/v1${path}`).set(bearer(tok[who]!));
const post = (who: string, path: string, body: object = {}) =>
  request(app).post(`/api/v1${path}`).set(bearer(tok[who]!)).send(body);
const patch = (who: string, path: string, body: object) =>
  request(app).patch(`/api/v1${path}`).set(bearer(tok[who]!)).send(body);

beforeAll(async () => {
  clock = new FakeClock(ist(MON, '09:00'));
  ({ app } = await startTestApp({}, { clock }));
  t = await createTenant('acme');
  beta = await createTenant('beta');
  await setupSchedule(t);
  await setupSchedule(beta);
  for (const k of Object.keys(t.people) as (keyof TestTenant['people'])[])
    tok[k] = await loginAs(app, t.people[k].email);
  tok.betaHr = await loginAs(app, beta.people.hr.email);
  tok.betaOwner = await loginAs(app, beta.people.owner.email);
  tok.betaEmployee = await loginAs(app, beta.people.employee.email);
});
afterAll(stopTestApp);

describe('web session', () => {
  it('web clients get the refresh token only as an HttpOnly cookie', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Client-Type', 'web')
      .send({ email: t.people.hr.email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.refreshToken).toBeUndefined();
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('refresh_token='),
    )!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);

    // the cookie alone restores a session
    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .set('X-Client-Type', 'web')
      .set('Cookie', cookie.split(';')[0]!)
      .send({});
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.accessToken).toEqual(expect.any(String));
  });

  it('memberships carry the permission list the UI uses for navigation (cosmetic only)', async () => {
    const hr = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: t.people.hr.email, password: PASSWORD });
    const hrPerms: string[] = hr.body.data.memberships[0].permissions;
    expect(hrPerms).toContain('attendance:read:all');
    expect(hrPerms).not.toContain('tenant:update'); // company settings are owner-only
    expect([...hrPerms].sort()).toEqual(hrPerms);
    const owner = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: t.people.owner.email, password: PASSWORD });
    expect(owner.body.data.memberships[0].permissions).toContain('tenant:update');

    const emp = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: t.people.employee.email, password: PASSWORD });
    const empPerms: string[] = emp.body.data.memberships[0].permissions;
    expect(empPerms).not.toContain('attendance:read:all');
    expect(empPerms).not.toContain('tenant:update');
    expect(empPerms).not.toContain('employee:read:all');

    const mgr = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: t.people.manager.email, password: PASSWORD });
    const mgrPerms: string[] = mgr.body.data.memberships[0].permissions;
    expect(mgrPerms).toContain('attendance:read:team');
    expect(mgrPerms).not.toContain('attendance:read:all');
  });

  it('hiding a menu item is not security: the server rejects the call regardless', async () => {
    expect((await get('employee', '/reports/dashboard')).status).toBe(403);
    expect(
      (await get('employee', '/reports/attendance/summary?from=2026-03-02&to=2026-03-02')).status,
    ).toBe(403);
    expect((await patch('employee', '/tenants/current', { name: 'Hacked' })).status).toBe(403);
    expect((await patch('manager', '/tenants/current', { name: 'Hacked' })).status).toBe(403);
  });
});

describe('company settings', () => {
  it('the owner can update the new attendance policy fields', async () => {
    const res = await patch('owner', '/tenants/current', {
      settings: {
        attendance: { allowGpsExceptions: false, maxOpenSessionHours: 12, maxAccuracyMeters: 80 },
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.settings.attendance).toMatchObject({
      allowGpsExceptions: false,
      maxOpenSessionHours: 12,
      maxAccuracyMeters: 80,
    });
    const again = await get('owner', '/tenants/current');
    expect(again.body.data.settings.attendance.allowGpsExceptions).toBe(false);
  });

  it('rejects out-of-range and unknown settings (strict body)', async () => {
    const bad = [
      { settings: { attendance: { maxOpenSessionHours: 2 } } },
      { settings: { attendance: { maxOpenSessionHours: 30 } } },
      { settings: { attendance: { isSuperAdmin: true } } },
      { status: 'ACTIVE' },
    ];
    for (const b of bad) expect((await patch('owner', '/tenants/current', b)).status).toBe(422);
    expect(
      (
        await patch('hr', '/tenants/current', {
          settings: { attendance: { maxOpenSessionHours: 12 } },
        })
      ).status,
    ).toBe(403);
  });

  it("changing one company's settings never touches another's", async () => {
    const other = await get('betaOwner', '/tenants/current');
    expect(other.body.data.settings?.attendance?.allowGpsExceptions).not.toBe(false);
    expect(other.body.data.name).not.toBe('Hacked');
  });
});

describe('approval lists include the employee reference', () => {
  it('shows name and code for reviewers, scoped to the reviewer’s company', async () => {
    clock.set(ist(MON, '09:00'));
    await post('employee', '/attendance/check-in', {
      idempotencyKey: newKey('ci'),
      location: inside(),
    });
    clock.set(ist('2026-03-04', '10:00'));
    const c = await post('employee', '/attendance/corrections', {
      workDate: MON,
      checkOut: ist(MON, '18:00').toISOString(),
      reason: 'Forgot to check out',
    });
    expect(c.status).toBe(201);

    const list = await get('hr', '/attendance/corrections?status=PENDING');
    expect(list.status).toBe(200);
    const row = list.body.data.find((r: { id: string }) => r.id === c.body.data.id);
    expect(row.employee).toEqual({
      id: String(t.people.employee.employeeId),
      employeeCode: expect.any(String),
      firstName: expect.any(String),
      lastName: expect.any(String),
    });

    // another company's HR sees none of it
    const foreign = await get('betaHr', '/attendance/corrections?status=PENDING');
    expect(foreign.body.data.find((r: { id: string }) => r.id === c.body.data.id)).toBeUndefined();
    // and cannot decide it either
    expect((await post('betaHr', `/attendance/corrections/${c.body.data.id}/approve`)).status).toBe(
      404,
    );
  });

  it('a plain employee only ever sees their own requests, never a colleague’s', async () => {
    const mine = await get('employee', '/attendance/corrections');
    expect(mine.status).toBe(200);
    for (const r of mine.body.data) expect(r.employeeId).toBe(String(t.people.employee.employeeId));
    const colleague = await get('employee2', '/attendance/corrections');
    expect(colleague.body.data).toHaveLength(0);
    const foreign = await get('betaEmployee', '/attendance/corrections');
    expect(foreign.body.data).toHaveLength(0);
  });
});
