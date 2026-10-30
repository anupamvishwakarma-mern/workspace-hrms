import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Employee } from '../src/database/models/employee.model';
import { LeaveType } from '../src/database/models/leaveType.model';
import { Shift } from '../src/database/models/shift.model';
import { Tenant } from '../src/database/models/tenant.model';
import { runInTenantDb } from '../src/database/tenantContext';
import { bearer, latestEmailToken, loginAs, startTestApp, stopTestApp } from './helpers';

let app: Express;
const PASS = 'Zeta-Owner-Pass1';
const body = (over: Record<string, unknown> = {}) => ({
  name: 'Zeta Corp',
  maxEmployees: 2,
  timezone: 'Asia/Kolkata',
  owner: { email: 'owner@zeta.test', firstName: 'Zed', lastName: 'Owner' },
  ...over,
});

beforeAll(async () => {
  ({ app } = await startTestApp({ RATE_LIMIT_SIGNUP_MAX: '10000' })); // this file makes more than 5 signup calls
});
afterAll(stopTestApp);

describe('public company signup', () => {
  it('creates the company in its own database with defaults and a seat limit', async () => {
    const res = await request(app).post('/api/v1/signup').send(body());
    expect(res.status).toBe(201);
    expect(res.body.data.company).toMatchObject({ slug: 'zeta-corp', maxEmployees: 2 });

    const tenant = await Tenant.findOne({ slug: 'zeta-corp' }).lean();
    expect(tenant?.dbName).toBe('ZETA_CORP_HRM');
    expect(tenant?.maxEmployees).toBe(2);

    // The company's data lives in its own database, not the shared one.
    const own = await runInTenantDb('ZETA_CORP_HRM', () =>
      Employee.countDocuments({ tenantId: tenant!._id }),
    );
    const shared = await Employee.countDocuments({ tenantId: tenant!._id });
    expect(own).toBe(1);
    expect(shared).toBe(0);
    expect(
      await runInTenantDb('ZETA_CORP_HRM', () => LeaveType.countDocuments({ tenantId: tenant!._id })),
    ).toBe(4);
    expect(
      await runInTenantDb('ZETA_CORP_HRM', () => Shift.countDocuments({ tenantId: tenant!._id })),
    ).toBe(1);
  });

  it('lets the owner activate, sign in and add members only up to the limit', async () => {
    const token = await latestEmailToken('owner@zeta.test', 'ACTIVATION');
    expect(
      (await request(app).post('/api/v1/auth/activate').send({ token, password: PASS })).status,
    ).toBe(200);
    const owner = await loginAs(app, 'owner@zeta.test', PASS);
    const me = await request(app).get('/api/v1/tenants/current').set(bearer(owner));
    expect(me.body.data).toMatchObject({ slug: 'zeta-corp', maxEmployees: 2 });

    const add = (n: number) =>
      request(app)
        .post('/api/v1/employees')
        .set(bearer(owner))
        .send({ firstName: 'Emp', lastName: String(n), workEmail: `emp${n}@zeta.test` });
    expect((await add(1)).status).toBe(201); // owner + 1 = 2 members
    const over = await add(2);
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('SEAT_LIMIT_REACHED');
  });

  it('rejects bad input, duplicate slugs and existing accounts', async () => {
    expect((await request(app).post('/api/v1/signup').send(body({ maxEmployees: 0 }))).status).toBe(422);
    expect((await request(app).post('/api/v1/signup').send({ ...body(), maxEmployees: undefined })).status).toBe(422);
    const dup = await request(app)
      .post('/api/v1/signup')
      .send(body({ owner: { email: 'other@zeta.test', firstName: 'O', lastName: 'T' } }));
    // Same company name without an explicit slug: a unique slug is generated instead of failing.
    expect(dup.status).toBe(201);
    expect(dup.body.data.company.slug).not.toBe('zeta-corp');
    expect(dup.body.data.company.slug).toMatch(/^zeta-corp-/);
    const dupSlug = await request(app)
      .post('/api/v1/signup')
      .send(body({ name: 'Other', slug: 'zeta-corp', owner: { email: 'x@zeta.test', firstName: 'X', lastName: 'Y' } }));
    expect(dupSlug.status).toBe(409);
    const taken = await request(app)
      .post('/api/v1/signup')
      .send(body({ name: 'Another Co' })); // owner@zeta.test already has an account
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('EMAIL_IN_USE');
  });

  it('is closed when PUBLIC_SIGNUP_ENABLED=false', async () => {
    await stopTestApp();
    ({ app } = await startTestApp({ PUBLIC_SIGNUP_ENABLED: 'false' }));
    const res = await request(app)
      .post('/api/v1/signup')
      .send(body({ name: 'Closed Co', owner: { email: 'c@closed.test', firstName: 'C', lastName: 'C' } }));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SIGNUP_DISABLED');
  });
});
