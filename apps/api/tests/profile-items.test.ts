import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkItem } from '../src/modules/employees/profile.routes';
import { bearer, createTenant, loginAs, startTestApp, stopTestApp, type TestTenant } from './helpers';

let app: Express;
let t: TestTenant;
let other: TestTenant;
const tok: Record<string, string> = {};
const call = (m: 'get' | 'post' | 'patch' | 'delete', who: string, path: string, body?: object) => {
  const r = request(app)[m](`/api/v1${path}`).set(bearer(tok[who]!));
  return body ? r.send(body) : r;
};
const emp = () => String(t.people.employee.employeeId);
const hrOwn = () => String(t.people.hr.employeeId);

beforeAll(async () => {
  ({ app } = await startTestApp());
  t = await createTenant('profile');
  other = await createTenant('profile-other');
  for (const k of ['owner', 'hr', 'manager', 'employee', 'employee2'] as const) tok[k] = await loginAs(app, t.people[k].email);
  tok.otherHr = await loginAs(app, other.people.hr.email);
});
afterAll(stopTestApp);

describe('checkItem', () => {
  it('applies per-kind rules', () => {
    expect(checkItem({ kind: 'QUALIFICATION', title: 'BSc' })).toMatch(/institution/);
    expect(checkItem({ kind: 'EXPERIENCE', title: 'Dev', organization: 'X' })).toMatch(/start date/);
    expect(checkItem({ kind: 'EXPERIENCE', title: 'Dev', organization: 'X', fromDate: '2020-02-01', toDate: '2020-01-01' })).toMatch(/before/);
    expect(checkItem({ kind: 'SKILL', title: 'SQL', level: 'EXPERT' })).toBeUndefined();
    expect(checkItem({ kind: 'QUALIFICATION', title: 'BSc', organization: 'U', level: 'EXPERT' })).toMatch(/level/);
    expect(checkItem({ kind: 'SKILL', title: 'SQL', fromDate: '2020-01-01' })).toMatch(/no dates/);
  });
});

describe('profile items', () => {
  let selfItem = '';
  let hrItem = '';

  it('HR adds verified entries; validation is enforced', async () => {
    const r = await call('post', 'hr', `/employees/${emp()}/profile-items`, { kind: 'QUALIFICATION', title: 'BSc Physics', organization: 'State University', fromDate: '2012-07-01', toDate: '2015-05-30' });
    expect(r.status).toBe(201);
    expect(r.body.data.verified).toBe(true);
    hrItem = r.body.data.id;
    expect((await call('post', 'hr', `/employees/${emp()}/profile-items`, { kind: 'EXPERIENCE', title: 'Dev' })).status).toBe(422);
    expect((await call('post', 'hr', `/employees/${emp()}/profile-items`, { kind: 'SKILL', title: 'SQL', level: 'ULTRA' })).status).toBe(422);
  });

  it('employees add their own, unverified, and cannot touch anyone else\'s', async () => {
    const r = await call('post', 'employee', `/employees/${emp()}/profile-items`, { kind: 'SKILL', title: 'Excel', level: 'ADVANCED' });
    expect(r.status).toBe(201);
    expect(r.body.data.verified).toBe(false);
    selfItem = r.body.data.id;
    expect((await call('post', 'employee2', `/employees/${emp()}/profile-items`, { kind: 'SKILL', title: 'X' })).status).toBe(404);
    expect((await call('get', 'employee2', `/employees/${emp()}/profile-items`)).status).toBe(404);
    expect((await call('get', 'manager', `/employees/${emp()}/profile-items`)).status).toBe(404);
    expect((await call('get', 'otherHr', `/employees/${emp()}/profile-items`)).status).toBe(404);
    expect((await call('patch', 'employee', `/employees/${emp()}/profile-items/${hrItem}`, { title: 'Changed' })).status).toBe(200);
  });

  it('an employee edit clears verification; only HR verifies, never their own record', async () => {
    const d = (await call('get', 'hr', `/employees/${emp()}/profile-items`)).body.data;
    expect(d).toHaveLength(2);
    expect(d.find((x: { id: string }) => x.id === hrItem).verified).toBe(false);
    expect((await call('patch', 'employee', `/employees/${emp()}/profile-items/${selfItem}`, { verified: true })).status).toBe(403);
    const v = await call('patch', 'hr', `/employees/${emp()}/profile-items/${selfItem}`, { verified: true });
    expect(v.body.data.verified).toBe(true);
    // HR editing someone else's entry keeps it verified.
    const e = await call('patch', 'hr', `/employees/${emp()}/profile-items/${selfItem}`, { notes: 'Seen certificate' });
    expect(e.body.data.verified).toBe(true);
    // HR cannot verify entries on their own record.
    const own = await call('post', 'hr', `/employees/${hrOwn()}/profile-items`, { kind: 'SKILL', title: 'Leadership' });
    expect(own.body.data.verified).toBe(false);
    expect((await call('patch', 'hr', `/employees/${hrOwn()}/profile-items/${own.body.data.id}`, { verified: true })).status).toBe(403);
  });

  it('can be filtered, cleared field by field, and deleted', async () => {
    expect((await call('get', 'hr', `/employees/${emp()}/profile-items?kind=SKILL`)).body.data).toHaveLength(1);
    const c = await call('patch', 'hr', `/employees/${emp()}/profile-items/${hrItem}`, { toDate: null });
    expect(c.body.data.toDate).toBeUndefined();
    expect((await call('patch', 'hr', `/employees/${emp()}/profile-items/${hrItem}`, { fromDate: '2016-01-01', toDate: '2015-01-01' })).status).toBe(422);
    expect((await call('delete', 'employee', `/employees/${emp()}/profile-items/${selfItem}`)).status).toBe(200);
    expect((await call('delete', 'employee', `/employees/${emp()}/profile-items/${selfItem}`)).status).toBe(404);
  });
});
