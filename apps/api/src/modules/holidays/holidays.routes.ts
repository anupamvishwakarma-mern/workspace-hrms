import type { Router } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { Holiday } from '../../database/models/holiday.model';
import { WorkLocation } from '../../database/models/workLocation.model';
import { authenticate, requirePermission, resolveTenant } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/errors';
import { route } from '../../utils/route';
import { idParams, objectId, paginationQuery, validate } from '../../utils/validate';
import { writeAudit } from '../audit/audit.service';
import { WORK_DATE_RE, isRealDate } from '../attendance/dates';

const date = z
  .string()
  .regex(WORK_DATE_RE, 'Use YYYY-MM-DD')
  .refine(isRealDate, 'Invalid calendar date');
const createBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    date,
    workLocationId: objectId.optional(),
    holidayType: z.enum(['PUBLIC', 'COMPANY', 'OPTIONAL']).default('PUBLIC'),
  })
  .strict();
const patchBody = createBody
  .partial()
  .extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() })
  .strict();
const listQuery = z
  .object({ ...paginationQuery, from: date.optional(), to: date.optional() })
  .strict();

const ser = (h: Record<string, unknown> & { _id: unknown }) => ({
  id: String(h._id),
  name: h.name,
  date: h.date,
  workLocationId: h.workLocationId ? String(h.workLocationId) : undefined,
  holidayType: h.holidayType,
  status: h.status,
});

export function registerHolidayRoutes(v1: Router, env: Env): void {
  const chain = [authenticate(env), resolveTenant];
  const checkLocation = async (tenantId: unknown, id?: string) => {
    if (id && !(await WorkLocation.exists({ _id: id, tenantId })))
      throw AppError.badRequest('workLocationId does not reference a location in this company');
  };

  route(
    v1,
    {
      method: 'get',
      path: '/holidays',
      summary: 'List holidays (optionally within a date range).',
      tags: ['Holidays'],
      auth: 'tenant',
      permission: 'holiday:read',
      query: listQuery,
    },
    ...chain,
    requirePermission('holiday:read'),
    validate({ query: listQuery }),
    asyncHandler(async (req, res) => {
      const q = req.query as unknown as z.infer<typeof listQuery>;
      const filter: Record<string, unknown> = {
        tenantId: req.tenantCtx!.tenantId,
        status: 'ACTIVE',
      };
      if (q.from || q.to)
        filter.date = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
      const [items, total] = await Promise.all([
        Holiday.find(filter)
          .sort({ date: 1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
        Holiday.countDocuments(filter),
      ]);
      res.json({
        success: true,
        data: items.map(ser),
        meta: { page: q.page, limit: q.limit, total },
      });
    }),
  );

  route(
    v1,
    {
      method: 'post',
      path: '/holidays',
      summary: 'Create a holiday.',
      tags: ['Holidays'],
      auth: 'tenant',
      permission: 'holiday:manage',
      body: createBody,
      successStatus: 201,
    },
    ...chain,
    requirePermission('holiday:manage'),
    validate({ body: createBody }),
    asyncHandler(async (req, res) => {
      await checkLocation(req.tenantCtx!.tenantId, req.body.workLocationId);
      const doc = await Holiday.create({ ...req.body, tenantId: req.tenantCtx!.tenantId });
      await writeAudit(req, {
        action: 'holiday.create',
        entityType: 'Holiday',
        entityId: doc._id,
        after: doc,
      });
      res.status(201).json({ success: true, data: ser(doc.toObject()) });
    }),
  );

  route(
    v1,
    {
      method: 'patch',
      path: '/holidays/:id',
      summary: 'Update or deactivate a holiday.',
      tags: ['Holidays'],
      auth: 'tenant',
      permission: 'holiday:manage',
      body: patchBody,
    },
    ...chain,
    requirePermission('holiday:manage'),
    validate({ params: idParams, body: patchBody }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      const before = await Holiday.findOne({ _id: req.params.id, tenantId }).lean();
      if (!before) throw AppError.notFound('Holiday not found');
      await checkLocation(tenantId, req.body.workLocationId);
      const after = await Holiday.findOneAndUpdate(
        { _id: before._id, tenantId },
        { $set: req.body },
        { new: true },
      ).lean();
      await writeAudit(req, {
        action: 'holiday.update',
        entityType: 'Holiday',
        entityId: before._id,
        before,
        after,
      });
      res.json({ success: true, data: ser(after!) });
    }),
  );
}
