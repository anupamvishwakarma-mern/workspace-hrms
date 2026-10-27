import type { Router } from 'express';
import type { Env } from '../../config/env';
import { runInTenantDb } from '../../database/tenantContext';
import { createLimiter } from '../../middleware/rateLimit';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/errors';
import { route } from '../../utils/route';
import { validate } from '../../utils/validate';
import { writeAudit } from '../audit/audit.service';
import { onboardBody, provisionTenant } from '../tenants/provisioning';

/** Public, unauthenticated company signup. Creates the company's own database and emails the owner an activation link. */
export function registerSignupRoutes(v1: Router, env: Env): void {
  const limiter = createLimiter(env.RATE_LIMIT_SIGNUP_MAX, 60 * 60 * 1000);
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
      await runInTenantDb(out.dbName, () =>
        writeAudit(req, {
          action: 'tenant.signup',
          entityType: 'Tenant',
          entityId: out.tenantId,
          tenantId: out.tenantId,
          after: { slug: out.slug, maxEmployees: req.body.maxEmployees },
        }),
      );
      res.status(201).json({
        success: true,
        data: {
          company: { name: req.body.name, slug: out.slug, maxEmployees: req.body.maxEmployees },
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
