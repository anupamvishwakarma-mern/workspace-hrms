import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import type { Env } from '../config/env';
import { runInTenantDb } from '../database/tenantContext';
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
 */
export const resolveTenant: RequestHandler = async (req, _res, next) => {
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
    const tenant = await Tenant.findById(chosen.tenantId).select('status dbName modules').lean();
    if (!tenant || tenant.status !== 'ACTIVE') throw AppError.forbidden('Company is not active');
    // Limited-access companies: refuse routes that belong to a module the platform admin switched off.
    const needed = moduleForPath(req.originalUrl.split('?')[0]!.split('/').slice(3));
    if (needed && !enabledModules(tenant.modules).includes(needed))
      throw new AppError(
        403,
        'MODULE_NOT_ENABLED',
        `${MODULES[needed].label} is not enabled for this company. Contact your platform administrator.`,
      );
    req.tenantCtx = {
      tenantId: chosen.tenantId,
      roles: chosen.roles,
      employeeId: chosen.employeeId ?? undefined,
    };
    // Everything downstream of this middleware (handlers, services, audit) talks to the company's own database.
    runInTenantDb(tenant.dbName ?? undefined, () => next());
  } catch (err) {
    next(err);
  }
};

export const requirePermission =
  (...anyOf: Permission[]): RequestHandler =>
  (req, _res, next) => {
    const roles = req.tenantCtx?.roles;
    if (!roles || !anyOf.some((p) => hasPermission(roles, p))) return next(AppError.forbidden());
    next();
  };

export const requirePlatformAdmin: RequestHandler = (req, _res, next) => {
  if (!req.auth?.isPlatformAdmin) return next(AppError.forbidden());
  next();
};
