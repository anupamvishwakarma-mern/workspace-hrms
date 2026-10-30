import type { Router } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { ENDED_STATUSES, Employee } from '../../database/models/employee.model';
import { Tenant } from '../../database/models/tenant.model';
import { User } from '../../database/models/user.model';
import { authenticate, requirePlatformAdmin } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/errors';
import { route } from '../../utils/route';
import { idParams, paginationQuery, validate } from '../../utils/validate';
import { writeAudit } from '../audit/audit.service';
import { runInTenantDb } from '../../database/tenantContext';
import { runInTenant } from '../../database/tenantDb';
import { MAX_MEMBERS, onboardBody, provisionTenant } from '../tenants/provisioning';
import { serializeTenant } from '../tenants/tenants.routes';
import { MODULES, MODULE_DEPENDENCIES, MODULE_KEYS, checkModuleSet, enabledModules } from '../tenants/modules';

const moduleList = z.array(z.enum(MODULE_KEYS as [string, ...string[]])).max(MODULE_KEYS.length);
const modulesBody = z
  .object({ modules: moduleList, reason: z.string().trim().min(3).max(500) })
  .strict();
const createBody = onboardBody
  .extend({
    maxEmployees: z.number().int().min(1).max(MAX_MEMBERS).optional(),
    modules: moduleList.optional(),
  })
  .strict();
const seatsBody = z
  .object({ maxEmployees: z.number().int().min(1).max(MAX_MEMBERS) })
  .strict();
