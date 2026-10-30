import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
let off: TestTenant;
let on: TestTenant;
const tok: Record<string, string> = {};
const call = (m: 'get' | 'post' | 'patch', who: string, path: string, body?: object) => {
  const r = request(app)[m](`/api/v1${path}`).set(bearer(tok[who]!));
  return body ? r.send(body) : r;
};

async function prepare(t: TestTenant, prefix: string) {
  await setupSchedule(t);
  for (const k of ['owner', 'hr', 'payroll', 'employee'] as const)
    tok[`${prefix}.${k}`] = await loginAs(app, t.people[k].email);
  const st = await call('post', `${prefix}.hr`, '/payroll/structures', {
    employeeId: String(t.people.employee.employeeId),
    effectiveFrom: '2026-03-01',
    components: [{ code: 'BASIC', name: 'Basic', kind: 'EARNING', calc: 'FIXED', amount: 20000 }],
  });
  expect(st.status).toBe(201);
  const run = await call('post', `${prefix}.hr`, '/payroll/runs', { month: '2026-03' });
  expect(run.status).toBe(201);
  return String(run.body.data.id);
}

beforeAll(async () => {
  ({ app } = await startTestApp({}, { clock: new FakeClock(ist('2026-04-05', '12:00')) }));
  off = await createTenant('mc-off');
  on = await createTenant('mc-on');
});
afterAll(stopTestApp);

describe('maker-checker publishing', () => {
  it('is off by default: the person who generated a run can publish it', async () => {
    const id = await prepare(off, 'off');
    expect((await call('post', 'off.hr', `/payroll/runs/${id}/publish`)).status).toBe(200);
  });

  it('when required, the generator cannot publish but another publisher can', async () => {
    const id = await prepare(on, 'on');
    const set = await call('patch', 'on.owner', '/tenants/current', {
      settings: { payroll: { requireSeparatePublisher: true } },
    });
    expect(set.status).toBe(200);
    const mine = await call('post', 'on.hr', `/payroll/runs/${id}/publish`);
    expect(mine.status).toBe(403);
    expect(mine.body.error.code).toBe('SEPARATE_PUBLISHER_REQUIRED');
    expect((await call('get', 'on.hr', `/payroll/runs/${id}`)).body.data.status).toBe('DRAFT');
    expect((await call('post', 'on.employee', `/payroll/runs/${id}/publish`)).status).toBe(403);
    expect((await call('post', 'on.payroll', `/payroll/runs/${id}/publish`)).status).toBe(200);
  });

  it('only the owner can change the setting', async () => {
    const r = await call('patch', 'on.hr', '/tenants/current', {
      settings: { payroll: { requireSeparatePublisher: false } },
    });
    expect(r.status).toBe(403);
  });
});
