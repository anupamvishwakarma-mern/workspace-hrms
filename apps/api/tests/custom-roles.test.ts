import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CustomRole } from '../src/database/models/customRole.model';
import { Membership } from '../src/database/models/membership.model';
import {
  addPerson,
  bearer,
  createTenant,
  loginAs,
  startTestApp,
  stopTestApp,
  PASSWORD,
  type TestTenant,
} from './helpers';

let app: Express;
let t: TestTenant;
let beta: TestTenant;

beforeAll(async () => {
  ({ app } = await startTestApp());
  t = await createTenant('acme');
  beta = await createTenant('beta');
});
afterAll(stopTestApp);

const login = async (email: string) =>
  (await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD })).body.data;

describe('company-defined roles are resolved into permissions', () => {
  it('add permissions on top of built-in roles, never locked ones, and are re-read on every request', async () => {
    const p = await addPerson(t.tenantId, 'acme', 'recruiterx', ['EMPLOYEE'], t.department);
    const before = await loginAs(app, p.email);
    const audit = (tok: string) =>
      request(app).get('/api/v1/audit-logs').set(bearer(tok)).set('X-Tenant-Id', String(t.tenantId));
    expect((await audit(before)).status).toBe(403);

    const role = await CustomRole.create({
      tenantId: t.tenantId,
      name: 'Auditor',
      // payroll:publish and tenant:update are locked: even if they were stored, they must not take effect
      permissions: ['audit:read', 'payroll:publish', 'tenant:update', 'not-a-permission'],
    });
    await Membership.updateOne(
      { tenantId: t.tenantId, userId: p.userId },
      { $set: { customRoleIds: [role._id] } },
    );

    // same token, next request: the new permission applies without logging in again
    expect((await audit(before)).status).toBe(200);

    const data = await login(p.email);
    const perms: string[] = data.memberships[0].permissions;
    expect(perms).toContain('audit:read');
    expect(perms).not.toContain('payroll:publish');
    expect(perms).not.toContain('tenant:update');
    expect(perms).not.toContain('not-a-permission');
    expect(data.memberships[0].roles).toEqual(['EMPLOYEE']); // built-in roles are unchanged

    await Membership.updateOne({ tenantId: t.tenantId, userId: p.userId }, { $set: { customRoleIds: [] } });
    expect((await audit(before)).status).toBe(403);
  });

  it('ignores a role id that belongs to another company', async () => {
    const p = await addPerson(t.tenantId, 'acme', 'sneaky', ['EMPLOYEE'], t.department);
    const foreign = await CustomRole.create({ tenantId: beta.tenantId, name: 'Foreign', permissions: ['audit:read'] });
    await Membership.updateOne({ tenantId: t.tenantId, userId: p.userId }, { $set: { customRoleIds: [foreign._id] } });
    const tok = await loginAs(app, p.email);
    const res = await request(app).get('/api/v1/audit-logs').set(bearer(tok)).set('X-Tenant-Id', String(t.tenantId));
    expect(res.status).toBe(403);
    expect((await login(p.email)).memberships[0].permissions).not.toContain('audit:read');
  });
});
