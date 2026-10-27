import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/database/models/auditLog.model';
import { Department } from '../src/database/models/department.model';
import { Employee } from '../src/database/models/employee.model';
import { Membership } from '../src/database/models/membership.model';
import { Tenant } from '../src/database/models/tenant.model';
import { User } from '../src/database/models/user.model';
import {
  PASSWORD,
  addPerson,
  bearer,
  createTenant,
  latestEmailToken,
  loginAs,
  startTestApp,
  stopTestApp,
  testPasswordHash,
  type TestTenant,
} from './helpers';

let app: Express;
let a: TestTenant;
let b: TestTenant;
let tokA: string; // owner of A
let tokAHr: string;
let tokB: string; // owner of B
let superAdmin: string;
const auth = (t: string, tenant?: TestTenant) => ({
  ...bearer(t),
  ...(tenant ? { 'X-Tenant-Id': String(tenant.tenantId) } : {}),
});

beforeAll(async () => {
  ({ app } = await startTestApp());
  a = await createTenant('alpha');
  b = await createTenant('bravo');
  tokA = await loginAs(app, a.people.owner.email);
  tokAHr = await loginAs(app, a.people.hr.email);
  tokB = await loginAs(app, b.people.owner.email);
  await User.create({
    email: 'root@platform.test',
    passwordHash: await testPasswordHash(),
    status: 'ACTIVE',
    isPlatformAdmin: true,
  });
  superAdmin = await loginAs(app, 'root@platform.test');
});
afterAll(stopTestApp);

describe('cross-tenant reads are denied', () => {
  it("tenant A cannot read tenant B's employee by id (404)", async () => {
    const res = await request(app)
      .get(`/api/v1/employees/${b.people.employee.employeeId}`)
      .set(auth(tokA));
    expect(res.status).toBe(404);
  });
  it("list never includes the other tenant's people, even with filters pointing at them", async () => {
    const res = await request(app)
      .get(`/api/v1/employees?limit=100&departmentId=${b.department}`)
      .set(auth(tokA));
    expect(res.body.meta.total).toBe(0);
    const all = await request(app).get('/api/v1/employees?limit=100').set(auth(tokA));
    expect(all.body.data.every((e: { employeeCode: string }) => !!e.employeeCode)).toBe(true);
    const ids = new Set(all.body.data.map((e: { id: string }) => e.id));
    expect(ids.has(String(b.people.employee.employeeId))).toBe(false);
  });
  it("tenant A's departments are separate from B's", async () => {
    const res = await request(app).get('/api/v1/departments').set(auth(tokA));
    expect(res.body.data.map((d: { id: string }) => d.id)).not.toContain(String(b.department));
  });
  it('current tenant always reflects the caller, not a client-supplied id', async () => {
    const res = await request(app).get('/api/v1/tenants/current').set(auth(tokA));
    expect(res.body.data.slug).toBe('alpha');
  });
});

describe('X-Tenant-Id is a selector, never authorization', () => {
  it('is rejected when the caller is not a member of that tenant', async () => {
    const res = await request(app).get('/api/v1/employees').set(auth(tokA, b));
    expect(res.status).toBe(403);
    const patch = await request(app)
      .patch('/api/v1/tenants/current')
      .set(auth(tokA, b))
      .send({ name: 'Hijacked' });
    expect(patch.status).toBe(403);
    expect((await Tenant.findById(b.tenantId))!.name).toBe('Company bravo');
  });
  it('lets a multi-company user pick among their own companies only', async () => {
    const guest = await addPerson(b.tenantId, 'bravo', 'guest', ['EMPLOYEE'], b.department);
    // Same login also belongs to tenant A as an employee.
    const empA = await Employee.create({
      tenantId: a.tenantId,
      userId: guest.userId,
      employeeCode: 'GUEST',
      firstName: 'g',
      lastName: 'g',
      workEmail: 'guest-a@alpha.test',
      employmentStatus: 'ACTIVE',
    });
    await Membership.create({
      tenantId: a.tenantId,
      userId: guest.userId,
      roles: ['EMPLOYEE'],
      employeeId: empA._id,
    });
    const t = await loginAs(app, guest.email);
    expect((await request(app).get('/api/v1/employees').set(bearer(t))).status).toBe(400); // must choose
    const inA = await request(app).get('/api/v1/employees').set(auth(t, a));
    const inB = await request(app).get('/api/v1/employees').set(auth(t, b));
    expect(inA.body.data[0].employeeCode).toBe('GUEST');
    expect(inB.body.data[0].employeeCode).toBe('GUEST');
    expect(inA.body.data[0].id).not.toBe(inB.body.data[0].id);
    // Roles do not leak across companies: employee in both, so creating in A is still forbidden.
    expect(
      (
        await request(app)
          .post('/api/v1/employees')
          .set(auth(t, a))
          .send({ firstName: 'x', lastName: 'y', workEmail: 'x@y.test' })
      ).status,
    ).toBe(403);
  });
});

