import { loadExtraPermissions } from '../modules/auth/customRoles';
import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import type { Env } from '../config/env';
import { TENANT_DB_FIELDS } from '../database/hosting/source';
import { tenantDatabaseManager } from '../database/hosting/manager';
import { runInTenantScope } from '../database/tenantContext';
import { Membership } from '../database/models/membership.model';
import { Session } from '../database/models/session.model';
import { Tenant } from '../database/models/tenant.model';
import { User } from '../database/models/user.model';
import { hasPermission, type Permission } from '../modules/auth/permissions';
import { enabledModules, moduleForPath, MODULES } from '../modules/tenants/modules';
import { AppError } from '../utils/errors';

export const JWT_ISSUER = 'workforce-hrms';
export const JWT_AUDIENCE = 'workforce-hrms-api';

export interface AccessClaims {
  sub: string;
  sid: string;
}

export function signAccessToken(env: Env, userId: string, sessionId: string): string {
  return jwt.sign({ sid: sessionId }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  });
}

/** Verifies the bearer token, then re-checks session and user state in the database. */
export function authenticate(env: Env): RequestHandler {
  return async (req, _res, next) => {
    try {
      const header = req.header('authorization');
      if (!header?.startsWith('Bearer ')) throw AppError.unauthorized();
      let claims: AccessClaims;
      try {
        claims = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET, {
          algorithms: ['HS256'],
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        }) as unknown as AccessClaims;
      } catch (err) {
        const expired = err instanceof jwt.TokenExpiredError;
        throw new AppError(
          401,
          expired ? 'TOKEN_EXPIRED' : 'UNAUTHORIZED',
          expired ? 'Access token expired' : 'Authentication required',
        );
      }
      if (!Types.ObjectId.isValid(claims.sub) || !Types.ObjectId.isValid(claims.sid))
        throw AppError.unauthorized();
      const [session, user] = await Promise.all([
        Session.findOne({
          _id: claims.sid,
          userId: claims.sub,
          revokedAt: null,
          expiresAt: { $gt: new Date() },
        })
          .select('_id')
          .lean(),
        User.findById(claims.sub).select('status isPlatformAdmin').lean(),
      ]);
      if (!session || !user || user.status !== 'ACTIVE') throw AppError.unauthorized();
      req.auth = {
        userId: new Types.ObjectId(claims.sub),
        sessionId: new Types.ObjectId(claims.sid),
        isPlatformAdmin: user.isPlatformAdmin,
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Resolves the active tenant from the user's own ACTIVE memberships. `X-Tenant-Id` is only a
 * *selector* among tenants the user already belongs to - it never grants access by itself.
 *
 * With `withDatabase` (the default) it also opens the company's database scope for everything downstream. The
 * database-administration routes pass false: they must keep working while a customer-owned database is down, because
 * that is exactly when an owner needs to see the status and replace the connection. They get the caller's built-in
 * role permissions only (custom roles live in the company database) and no database scope.
 */
const makeTenantResolver =
  (withDatabase: boolean): RequestHandler =>
  async (req, _res, next) => {
    try {
      if (!req.auth) throw AppError.unauthorized();
      const memberships = await Membership.find({ userId: req.auth.userId, status: 'ACTIVE' }).lean();
      if (memberships.length === 0) throw AppError.forbidden('No active company membership');
      const selector = req.header('x-tenant-id');
      let chosen;
      if (selector) {
        chosen = memberships.find((m) => String(m.tenantId) === selector);
        if (!chosen) throw AppError.forbidden('You are not a member of the requested company');
      } else if (memberships.length === 1) {
        chosen = memberships[0];
      } else {
        throw AppError.badRequest('Multiple companies available; set the X-Tenant-Id header');
      }
      if (!chosen) throw AppError.forbidden();
      const tenant = await Tenant.findById(chosen.tenantId).select(`${TENANT_DB_FIELDS} modules`).lean();
      if (!tenant || tenant.status !== 'ACTIVE') throw AppError.forbidden('Company is not active');
      // Limited-access companies: refuse routes that belong to a module the platform admin switched off.
      const needed = moduleForPath(req.originalUrl.split('?')[0]!.split('/').slice(3));
      if (needed && !enabledModules(tenant.modules).includes(needed))
        throw new AppError(
          403,
          'MODULE_NOT_ENABLED',
          `${MODULES[needed].label} is not enabled for this company. Contact your platform administrator.`,
        );
      if (!withDatabase) {
        req.tenantCtx = {
          tenantId: chosen.tenantId,
          roles: chosen.roles,
          extraPermissions: new Set(),
          employeeId: chosen.employeeId ?? undefined,
        };
        return next();
      }
      // The database comes from the company's stored hosting configuration for a company the caller is verifiably a
      // member of: never from the request. Unreachable/suspended databases answer 503 here, before any handler runs.
      const scope = await tenantDatabaseManager.scopeFor(tenant);
      req.tenantCtx = {
        tenantId: chosen.tenantId,
        roles: chosen.roles,
        extraPermissions: await loadExtraPermissions(scope, chosen.tenantId, chosen.customRoleIds, tenant.modules),
        employeeId: chosen.employeeId ?? undefined,
      };
      // Everything downstream of this middleware (handlers, services, audit) talks to the company's own database.
      runInTenantScope(scope, () => next());
    } catch (err) {
      next(err);
    }
  };

export const resolveTenant: RequestHandler = makeTenantResolver(true);
/** For the database-administration routes only: identifies the company without needing its database to be reachable. */
export const resolveTenantWithoutDatabase: RequestHandler = makeTenantResolver(false);

export const requirePermission =
  (...anyOf: Permission[]): RequestHandler =>
  (req, _res, next) => {
    const ctx = req.tenantCtx;
    if (!ctx || !anyOf.some((p) => hasPermission(ctx, p))) return next(AppError.forbidden());
    next();
  };

export const requirePlatformAdmin: RequestHandler = (req, _res, next) => {
  if (!req.auth?.isPlatformAdmin) return next(AppError.forbidden());
  next();
};
