import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/database/models/auditLog.model';
import { Employee } from '../src/database/models/employee.model';
import { User } from '../src/database/models/user.model';
import {
  PASSWORD,
  bearer,
  createTenant,
  latestEmailToken,
  loginAs,
  startTestApp,
  stopTestApp,
  type TestTenant,
} from './helpers';

let app: Express;
let t: TestTenant;
const tok: Record<string, string> = {};
const api = (method: 'get' | 'post' | 'patch', path: string, who: string) =>
  request(app)[method](`/api/v1${path}`).set(bearer(tok[who]!));

beforeAll(async () => {
  ({ app } = await startTestApp());
  t = await createTenant('acme');
  for (const k of Object.keys(t.people) as (keyof TestTenant['people'])[])
    tok[k] = await loginAs(app, t.people[k].email);
});
afterAll(stopTestApp);

const newEmp = (over: object = {}) => ({
  firstName: 'New',
  lastName: 'Hire',
  workEmail: `new${Math.random().toString(36).slice(2, 8)}@acme.test`,
  ...over,
});

describe('role-based access', () => {
  it('HR can create employees (auto code, INVITED status) and writes an audit log', async () => {
    const res = await api('post', '/employees', 'hr').send(
      newEmp({ departmentId: String(t.department) }),
    );
    expect(res.status).toBe(201);
    expect(res.body.data.employmentStatus).toBe('INVITED');
    expect(res.body.data.employeeCode).toMatch(/^EMP-\d{4}$/);
    expect(
      await AuditLog.countDocuments({ action: 'employee.create', entityId: res.body.data.id }),
    ).toBe(1);
  });

  it.each(['manager', 'employee', 'payroll'])('%s cannot create employees', async (who) => {
    expect((await api('post', '/employees', who).send(newEmp())).status).toBe(403);
  });

  it('auto-generated codes skip codes that were typed in by hand', async () => {
    const first = await api('post', '/employees', 'hr').send(newEmp());
    const n = Number(/EMP-(\d+)/.exec(first.body.data.employeeCode)![1]);
    for (const k of [1, 2])
      expect(
        (
          await api('post', '/employees', 'hr').send(
            newEmp({ employeeCode: `EMP-${String(n + k).padStart(4, '0')}` }),
          )
        ).status,
      ).toBe(201);
    const next = await api('post', '/employees', 'hr').send(newEmp());
    expect(next.status).toBe(201);
    expect(next.body.data.employeeCode).toBe(`EMP-${String(n + 3).padStart(4, '0')}`);
    // an explicit duplicate code is still a conflict
    expect(
      (
        await api('post', '/employees', 'hr').send(
          newEmp({ employeeCode: first.body.data.employeeCode }),
        )
      ).status,
    ).toBe(409);
  });

  it('rejects duplicate work emails within a tenant', async () => {
    const body = newEmp();
    expect((await api('post', '/employees', 'hr').send(body)).status).toBe(201);
    expect((await api('post', '/employees', 'hr').send(body)).status).toBe(409);
  });

  it('employee sees only their own record; manager sees self + direct reports; HR sees all', async () => {
    const count = async (who: string) =>
      (await api('get', '/employees?limit=100', who)).body.meta.total as number;
    expect(await count('employee')).toBe(1);
    expect(await count('manager')).toBe(2); // self + employee
    expect(await count('hr')).toBeGreaterThanOrEqual(6);
  });

  it('manager cannot open an employee outside their team (404, not 403)', async () => {
    expect(
      (await api('get', `/employees/${t.people.employee2.employeeId}`, 'manager')).status,
    ).toBe(404);
    expect((await api('get', `/employees/${t.people.employee.employeeId}`, 'manager')).status).toBe(
      200,
    );
  });

  it('employee cannot read a colleague', async () => {
    expect(
      (await api('get', `/employees/${t.people.employee2.employeeId}`, 'employee')).status,
    ).toBe(404);
  });

  it('data minimisation: field sets differ by viewer', async () => {
    await Employee.updateOne(
      { _id: t.people.employee.employeeId },
      {
        $set: {
          address: { city: 'Pune' },
          emergencyContacts: [{ name: 'Mum', phone: '12345', relationship: 'parent' }],
        },
      },
    );
    const id = t.people.employee.employeeId;
    const asHr = (await api('get', `/employees/${id}`, 'hr')).body.data;
    const asMgr = (await api('get', `/employees/${id}`, 'manager')).body.data;
    const asSelf = (await api('get', `/employees/${id}`, 'employee')).body.data;
    const asPayroll = (await api('get', `/employees/${id}`, 'payroll')).body.data;
    expect(asHr.address).toBeDefined();
    expect(asHr.history).toBeDefined();
    expect(asSelf.address).toBeDefined();
    expect(asSelf.history).toBeUndefined();
    expect(asMgr.address).toBeUndefined();
    expect(asMgr.emergencyContacts).toBeUndefined();
    expect(asPayroll.address).toBeUndefined();
    expect(asPayroll.phone).toBeUndefined();
    expect(asPayroll.workEmail).toBeUndefined();
    expect(asPayroll.employeeCode).toBeDefined();
  });
});