describe('cross-tenant writes are denied', () => {
  it('update', async () => {
    const res = await request(app)
      .patch(`/api/v1/employees/${b.people.employee.employeeId}`)
      .set(auth(tokA))
      .send({ designation: 'Pwned' });
    expect(res.status).toBe(404);
    expect((await Employee.findById(b.people.employee.employeeId))!.designation).toBeUndefined();
  });
  it('invite', async () => {
    expect(
      (
        await request(app)
          .post(`/api/v1/employees/${b.people.employee.employeeId}/invite`)
          .set(auth(tokA))
          .send({})
      ).status,
    ).toBe(404);
  });
  it('deactivate', async () => {
    const res = await request(app)
      .post(`/api/v1/employees/${b.people.employee.employeeId}/deactivate`)
      .set(auth(tokA))
      .send({ reason: 'attack attempt' });
    expect(res.status).toBe(404);
    expect((await Membership.findOne({ userId: b.people.employee.userId }))!.status).toBe('ACTIVE');
  });
  it('role changes', async () => {
    expect(
      (
        await request(app)
          .patch(`/api/v1/employees/${b.people.employee.employeeId}/roles`)
          .set(auth(tokA))
          .send({ roles: ['COMPANY_OWNER'] })
      ).status,
    ).toBe(404);
  });
  it('department edits', async () => {
    expect(
      (
        await request(app)
          .patch(`/api/v1/departments/${b.department}`)
          .set(auth(tokA))
          .send({ name: 'Hacked' })
      ).status,
    ).toBe(404);
    expect((await Department.findById(b.department))!.name).toBe('Engineering');
  });
});

describe('cross-tenant references are rejected', () => {
  it("cannot place an employee in another tenant's department or under another tenant's manager", async () => {
    const dept = await request(app)
      .post('/api/v1/employees')
      .set(auth(tokA))
      .send({
        firstName: 'a',
        lastName: 'b',
        workEmail: 'x1@alpha.test',
        departmentId: String(b.department),
      });
    expect(dept.status).toBe(400);
    const mgr = await request(app)
      .post('/api/v1/employees')
      .set(auth(tokA))
      .send({
        firstName: 'a',
        lastName: 'b',
        workEmail: 'x2@alpha.test',
        managerId: String(b.people.manager.employeeId),
      });
    expect(mgr.status).toBe(400);
    const patch = await request(app)
      .patch(`/api/v1/employees/${a.people.employee.employeeId}`)
      .set(auth(tokA))
      .send({ managerId: String(b.people.owner.employeeId) });
    expect(patch.status).toBe(400);
    const head = await request(app)
      .post('/api/v1/departments')
      .set(auth(tokA))
      .send({ name: 'Ops', headEmployeeId: String(b.people.owner.employeeId) });
    expect(head.status).toBe(400);
  });
});

describe('same data in two tenants does not collide', () => {
  it('allows identical department names and employee codes per tenant', async () => {
    expect(
      (await request(app).post('/api/v1/departments').set(auth(tokA)).send({ name: 'Finance' }))
        .status,
    ).toBe(201);
    expect(
      (await request(app).post('/api/v1/departments').set(auth(tokB)).send({ name: 'Finance' }))
        .status,
    ).toBe(201);
    expect(
      (await request(app).post('/api/v1/departments').set(auth(tokB)).send({ name: 'Finance' }))
        .status,
    ).toBe(409);
  });
  it('can invite a person who already has an account in another company without taking it over', async () => {
    const created = await request(app)
      .post('/api/v1/employees')
      .set(auth(tokAHr))
      .send({ firstName: 'Bo', lastName: 'B', workEmail: b.people.employee2.email });
    const invite = await request(app)
      .post(`/api/v1/employees/${created.body.data.id}/invite`)
      .set(auth(tokAHr))
      .send({});
    expect(invite.status).toBe(200);
    // existing active user: no activation token issued, password untouched
    await expect(latestEmailToken(b.people.employee2.email, 'ACTIVATION')).rejects.toThrow();
    expect(
      (
        await request(app)
          .post('/api/v1/auth/login')
          .send({ email: b.people.employee2.email, password: PASSWORD })
      ).status,
    ).toBe(200);
  });
});

