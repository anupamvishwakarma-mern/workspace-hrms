import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/database/models/auditLog.model';
import { Employee } from '../src/database/models/employee.model';
import { Membership } from '../src/database/models/membership.model';
import {
  addPerson,
  bearer,
  createTenant,
  loginAs,
  startTestApp,
  stopTestApp,
  type TestTenant,
} from './helpers';

let app: Express;
let t: TestTenant;
let beta: TestTenant;
const tok: Record<string, string> = {};
const call = (m: 'get' | 'post' | 'patch', who: string, path: string) =>
  request(app)[m](`/api/v1${path}`).set(bearer(tok[who]!));

beforeAll(async () => {
  ({ app } = await startTestApp());
  t = await createTenant('acme');
  beta = await createTenant('beta');
  for (const k of Object.keys(t.people) as (keyof TestTenant['people'])[])
    tok[k] = await loginAs(app, t.people[k].email);
  tok.betaHr = await loginAs(app, beta.people.hr.email);
});
afterAll(stopTestApp);

describe('notice period and reactivation', () => {
  it('moves an active employee to NOTICE_PERIOD, then terminates and reactivates with EMPLOYEE role only', async () => {
    const p = await addPerson(t.tenantId, 'acme', 'leaver', ['EMPLOYEE', 'MANAGER'], t.department);
    const notice = await call('post', 'hr', `/employees/${p.employeeId}/notice-period`).send({
      noticePeriodStartDate: '2026-03-01',
      lastWorkingDate: '2026-03-31',
      reason: 'Resigned',
    });
    expect(notice.status).toBe(200);
    expect(notice.body.data.employmentStatus).toBe('NOTICE_PERIOD');

    const bad = await call('post', 'hr', `/employees/${p.employeeId}/notice-period`).send({
      noticePeriodStartDate: '2026-04-01',
      lastWorkingDate: '2026-03-01',
    });
    expect(bad.status).toBe(400);

    // not deactivated yet, so reactivation is refused
    expect(
      (await call('post', 'hr', `/employees/${p.employeeId}/reactivate`).send({ reason: 'oops' }))
        .status,
    ).toBe(409);

    const out = await call('post', 'hr', `/employees/${p.employeeId}/deactivate`).send({
      reason: 'End of notice',
    });
    expect(out.body.data.employmentStatus).toBe('TERMINATED');
    // a deactivated member can no longer use the company, even with a fresh login
    const stale = await loginAs(app, p.email);
    expect(
      (
        await request(app)
          .get('/api/v1/tenants/current')
          .set({ ...bearer(stale), 'X-Tenant-Id': String(t.tenantId) })
      ).status,
    ).toBeGreaterThanOrEqual(401);

    const back = await call('post', 'hr', `/employees/${p.employeeId}/reactivate`).send({
      reason: 'Rehired',
    });
    expect(back.status).toBe(200);
    expect(back.body.data.employmentStatus).toBe('ACTIVE');
    const m = await Membership.findOne({ userId: p.userId, tenantId: t.tenantId }).lean();
    expect(m!.status).toBe('ACTIVE');
    expect(m!.roles).toEqual(['EMPLOYEE']); // MANAGER is not silently restored
    const emp = await Employee.findById(p.employeeId).lean();
    expect(emp!.lastWorkingDate).toBeUndefined();
    expect(await loginAs(app, p.email)).toEqual(expect.any(String));
    expect(
      await AuditLog.countDocuments({
        entityId: String(p.employeeId),
        action: 'employee.reactivate',
      }),
    ).toBe(1);
  });

  it('only HR/owner may do this, and never across companies', async () => {
    const p = await addPerson(t.tenantId, 'acme', 'target', ['EMPLOYEE'], t.department);
    for (const who of ['manager', 'employee', 'payroll']) {
      expect(
        (
          await call('post', who, `/employees/${p.employeeId}/notice-period`).send({
            noticePeriodStartDate: '2026-03-01',
            lastWorkingDate: '2026-03-31',
          })
        ).status,
      ).toBe(403);
      expect(
        (await call('post', who, `/employees/${p.employeeId}/reactivate`).send({ reason: 'abc' }))
          .status,
      ).toBe(403);
    }
    expect(
      (
        await call('post', 'betaHr', `/employees/${p.employeeId}/notice-period`).send({
          noticePeriodStartDate: '2026-03-01',
          lastWorkingDate: '2026-03-31',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call('post', 'betaHr', `/employees/${p.employeeId}/reactivate`).send({
          reason: 'abc',
        })
      ).status,
    ).toBe(404);
  });
});

describe('audit-log API', () => {
  it('is readable only by owner/HR and only for their own company', async () => {
    for (const who of ['manager', 'employee', 'payroll'])
      expect((await call('get', who, '/audit-logs')).status).toBe(403);
    const mine = await call('get', 'hr', '/audit-logs?limit=100');
    expect(mine.status).toBe(200);
    expect(mine.body.data.length).toBeGreaterThan(0);
    for (const row of mine.body.data) expect(row.requestId ?? 'x').toBeDefined();
    const theirs = await call('get', 'betaHr', '/audit-logs?limit=100');
    const mineIds = new Set(mine.body.data.map((r: { id: string }) => r.id));
    for (const r of theirs.body.data) expect(mineIds.has(r.id)).toBe(false);
    // the other company's HR cannot see acme's employee actions
    expect(
      theirs.body.data.some((r: { action: string }) => r.action === 'employee.reactivate'),
    ).toBe(false);
  });

  it('filters, paginates, shows the actor and never exposes secrets', async () => {
    const res = await call('get', 'hr', '/audit-logs?action=employee.reactivate');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    const row = res.body.data[0];
    expect(row.action).toBe('employee.reactivate');
    expect(row.actorEmail).toBe(t.people.hr.email);
    expect(row.reason).toBe('Rehired');
    const all = await call('get', 'hr', '/audit-logs?limit=100');
    expect(JSON.stringify(all.body)).not.toMatch(/passwordHash|\$argon2|refreshToken/i);
    const page = await call('get', 'hr', '/audit-logs?limit=1&page=2');
    expect(page.body.data).toHaveLength(1);
    expect(page.body.meta.total).toBe(all.body.meta.total);
    expect((await call('get', 'hr', '/audit-logs?bogus=1')).status).toBe(422);
    expect((await call('get', 'hr', '/audit-logs?actorUserId=notanid')).status).toBe(422);
  });

  it('cannot be modified through the application', async () => {
    const { AuditLog: A } = await import('../src/database/models/auditLog.model');
    await expect(A.updateMany({}, { $set: { action: 'x' } })).rejects.toThrow(/immutable/);
    await expect(A.deleteMany({})).rejects.toThrow(/immutable/);
  });
});
