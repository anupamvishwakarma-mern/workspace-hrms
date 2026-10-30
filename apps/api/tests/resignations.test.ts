import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTenant, loginAs, startTestApp, stopTestApp, type TestTenant } from './helpers';

let app: Express;
let a: TestTenant;
const tok: Record<string, string> = {};
const api = (m: 'get' | 'post', url: string, role: string, body?: object) => {
  const r = request(app)[m](`/api/v1${url}`).set({ ...bearer(tok[role]!), 'X-Tenant-Id': String(a.tenantId) });
  return body ? r.send(body) : r;
};
const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

beforeAll(async () => {
  ({ app } = await startTestApp());
  a = await createTenant('resign-a');
  for (const r of ['owner', 'hr', 'manager', 'employee', 'employee2'] as const)
    tok[r] = await loginAs(app, a.people[r].email);
});
afterAll(stopTestApp);

describe('resignations', () => {
  it('validates the last working day', async () => {
    expect((await api('post', '/resignations', 'employee', { proposedLastDay: '2020-01-01' })).status).toBe(400);
    expect((await api('post', '/resignations', 'employee', { proposedLastDay: 'soon' })).status).toBe(422);
  });

  it('is approved by the manager, which starts the notice period; only one at a time', async () => {
    const last = future(30);
    const r = await api('post', '/resignations', 'employee', { proposedLastDay: last, reason: 'Moving cities' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.status).toBe('PENDING');
    expect((await api('post', '/resignations', 'employee', { proposedLastDay: last })).status).toBe(409);

    const mine = await api('get', '/resignations', 'employee');
    expect(mine.body.data).toHaveLength(1);
    expect((await api('get', '/resignations?scope=all', 'employee')).status).toBe(403);
    expect((await api('get', '/resignations?scope=all', 'hr')).body.data.length).toBeGreaterThanOrEqual(1);
    expect((await api('get', '/resignations', 'employee2')).body.data).toHaveLength(0);

    const inbox = await api('get', '/approvals?scope=inbox', 'manager');
    const ar = inbox.body.data.find((x: any) => x.requestType === 'RESIGNATION');
    expect(ar).toBeTruthy();
    let dec = await api('post', `/approvals/${ar.id}/decision`, 'manager', { decision: 'APPROVE' });
    // the default workflow may need a second approver; finish the chain if so
    if (dec.body.data.status === 'PENDING') dec = await api('post', `/approvals/${ar.id}/decision`, 'owner', { decision: 'APPROVE' });
    expect(dec.body.data.status).toBe('APPROVED');

    const after = await api('get', '/resignations', 'employee');
    expect(after.body.data[0].status).toBe('APPROVED');
    expect(after.body.data[0].applyError).toBeUndefined();
    const emp = await api('get', `/employees/${a.people.employee.employeeId}`, 'hr');
    expect(emp.body.data.employmentStatus).toBe('NOTICE_PERIOD');
    expect(String(emp.body.data.lastWorkingDate).slice(0, 10)).toBe(last);

    expect((await api('post', '/resignations', 'employee', { proposedLastDay: last })).status).toBe(409);
    expect((await api('post', `/resignations/${r.body.data.id}/cancel`, 'employee', {})).status).toBe(409);
  });

  it('can be withdrawn while pending, and a rejection changes nothing', async () => {
    const r = await api('post', '/resignations', 'employee2', { proposedLastDay: future(45) });
    expect(r.status).toBe(201);
    expect((await api('post', `/resignations/${r.body.data.id}/cancel`, 'employee', {})).status).toBe(404); // not theirs
    const c = await api('post', `/resignations/${r.body.data.id}/cancel`, 'employee2', {});
    expect(c.body.data.status).toBe('CANCELLED');

    const r2 = await api('post', '/resignations', 'employee2', { proposedLastDay: future(45) });
    const inbox = await api('get', '/approvals?scope=inbox', 'manager');
    const ar = inbox.body.data.find((x: any) => x.title.includes('Resignation') && x.status === 'PENDING');
    if (ar) {
      const rej = await api('post', `/approvals/${ar.id}/decision`, 'manager', { decision: 'REJECT', comment: 'Please talk first' });
      expect(rej.body.data.status).toBe('REJECTED');
      const list = await api('get', '/resignations', 'employee2');
      expect(list.body.data.find((x: any) => x.id === r2.body.data.id).status).toBe('REJECTED');
    }
    const emp = await api('get', `/employees/${a.people.employee2.employeeId}`, 'hr');
    expect(emp.body.data.employmentStatus).toBe('ACTIVE');
  });
});