const statusBody = z
  .object({
    status: z.enum(['ACTIVE', 'SUSPENDED', 'CLOSED']),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
const listQuery = z
  .object({ ...paginationQuery, status: z.enum(['ACTIVE', 'SUSPENDED', 'CLOSED']).optional() })
  .strict();

/**
 * Platform (SaaS operator) endpoints. By design they expose tenant metadata and counts only -
 * a platform admin has no tenant membership and therefore cannot read employee records.
 */
export function registerPlatformRoutes(v1: Router, env: Env): void {
  const chain = [authenticate(env), requirePlatformAdmin];

  route(
    v1,
    {
      method: 'post',
      path: '/platform/tenants',
      summary: 'Onboard a company and invite its first owner.',
      tags: ['Platform'],
      auth: 'platform',
      body: createBody,
      successStatus: 201,
    },
    ...chain,
    validate({ body: createBody }),
    asyncHandler(async (req, res) => {
      const { modules, ...onboard } = req.body as z.infer<typeof createBody>;
      if (modules) {
        const bad = checkModuleSet(modules);
        if (bad) throw AppError.unprocessable(bad);
      }
      const out = await provisionTenant(env, onboard as never, { createdByUserId: req.auth!.userId });
      if (modules) await Tenant.updateOne({ _id: out.tenantId }, { $set: { modules: [...new Set(modules)] } });
      const tenant = await Tenant.findById(out.tenantId).lean();
      await runInTenantDb(out.dbName, () =>
        writeAudit(req, {
          action: 'platform.tenant_create',
          entityType: 'Tenant',
          entityId: out.tenantId,
          tenantId: out.tenantId,
          after: tenant,
        }),
      );
      res.status(201).json({ success: true, data: serializeTenant(tenant!) });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/platform/tenants',
      summary: 'List companies (metadata only).',
      tags: ['Platform'],
      auth: 'platform',
      query: listQuery,
    },
    ...chain,
    validate({ query: listQuery }),
    asyncHandler(async (req, res) => {
      const q = req.query as unknown as z.infer<typeof listQuery>;
      const filter = q.status ? { status: q.status } : {};
      const [items, total] = await Promise.all([
        Tenant.find(filter)
          .sort({ createdAt: -1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
        Tenant.countDocuments(filter),
      ]);
      res.json({
        success: true,
        data: items.map(serializeTenant),
        meta: { page: q.page, limit: q.limit, total },
      });
    }),
  );

  route(
    v1,
    {
      method: 'patch',
      path: '/platform/tenants/:id/status',
      summary: 'Activate, suspend or close a company.',
      tags: ['Platform'],
      auth: 'platform',
      body: statusBody,
    },
    ...chain,
    validate({ params: idParams, body: statusBody }),
    asyncHandler(async (req, res) => {
      const before = await Tenant.findById(req.params.id).lean();
      if (!before) throw AppError.notFound('Company not found');
      const after = await Tenant.findByIdAndUpdate(
        before._id,
        { $set: { status: req.body.status } },
        { new: true },
      ).lean();
      await writeAudit(req, {
        action: 'platform.tenant_status',
        entityType: 'Tenant',
        entityId: before._id,
        tenantId: before._id,
        before: { status: before.status },
        after: { status: req.body.status },
        reason: req.body.reason,
      });
      res.json({ success: true, data: serializeTenant(after!) });
    }),
  );

  route(
    v1,
    {
      method: 'patch',
      path: '/platform/tenants/:id/seats',
      summary: 'Change a company\'s member limit. Cannot go below its current headcount.',
      tags: ['Platform'],
      auth: 'platform',
      body: seatsBody,
    },
    ...chain,
    validate({ params: idParams, body: seatsBody }),
    asyncHandler(async (req, res) => {
      const before = await Tenant.findById(req.params.id).lean();
      if (!before) throw AppError.notFound('Company not found');
      const { maxEmployees } = req.body as z.infer<typeof seatsBody>;
      const used = await runInTenant(before._id, () =>
        Employee.countDocuments({
          tenantId: before._id,
          employmentStatus: { $nin: ENDED_STATUSES },
        }),
      );
      if (maxEmployees < used)
        throw AppError.conflict(`This company already has ${used} members; the limit cannot be lower.`);
      const after = await Tenant.findByIdAndUpdate(
        before._id,
        { $set: { maxEmployees } },
        { new: true },
      ).lean();
      await runInTenantDb(before.dbName ?? undefined, () =>
        writeAudit(req, {
          action: 'platform.tenant_seats',
          entityType: 'Tenant',
          entityId: before._id,
          tenantId: before._id,
          before: { maxEmployees: before.maxEmployees },
          after: { maxEmployees },
        }),
      );
      res.json({ success: true, data: serializeTenant(after!) });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/platform/modules',
      summary: 'The optional modules a company can be given, with their dependencies.',
      tags: ['Platform'],
      auth: 'platform',
    },
    ...chain,
    asyncHandler(async (_req, res) => {
      res.json({
        success: true,
        data: MODULE_KEYS.map((k) => ({
          key: k,
          label: MODULES[k].label,
          description: MODULES[k].description,
          requires: MODULE_DEPENDENCIES[k] ?? [],
        })),
      });
    }),
  );

  route(
    v1,
    {
      method: 'patch',
      path: '/platform/tenants/:id/modules',
      summary:
        'Choose which optional modules a company may use. Switched-off modules are refused by the API (403 MODULE_NOT_ENABLED) and hidden in the apps; their data is kept and returns when switched back on.',
      tags: ['Platform'],
      auth: 'platform',
      body: modulesBody,
    },
    ...chain,
    validate({ params: idParams, body: modulesBody }),
    asyncHandler(async (req, res) => {
      const before = await Tenant.findById(req.params.id).lean();
      if (!before) throw AppError.notFound('Company not found');
      const { modules, reason } = req.body as z.infer<typeof modulesBody>;
      const next = [...new Set(modules)];
      const bad = checkModuleSet(next);
      if (bad) throw AppError.unprocessable(bad);
      const after = await Tenant.findByIdAndUpdate(before._id, { $set: { modules: next } }, { new: true }).lean();
      await runInTenantDb(before.dbName ?? undefined, () =>
        writeAudit(req, {
          action: 'platform.tenant_modules',
          entityType: 'Tenant',
          entityId: before._id,
          tenantId: before._id,
          before: { modules: enabledModules(before.modules as string[] | undefined) },
          after: { modules: next },
          reason,
        }),
      );
      res.json({ success: true, data: serializeTenant(after!) });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/platform/metrics',
      summary: 'Platform-level operational counts (no tenant business data).',
      tags: ['Platform'],
      auth: 'platform',
    },
    ...chain,
    asyncHandler(async (_req, res) => {
      const [byStatus, users] = await Promise.all([
        Tenant.aggregate<{ _id: string; count: number }>([
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        User.countDocuments({ status: 'ACTIVE' }),
      ]);
      res.json({
        success: true,
        data: {
          tenantsByStatus: Object.fromEntries(byStatus.map((b) => [b._id, b.count])),
          activeUsers: users,
        },
      });
    }),
  );
}
