import type { Router } from 'express';
import { localDate } from '../attendance/dates';
import { enabledModules } from './modules';
import { PREFIX_RE, resolveNumbering } from './numbering';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { Tenant } from '../../database/models/tenant.model';
import { authenticate, requirePermission, resolveTenant } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/errors';
import { route } from '../../utils/route';
import { validate } from '../../utils/validate';
import { writeAudit } from '../audit/audit.service';

export const timezoneSchema = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Invalid IANA timezone');

const numberingRule = z
  .object({
    prefix: z
      .string()
      .trim()
      .toUpperCase()
      .refine((s) => PREFIX_RE.test(s), 'Use up to 10 letters, digits, - _ or /'),
    padding: z.number().int().min(1).max(8),
  })
  .partial()
  .strict();

const patchBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    timezone: timezoneSchema,
    workweek: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .max(7)
      .refine((a) => new Set(a).size === a.length, 'Duplicate days'),
    settings: z
      .object({
        attendance: z
          .object({
            requireGeofence: z.boolean(),
            maxAccuracyMeters: z.number().min(5).max(1000),
            allowSelfApproval: z.boolean(),
            allowGpsExceptions: z.boolean(),
            requirePhoto: z.boolean(),
            maxOpenSessionHours: z.number().int().min(4).max(24),
          })
          .partial()
          .strict(),
        payroll: z.object({ requireSeparatePublisher: z.boolean() }).partial().strict(),
        leave: z.object({ autoAccrual: z.boolean() }).partial().strict(),
        numbering: z
          .object({ employee: numberingRule, letter: numberingRule, document: numberingRule })
          .partial()
          .strict(),
      })
      .partial()
      .strict(),
    branding: z
      .object({
        logoUrl: z.string().url().max(500),
        primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      })
      .partial()
      .strict(),
  })
  .partial()
  .strict();

export const serializeTenant = (t: Record<string, unknown> & { _id: unknown }) => ({
  id: String(t._id),
  name: t.name,
  slug: t.slug,
  status: t.status,
  timezone: t.timezone,
  workweek: t.workweek,
  planId: t.planId,
  maxEmployees: t.maxEmployees,
  dbName: t.dbName,
  modules: enabledModules(t.modules as string[] | undefined),
  settings: t.settings,
  numbering: resolveNumbering((t.settings as { numbering?: never } | undefined)?.numbering),
  branding: t.branding,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
});

function flatten(prefix: string, obj: Record<string, unknown>, out: Record<string, unknown> = {}) {
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v))
      flatten(`${prefix}${k}.`, v as Record<string, unknown>, out);
    else out[`${prefix}${k}`] = v;
  }
  return out;
}

export function registerTenantRoutes(v1: Router, env: Env): void {
  const chain = [authenticate(env), resolveTenant];

  route(
    v1,
    {
      method: 'get',
      path: '/tenants/current',
      summary: 'Current company profile and configuration.',
      tags: ['Tenants'],
      auth: 'tenant',
      permission: 'tenant:read',
    },
    ...chain,
    requirePermission('tenant:read'),
    asyncHandler(async (req, res) => {
      const tenant = await Tenant.findById(req.tenantCtx!.tenantId).lean();
      if (!tenant) throw AppError.notFound();
      res.json({ success: true, data: serializeTenant(tenant) });
    }),
  );

  route(
    v1,
    {
      method: 'patch',
      path: '/tenants/current',
      summary:
        'Update company configuration (owner only). Slug, status and plan cannot be changed here.',
      tags: ['Tenants'],
      auth: 'tenant',
      permission: 'tenant:update',
      body: patchBody,
    },
    ...chain,
    requirePermission('tenant:update'),
    validate({ body: patchBody }),
    asyncHandler(async (req, res) => {
      const before = await Tenant.findById(req.tenantCtx!.tenantId).lean();
      if (!before) throw AppError.notFound();
      const { settings, branding, ...rest } = req.body as Record<string, unknown>;
      const $set = {
        ...rest,
        ...(settings ? flatten('settings.', settings as Record<string, unknown>) : {}),
        ...(branding ? flatten('branding.', branding as Record<string, unknown>) : {}),
      };
      // Switching automatic leave on starts the clock at the current month, so it never back-fills history.
      const turningOn =
        (settings as { leave?: { autoAccrual?: boolean } } | undefined)?.leave?.autoAccrual === true &&
        !(before.settings as { leave?: { autoAccrual?: boolean } } | undefined)?.leave?.autoAccrual;
      if (turningOn)
        ($set as Record<string, unknown>)['settings.leave.autoSince'] = localDate(new Date(), before.timezone).slice(0, 7);
      const after = await Tenant.findByIdAndUpdate(before._id, { $set }, { new: true }).lean();
      await writeAudit(req, {
        action: 'tenant.update',
        entityType: 'Tenant',
        entityId: before._id,
        before,
        after,
      });
      res.json({ success: true, data: serializeTenant(after!) });
    }),
  );
}