describe('list: search, filter, sort, pagination', () => {
  it('paginates, sorts and searches safely', async () => {
    const page = await api('get', '/employees?limit=2&page=1&sort=-firstName', 'hr');
    expect(page.body.data).toHaveLength(2);
    expect(page.body.meta.limit).toBe(2);
    const names = page.body.data.map((e: { firstName: string }) => e.firstName);
    expect([...names].sort().reverse()).toEqual(names);
    const search = await api('get', '/employees?search=manager', 'hr');
    expect(search.body.data.some((e: { firstName: string }) => e.firstName === 'manager')).toBe(
      true,
    );
    expect((await api('get', '/employees?search=.*', 'hr')).body.meta.total).toBe(0); // regex metachars are escaped
    expect((await api('get', '/employees?limit=1000', 'hr')).status).toBe(422);
    expect((await api('get', '/employees?sort=passwordHash', 'hr')).status).toBe(422);
  });

  it('rejects NoSQL operators in query strings', async () => {
    expect((await api('get', '/employees?status[$ne]=ACTIVE', 'hr')).status).toBe(400);
    expect((await api('get', '/employees?departmentId[$gt]=', 'hr')).status).toBe(400);
  });
});

describe('updates and mass assignment', () => {
  it('rejects unknown/privileged fields (mass assignment)', async () => {
    const id = t.people.employee.employeeId;
    expect(
      (await api('patch', `/employees/${id}`, 'hr').send({ tenantId: String(t.tenantId) })).status,
    ).toBe(422);
    expect(
      (await api('patch', `/employees/${id}`, 'hr').send({ userId: String(t.people.owner.userId) }))
        .status,
    ).toBe(422);
    expect(
      (await api('patch', `/employees/${id}`, 'hr').send({ roles: ['COMPANY_OWNER'] })).status,
    ).toBe(422);
    expect(
      (await api('post', '/employees', 'hr').send(newEmp({ employmentStatus: 'ACTIVE' }))).status,
    ).toBe(422);
  });

  it('employees may edit only their own contact details', async () => {
    const id = t.people.employee.employeeId;
    expect(
      (await api('patch', `/employees/${id}`, 'employee').send({ phone: '+91 98765 43210' }))
        .status,
    ).toBe(200);
    expect(
      (await api('patch', `/employees/${id}`, 'employee').send({ designation: 'CEO' })).status,
    ).toBe(422);
    expect(
      (
        await api('patch', `/employees/${id}`, 'employee').send({
          managerId: String(t.people.owner.employeeId),
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await api('patch', `/employees/${t.people.employee2.employeeId}`, 'employee').send({
          phone: '+91 11111 11111',
        })
      ).status,
    ).toBe(403);
  });

  it('managers cannot edit employees', async () => {
    expect(
      (
        await api('patch', `/employees/${t.people.employee.employeeId}`, 'manager').send({
          designation: 'x',
        })
      ).status,
    ).toBe(403);
  });

  it('records manager/department changes in history and blocks reporting cycles', async () => {
    const id = t.people.employee.employeeId;
    const res = await api('patch', `/employees/${id}`, 'hr').send({
      managerId: String(t.people.hr.employeeId),
    });
    expect(res.status).toBe(200);
    expect(res.body.data.history.some((h: { type: string }) => h.type === 'MANAGER_CHANGE')).toBe(
      true,
    );
    // hr -> employee -> hr would be a cycle
    expect(
      (
        await api('patch', `/employees/${t.people.hr.employeeId}`, 'hr').send({
          managerId: String(id),
        })
      ).status,
    ).toBe(400);
    expect(
      (await api('patch', `/employees/${id}`, 'hr').send({ managerId: String(id) })).status,
    ).toBe(400);
    await api('patch', `/employees/${id}`, 'hr').send({
      managerId: String(t.people.manager.employeeId),
    });
  });

  it('enforces employment-status transitions', async () => {
    const created = (await api('post', '/employees', 'hr').send(newEmp())).body.data;
    expect(
      (
        await api('patch', `/employees/${created.id}`, 'hr').send({
          employmentStatus: 'NOTICE_PERIOD',
        })
      ).status,
    ).toBe(409); // INVITED -> NOTICE_PERIOD
    expect(
      (
        await api('patch', `/employees/${created.id}`, 'hr').send({
          employmentStatus: 'TERMINATED',
        })
      ).status,
    ).toBe(422);
    const active = t.people.employee2.employeeId;
    const notice = await api('patch', `/employees/${active}`, 'hr').send({
      employmentStatus: 'NOTICE_PERIOD',
    });
    expect(notice.status).toBe(200);
    expect(notice.body.data.noticePeriodStartDate).toBeTruthy();
    await api('patch', `/employees/${active}`, 'hr').send({ employmentStatus: 'ACTIVE' });
  });
});

describe('invitation and activation lifecycle', () => {
  it('invites, activates with a single-use token, and the new user can log in with only EMPLOYEE access', async () => {
    const created = (
      await api('post', '/employees', 'hr').send(newEmp({ workEmail: 'fresh@acme.test' }))
    ).body.data;
    expect((await api('post', `/employees/${created.id}/invite`, 'hr').send({})).status).toBe(200);
    const token = await latestEmailToken('fresh@acme.test', 'ACTIVATION');
    expect(
      (
        await request(app)
          .post('/api/v1/auth/login')
          .send({ email: 'fresh@acme.test', password: PASSWORD })
      ).status,
    ).toBe(401); // not active yet
    const act = await request(app)
      .post('/api/v1/auth/activate')
      .send({ token, password: 'Fresh-Start-Pass-1' });
    expect(act.status).toBe(200);
    expect(
      (
        await request(app)
          .post('/api/v1/auth/activate')
          .send({ token, password: 'Fresh-Start-Pass-2' })
      ).status,
    ).toBe(400);
    const access = await loginAs(app, 'fresh@acme.test', 'Fresh-Start-Pass-1');
    const mine = await request(app).get('/api/v1/employees').set(bearer(access));
    expect(mine.body.meta.total).toBe(1);
    expect(mine.body.data[0].employmentStatus).toBe('ACTIVE');
    expect(
      (await request(app).post('/api/v1/employees').set(bearer(access)).send(newEmp())).status,
    ).toBe(403);
  });

  it('HR cannot grant elevated roles; owner can', async () => {
    const e1 = (await api('post', '/employees', 'hr').send(newEmp())).body.data;
    expect(
      (await api('post', `/employees/${e1.id}/invite`, 'hr').send({ roles: ['COMPANY_OWNER'] }))
        .status,
    ).toBe(403);
    expect(
      (await api('post', `/employees/${e1.id}/invite`, 'hr').send({ roles: ['HR_ADMIN'] })).status,
    ).toBe(403);
    expect(
      (await api('post', `/employees/${e1.id}/invite`, 'owner').send({ roles: ['HR_ADMIN'] }))
        .status,
    ).toBe(200);
    expect((await api('post', `/employees/${e1.id}/invite`, 'manager').send({})).status).toBe(403);
  });

  it('role changes are guarded: no self-change, HR cannot touch owners, last owner protected', async () => {
    expect(
      (
        await api('patch', `/employees/${t.people.owner.employeeId}/roles`, 'owner').send({
          roles: ['EMPLOYEE'],
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api('patch', `/employees/${t.people.owner.employeeId}/roles`, 'hr').send({
          roles: ['EMPLOYEE'],
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api('patch', `/employees/${t.people.employee2.employeeId}/roles`, 'hr').send({
          roles: ['MANAGER'],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await api('patch', `/employees/${t.people.employee2.employeeId}/roles`, 'hr').send({
          roles: ['HR_ADMIN'],
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api('patch', `/employees/${t.people.employee2.employeeId}/roles`, 'owner').send({
          roles: ['EMPLOYEE'],
        })
      ).status,
    ).toBe(200);
  });
});

describe('deactivation', () => {
  it('disables login and revokes sessions but retains the employee record', async () => {
    const victim = t.people.payroll;
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: victim.email, password: PASSWORD });
    const res = await api('post', `/employees/${victim.employeeId}/deactivate`, 'hr').send({
      reason: 'Left the company',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.employmentStatus).toBe('TERMINATED');
    expect(
      (await request(app).get('/api/v1/employees').set(bearer(login.body.data.accessToken))).status,
    ).toBe(401); // session revoked
    expect(
      (
        await request(app)
          .post('/api/v1/auth/refresh')
          .send({ refreshToken: login.body.data.refreshToken })
      ).status,
    ).toBe(401);
    const stillThere = await api('get', `/employees/${victim.employeeId}`, 'hr');
    expect(stillThere.status).toBe(200);
    expect(stillThere.body.data.lastWorkingDate).toBeTruthy();
    expect(
      (await api('patch', `/employees/${victim.employeeId}`, 'hr').send({ designation: 'x' }))
        .status,
    ).toBe(409);
    const audit = await AuditLog.findOne({
      action: 'employee.deactivate',
      entityId: String(victim.employeeId),
    }).lean();
    expect(audit?.reason).toBe('Left the company');
  });

  it('cannot deactivate yourself or the last owner', async () => {
    expect(
      (
        await api('post', `/employees/${t.people.hr.employeeId}/deactivate`, 'hr').send({
          reason: 'oops oops',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api('post', `/employees/${t.people.owner.employeeId}/deactivate`, 'hr').send({
          reason: 'remove owner',
        })
      ).status,
    ).toBe(409);
  });

  it('requires a reason', async () => {
    expect(
      (await api('post', `/employees/${t.people.employee2.employeeId}/deactivate`, 'hr').send({}))
        .status,
    ).toBe(422);
  });
});

describe('audit and secrets hygiene', () => {
  it('audit records never contain password hashes or tokens', async () => {
    const dump = JSON.stringify(await AuditLog.find().lean());
    expect(dump).not.toMatch(/\$argon2/);
    expect(await User.countDocuments()).toBeGreaterThan(0);
  });

  it('audit records are immutable', async () => {
    const rec = await AuditLog.findOne().lean();
    await expect(
      AuditLog.updateOne({ _id: rec!._id }, { $set: { action: 'tampered' } }),
    ).rejects.toThrow(/immutable/);
    await expect(AuditLog.deleteMany({})).rejects.toThrow(/immutable/);
    await expect(AuditLog.findOneAndUpdate({ _id: rec!._id }, { reason: 'x' })).rejects.toThrow(
      /immutable/,
    );
    const doc = await AuditLog.findById(rec!._id);
    doc!.action = 'tampered';
    await expect(doc!.save()).rejects.toThrow(/immutable/);
  });
});