describe('platform super-admin', () => {
  it('can onboard a tenant; the owner receives an activation link', async () => {
    const res = await request(app)
      .post('/api/v1/platform/tenants')
      .set(bearer(superAdmin))
      .send({
        name: 'Charlie Ltd',
        slug: 'charlie',
        timezone: 'Europe/London',
        owner: { email: 'boss@charlie.test', firstName: 'Charlie', lastName: 'Boss' },
      });
    expect(res.status).toBe(201);
    const token = await latestEmailToken('boss@charlie.test', 'ACTIVATION');
    expect(
      (
        await request(app)
          .post('/api/v1/auth/activate')
          .send({ token, password: 'Charlie-Boss-Pass1' })
      ).status,
    ).toBe(200);
    const owner = await loginAs(app, 'boss@charlie.test', 'Charlie-Boss-Pass1');
    const me = await request(app).get('/api/v1/tenants/current').set(bearer(owner));
    expect(me.body.data.slug).toBe('charlie');
    expect(
      (
        await request(app)
          .post('/api/v1/platform/tenants')
          .set(bearer(superAdmin))
          .send({
            name: 'Dup',
            slug: 'charlie',
            owner: { email: 'z@z.test', firstName: 'z', lastName: 'z' },
          })
      ).status,
    ).toBe(409);
  });

  it("cannot read or touch any tenant's employee data", async () => {
    expect((await request(app).get('/api/v1/employees').set(bearer(superAdmin))).status).toBe(403);
    expect(
      (
        await request(app)
          .get(`/api/v1/employees/${a.people.employee.employeeId}`)
          .set(auth(superAdmin, a))
      ).status,
    ).toBe(403);
    expect((await request(app).get('/api/v1/tenants/current').set(bearer(superAdmin))).status).toBe(
      403,
    );
  });

  it('platform routes are closed to everyone else, including company owners', async () => {
    expect((await request(app).get('/api/v1/platform/tenants').set(bearer(tokA))).status).toBe(403);
    expect(
      (await request(app).post('/api/v1/platform/tenants').set(bearer(tokA)).send({})).status,
    ).toBe(403);
    expect((await request(app).get('/api/v1/platform/tenants')).status).toBe(401);
  });

  it('can suspend a tenant: members are locked out; reactivation restores access', async () => {
    const res = await request(app)
      .patch(`/api/v1/platform/tenants/${b.tenantId}/status`)
      .set(bearer(superAdmin))
      .send({ status: 'SUSPENDED', reason: 'Non-payment' });
    expect(res.status).toBe(200);
    expect((await request(app).get('/api/v1/employees').set(auth(tokB))).status).toBe(403);
    expect((await request(app).get('/api/v1/employees').set(auth(tokA))).status).toBe(200); // other tenants unaffected
    await request(app)
      .patch(`/api/v1/platform/tenants/${b.tenantId}/status`)
      .set(bearer(superAdmin))
      .send({ status: 'ACTIVE', reason: 'Paid' });
    expect((await request(app).get('/api/v1/employees').set(auth(tokB))).status).toBe(200);
    expect(await AuditLog.countDocuments({ action: 'platform.tenant_status' })).toBe(2);
  });

  it('metrics expose counts only', async () => {
    const res = await request(app).get('/api/v1/platform/metrics').set(bearer(superAdmin));
    expect(res.status).toBe(200);
    expect(res.body.data.tenantsByStatus.ACTIVE).toBeGreaterThanOrEqual(2);
  });
});

describe('tenant configuration', () => {
  it('only the owner may update; slug/status/plan cannot be changed; timezone is validated', async () => {
    expect(
      (await request(app).patch('/api/v1/tenants/current').set(auth(tokAHr)).send({ name: 'x' }))
        .status,
    ).toBe(403);
    expect(
      (await request(app).patch('/api/v1/tenants/current').set(auth(tokA)).send({ slug: 'new' }))
        .status,
    ).toBe(422);
    expect(
      (
        await request(app)
          .patch('/api/v1/tenants/current')
          .set(auth(tokA))
          .send({ status: 'CLOSED' })
      ).status,
    ).toBe(422);
    expect(
      (
        await request(app)
          .patch('/api/v1/tenants/current')
          .set(auth(tokA))
          .send({ timezone: 'Mars/Base' })
      ).status,
    ).toBe(422);
    const ok = await request(app)
      .patch('/api/v1/tenants/current')
      .set(auth(tokA))
      .send({
        timezone: 'Asia/Kolkata',
        workweek: [1, 2, 3, 4, 5, 6],
        settings: { attendance: { maxAccuracyMeters: 50 } },
      });
    expect(ok.status).toBe(200);
    expect(ok.body.data.settings.attendance.maxAccuracyMeters).toBe(50);
    expect(ok.body.data.settings.attendance.requireGeofence).toBe(true); // untouched sibling preserved
  });
});

describe('API documentation', () => {
  it('serves an OpenAPI spec that documents every registered route', async () => {
    const { routeRegistry } = await import('../src/utils/route');
    const spec = (await request(app).get('/api/v1/docs/openapi.json')).body;
    for (const r of routeRegistry) {
      const p = r.path.replace(/:([A-Za-z]+)/g, '{$1}');
      expect(spec.paths[p]?.[r.method], `${r.method} ${r.path}`).toBeDefined();
    }
    expect(Object.keys(spec.paths).length).toBeGreaterThan(15);
    const body = spec.paths['/leave/requests'].post.requestBody.content['application/json'].schema;
    expect(Object.keys(body.properties)).toEqual(
      expect.arrayContaining(['leaveTypeId', 'startDate']),
    );
    expect(body.additionalProperties).toBe(false);
  });
});
