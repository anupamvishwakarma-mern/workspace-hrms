import type { Router } from 'express';
import type { Env } from '../../config/env';
import { createLimiter } from '../../middleware/rateLimit';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/errors';
import { route } from '../../utils/route';
import { validate } from '../../utils/validate';
import { writeTenantAudit } from '../audit/audit.service';
import { z } from 'zod';
import { tenantDatabaseManager } from '../../database/hosting/manager';
import { verifyCustomerDatabase } from '../../database/hosting/verify';
import { onboardBody, provisionTenant } from '../tenants/provisioning';

/** Public, unauthenticated company signup. Creates the company's own database and emails the owner an activation link. */
const testBody = z
  .object({
    connectionString: z.string().trim().min(10).max(2048),
    databaseName: z.string().trim().min(1).max(60).optional(),
  })
  .strict();

export function registerSignupRoutes(v1: Router, env: Env): void {
  const limiter = createLimiter(env.RATE_LIMIT_SIGNUP_MAX, 60 * 60 * 1000);
  const testLimiter = createLimiter(env.RATE_LIMIT_DB_TEST_MAX, 60 * 60 * 1000);

  route(
    v1,
    {
      method: 'get',
      path: '/signup/options',
      summary: 'Which database hosting options signup offers (customer-owned needs platform configuration).',
      tags: ['Onboarding'],
      auth: 'none',
    },
    (_req, res) => {
      res.json({
        success: true,
        data: {
          hostingModes: [
            { mode: 'MANAGED', available: true },
            { mode: 'CUSTOMER_OWNED', available: tenantDatabaseManager.getSettings().customerOwnedEnabled },
          ],
        },
      });
    },
  );

  route(
    v1,
    {
      method: 'post',
      path: '/signup/database/test',
      summary:
        'Test a customer-owned MongoDB connection during signup. Nothing is saved. Rate limited; private/internal hosts are refused. Returns which checks passed or a clear reason for failure.',
      tags: ['Onboarding'],
      auth: 'none',
      body: testBody,
    },
    testLimiter,
    validate({ body: testBody }),
    asyncHandler(async (req, res) => {
      if (!env.PUBLIC_SIGNUP_ENABLED)
        throw new AppError(403, 'SIGNUP_DISABLED', 'Company signup is not open. Contact the platform administrator.');
      const r = await verifyCustomerDatabase(tenantDatabaseManager.getSettings(), req.body);
      res.json({ success: true, data: { ok: true, databaseName: r.databaseName, serverVersion: r.serverVersion, checks: r.checks } });
    }),
  );

  route(
    v1,
    {
      method: 'post',
      path: '/signup',
      summary:
        'Self-service company signup: creates the company, its own database (<SLUG>_HRM), the owner account, default leave types and shift, and emails the owner an activation link.',
      tags: ['Onboarding'],
      auth: 'none',
      body: onboardBody,
      successStatus: 201,
    },
    limiter,
    validate({ body: onboardBody }),
    asyncHandler(async (req, res) => {
      if (!env.PUBLIC_SIGNUP_ENABLED)
        throw new AppError(403, 'SIGNUP_DISABLED', 'Company signup is not open. Contact the platform administrator.');
      const out = await provisionTenant(env, req.body, { allowExistingOwner: false });
      await writeTenantAudit(req, out.tenantId, {
          action: 'tenant.signup',
          entityType: 'Tenant',
          entityId: out.tenantId,
          tenantId: out.tenantId,
          after: { slug: out.slug, maxEmployees: req.body.maxEmployees, hostingMode: out.hostingMode },
      });
      res.status(201).json({
        success: true,
        data: {
          company: { name: req.body.name, slug: out.slug, maxEmployees: req.body.maxEmployees, hostingMode: out.hostingMode },
          message:
            env.EMAIL_PROVIDER === 'none'
              ? 'Your workspace is ready. Email delivery is not configured, so set your password with the button below.'
              : `Your workspace is ready. We sent an activation link to ${req.body.owner.email}.`,
          // Only when no email can be delivered and not in production (local development): otherwise nobody could log in.
          activationLink:
            env.EMAIL_PROVIDER === 'none' && env.NODE_ENV !== 'production'
              ? out.activationLink
              : undefined,
        },
      });
    }),
  );
}
