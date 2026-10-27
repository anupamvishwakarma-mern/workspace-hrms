import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS, hasPermission } from '../src/modules/auth/permissions';
import { routeRegistry, type RouteDoc } from '../src/utils/route';
import {
  bearer,
  createTenant,
  loginAs,
  startTestApp,
  stopTestApp,
  type TestTenant,
} from './helpers';

/**
 * Authorization matrix generated from the route registry: for every route that declares a permission,
 *  - no token                       -> 401
 *  - every role WITHOUT the permission -> 403 (checked before any validation or side effect)
 *  - every role WITH it, on GET     -> never 401/403 (the declaration is not stricter than the code)
 * Routes that declare no permission must be on the explicit self-service list, so a new unguarded route fails here.
 */
let app: Express;
let t: TestTenant;
const tok: Record<string, string> = {};
const ROLES = ['owner', 'hr', 'manager', 'employee', 'payroll'] as const;
const ALL_PERMS = [...new Set(Object.values(ROLE_PERMISSIONS).flat())] as string[];
/** A declaration may list alternatives ("a | b") or a family ("employee:read:*"): the role needs any of them. */
const granted = (roles: (typeof t)['people']['owner']['roles'], declared: string) =>
  declared
    .split('|')
    .map((d) => d.trim())
    .flatMap((d) => (d.endsWith('*') ? ALL_PERMS.filter((p) => p.startsWith(d.slice(0, -1))) : [d]))
    .some((p) => hasPermission(roles, p as never));
const ID = '64b64b64b64b64b64b64b64b';
const url = (r: RouteDoc) => `/api/v1${r.path.replace(/:[A-Za-z]+/g, ID)}`;
const send = (r: RouteDoc, token?: string) => {
  const req = request(app)[r.method](url(r));
  if (token) req.set(bearer(token)).set('X-Tenant-Id', String(t.tenantId));
  return r.method === 'get' || r.method === 'delete' ? req : req.send({});
};

/** Routes any signed-in member may call because they only ever act on the caller's own data. */
const SELF_SERVICE = new Set([
  'get /me',
  'post /me/push-tokens',
  'post /me/push-tokens/remove',
  'get /me/sessions',
]);

beforeAll(async () => {
  ({ app } = await startTestApp());
  t = await createTenant('matrix');
  for (const r of ROLES) tok[r] = await loginAs(app, t.people[r].email);
});
afterAll(stopTestApp);

const tenantRoutes = () => routeRegistry.filter((r) => r.auth === 'tenant');

describe('authorization matrix', () => {
  it('has routes to check', () => {
    expect(tenantRoutes().length).toBeGreaterThan(50);
  });

  it('every tenant route requires a token', async () => {
    for (const r of tenantRoutes()) {
      const res = await send(r);
      expect(res.status, `${r.method} ${r.path} without a token`).toBe(401);
    }
  });

  it('roles without the declared permission are refused with 403', async () => {
    for (const r of tenantRoutes().filter((x) => x.permission)) {
      for (const role of ROLES) {
        if (granted(t.people[role].roles, r.permission!)) continue;
        const res = await send(r, tok[role]);
        expect(res.status, `${role} on ${r.method} ${r.path} (${r.permission})`).toBe(403);
      }
    }
  });

  it('roles with the permission are not locked out of GET routes', async () => {
    for (const r of tenantRoutes().filter((x) => x.permission && x.method === 'get')) {
      for (const role of ROLES) {
        if (!granted(t.people[role].roles, r.permission!)) continue;
        const res = await send(r, tok[role]);
        expect([401, 403], `${role} on GET ${r.path}`).not.toContain(res.status);
      }
    }
  });

  it('a tenant route without a declared permission must be on the self-service list', () => {
    const open = tenantRoutes()
      .filter((r) => !r.permission)
      .map((r) => `${r.method} ${r.path}`)
      .filter((k) => !SELF_SERVICE.has(k));
    expect(open).toEqual([]);
  });

  it('platform routes are closed to company roles, including owners', async () => {
    for (const r of routeRegistry.filter((x) => x.auth === 'platform')) {
      for (const role of ROLES) {
        const res = await send(r, tok[role]);
        expect([403, 404], `${role} on ${r.method} ${r.path}`).toContain(res.status);
      }
    }
  });
});
