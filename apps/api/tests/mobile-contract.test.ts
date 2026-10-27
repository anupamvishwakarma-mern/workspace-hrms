/**
 * Contract test: the REAL mobile ApiClient and response schemas talk to the REAL API over HTTP.
 * Catches drift between apps/mobile and apps/api (shapes, status codes, token rotation).
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiClient, type SessionStorage } from '../../mobile/src/lib/api';
import { ApiError, isGeoFailure } from '../../mobile/src/lib/errors';
import {
  correctionRecord,
  dayRecord,
  exceptionRecord,
  meData,
  pageMeta,
  punchPending,
  punchRecorded,
  todayData,
} from '../../mobile/src/lib/schemas';
import { AttendanceEvent } from '../src/database/models/attendanceEvent.model';
import {
  FakeClock,
  PASSWORD,
  createTenant,
  inside,
  ist,
  newKey,
  outside,
  setupSchedule,
  startTestApp,
  stopTestApp,
  type TestTenant,
} from './helpers';

const MON = '2026-03-02';
let server: Server;
let base: string;
let t: TestTenant;
let clock: FakeClock;
let stored: string | null = null;
let authedCalls = 0;
let sabotageNextAuth = false;

const storage: SessionStorage = {
  getRefreshToken: async () => stored,
  setRefreshToken: async (v) => void (stored = v),
  clear: async () => void (stored = null),
};
// Wraps fetch so one authenticated request can be sent with a bad token (simulating an expired access token).
const fetchImpl = ((url: string, init: RequestInit = {}) => {
  const headers = { ...(init.headers as Record<string, string>) };
  if (headers.Authorization) {
    authedCalls++;
    if (sabotageNextAuth) {
      sabotageNextAuth = false;
      headers.Authorization = 'Bearer not-a-valid-token';
    }
  }
  return fetch(url, { ...init, headers });
}) as typeof fetch;

const newClient = () => new ApiClient({ baseUrl: base, storage, fetchImpl });
const punchResponse = z.union([punchPending, punchRecorded]);

beforeAll(async () => {
  clock = new FakeClock(ist(MON, '08:50'));
  const { app } = await startTestApp({}, { clock });
  t = await createTenant('mobilecontract');
  await setupSchedule(t);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await stopTestApp();
});

describe('mobile client <-> API contract', () => {
  let client: ApiClient;

  it('logs in, parses memberships, and /auth/me matches the schema', async () => {
    client = newClient();
    const login = await client.login(t.people.employee.email, PASSWORD, 'contract-test');
    expect(login.memberships[0]!.employeeId).toBe(String(t.people.employee.employeeId));
    client.setTenant(login.memberships[0]!.tenantId);
    const me = await client.call({ path: '/auth/me', schema: meData, tenant: false });
    expect(me.data.memberships).toHaveLength(1);
    expect(stored).toBeTruthy();
  });

  it('today parses and reports the company timezone', async () => {
    const today = await client.call({ path: '/attendance/me/today', schema: todayData });
    expect(today.data.state).toBe('OFF');
    expect(today.data.timezone).toBe('Asia/Kolkata');
    expect(today.data.allowedActions.filter((a) => a.enabled).map((a) => a.eventType)).toEqual([
      'CHECK_IN',
    ]);
  });

  it('a punch outside the fence surfaces geofence details; with a reason it becomes a pending exception (202)', async () => {
    clock.set(ist(MON, '09:05'));
    const body = {
      idempotencyKey: newKey('mob'),
      location: outside(),
      clientTimestamp: new Date().toISOString(),
    };
    const err = (await client
      .call({ method: 'POST', path: '/attendance/check-in', body, schema: punchResponse })
      .catch((e) => e)) as ApiError;
    expect(isGeoFailure(err)).toBe(true);
    expect(err.details).toMatchObject({ exceptionAllowed: true });
    const res = await client.call({
      method: 'POST',
      path: '/attendance/check-in',
      body: { ...body, idempotencyKey: newKey('mob'), exceptionReason: 'Client site visit today' },
      schema: punchResponse,
    });
    expect(res.status).toBe(202);
    expect('status' in res.data && res.data.status).toBe('PENDING_REVIEW');
    expect(await AttendanceEvent.countDocuments({ employeeId: t.people.employee.employeeId })).toBe(
      0,
    );
    const list = await client.call({
      path: '/attendance/me/exceptions',
      schema: z.array(exceptionRecord),
    });
    expect(list.data[0]).toMatchObject({ eventType: 'CHECK_IN', status: 'PENDING' });
  });

  it('an inside punch is recorded (201); retrying with the same key returns the original (200); stale access token is refreshed transparently', async () => {
    const key = newKey('mob');
    const body = { idempotencyKey: key, location: inside(), deviceId: 'device-abc' };
    sabotageNextAuth = true;
    const before = authedCalls;
    const first = await client.call({
      method: 'POST',
      path: '/attendance/check-in',
      body,
      schema: punchResponse,
    });
    expect(authedCalls - before).toBe(2); // 401 -> refresh -> retry
    expect(first.status).toBe(201);
    const again = await client.call({
      method: 'POST',
      path: '/attendance/check-in',
      body,
      schema: punchResponse,
    });
    expect(again.status).toBe(200);
    expect('event' in again.data && again.data.event.id).toBe(
      'event' in first.data && first.data.event.id,
    );
    expect(await AttendanceEvent.countDocuments({ employeeId: t.people.employee.employeeId })).toBe(
      1,
    );
  });

  it('refresh-token rotation works across a "restart" (new client, same stored token) and the old token is dead', async () => {
    const oldToken = stored!;
    const restarted = newClient();
    restarted.setTenant(String(t.tenantId));
    expect(await restarted.restore()).toBe(true);
    expect(stored).not.toBe(oldToken);
    const today = await restarted.call({ path: '/attendance/me/today', schema: todayData });
    expect(today.data.state).toBe('WORKING');
    // replaying the rotated-out token must be rejected, and the client treats that as a dead session
    stored = oldToken;
    const stale = newClient();
    await expect(stale.restore()).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(stored).toBeNull();
  });

  it('history, corrections (create + own list) and pagination meta match the schemas', async () => {
    stored = null;
    const c = newClient();
    await c.login(t.people.employee.email, PASSWORD);
    c.setTenant(String(t.tenantId));
    clock.set(ist(MON, '19:00'));
    const hist = await c.call({
      path: '/attendance/me/history',
      query: { page: 1, limit: 20 },
      schema: z.array(dayRecord),
    });
    pageMeta.parse(hist.meta);
    expect(hist.data[0]!.workDate).toBe(MON);
    const created = await c.call({
      method: 'POST',
      path: '/attendance/corrections',
      body: {
        workDate: MON,
        checkOut: ist(MON, '18:00').toISOString(),
        reason: 'Forgot to check out',
      },
      schema: correctionRecord,
    });
    expect(created.status).toBe(201);
    const mine = await c.call({
      path: '/attendance/corrections',
      query: { employeeId: String(t.people.employee.employeeId), limit: 50 },
      schema: z.array(correctionRecord),
    });
    expect(mine.data.map((x) => x.id)).toContain(created.data.id);
  });

  it('an HR user listing corrections is filtered to their own by the app (employeeId), not everyone', async () => {
    stored = null;
    const hr = newClient();
    const l = await hr.login(t.people.hr.email, PASSWORD);
    hr.setTenant(l.memberships[0]!.tenantId);
    const mine = await hr.call({
      path: '/attendance/corrections',
      query: { employeeId: String(t.people.hr.employeeId) },
      schema: z.array(correctionRecord),
    });
    expect(mine.data).toHaveLength(0);
  });

  it('a user cannot select a company they do not belong to', async () => {
    const other = await createTenant('mobileother');
    const c = newClient();
    stored = null;
    await c.login(t.people.employee.email, PASSWORD);
    c.setTenant(String(other.tenantId));
    const err = (await c
      .call({ path: '/attendance/me/today', schema: todayData })
      .catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect([403, 404]).toContain(err.status);
  });
});
