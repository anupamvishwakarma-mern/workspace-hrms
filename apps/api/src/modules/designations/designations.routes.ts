import type { Router } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { Designation } from '../../database/models/designation.model';
import { Employee } from '../../database/models/employee.model';
import { authenticate, requirePermission, resolveTenant } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/errors';
import { escapeRegex, idParams, paginationQuery, validate } from '../../utils/validate';
import { rethrowDuplicate } from '../../utils/mongo';
import { route } from '../../utils/route';
import { writeAudit } from '../audit/audit.service';

const STATUS = z.enum(['ACTIVE', 'INACTIVE']);
const createBody = z
  .object({
    title: z.string().trim().min(1).max(120),
    code: z.string().trim().min(1).max(20).optional(),
    level: z.number().int().min(0).max(100).optional(),
    description: z.string().max(1000).optional(),
  })
  .strict();
const patchBody = createBody
  .extend({ code: z.string().trim().min(1).max(20).nullable() })
  .partial()
  .extend({ status: STATUS.optional() })
  .strict();
const listQuery = z
  .object({
    ...paginationQuery,
    status: STATUS.optional(),
    search: z.string().trim().max(100).optional(),
  })
  .strict();

const ser = (d: Record<string, unknown> & { _id: unknown }) => ({
  id: String(d._id),
  title: d.title,
  code: d.code,
  level: d.level,
  description: d.description,
  status: d.status,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});
const DUP = 'A designation with this title or code already exists';

export function registerDesignationRoutes(v1: Router, env: Env): void {
  const chain = [authenticate(env), resolveTenant];

  route(
    v1,
    {
      method: 'get',
      path: '/designations',
      summary: 'List designations.',
      tags: ['Designations'],
      auth: 'tenant',
      permission: 'designation:read',
      query: listQuery,
    },
    ...chain,
    requirePermission('designation:read'),
    validate({ query: listQuery }),
    asyncHandler(async (req, res) => {
      const q = req.query as unknown as z.infer<typeof listQuery>;
      const filter: Record<string, unknown> = {
        tenantId: req.tenantCtx!.tenantId,
        ...(q.status ? { status: q.status } : {}),
        ...(q.search ? { title: new RegExp(escapeRegex(q.search), 'i') } : {}),
      };
      const [items, total] = await Promise.all([
        Designation.find(filter)
          .sort({ level: -1, title: 1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
        Designation.countDocuments(filter),
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
      path: '/designations',
      summary: 'Create a designation.',
      tags: ['Designations'],
      auth: 'tenant',
      permission: 'designation:manage',
      body: createBody,
      successStatus: 201,
    },
    ...chain,
    requirePermission('designation:manage'),
    validate({ body: createBody }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      const doc = await Designation.create({ ...req.body, tenantId }).catch((e) =>
        rethrowDuplicate(e, DUP),
      );
      await writeAudit(req, {
        action: 'designation.create',
        entityType: 'Designation',
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
      path: '/designations/:id',
      summary:
        'Update a designation. Renaming does not rewrite the title already stored on employees or issued letters.',
      tags: ['Designations'],
      auth: 'tenant',
      permission: 'designation:manage',
      body: patchBody,
    },
    ...chain,
    requirePermission('designation:manage'),
    validate({ params: idParams, body: patchBody }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      const before = await Designation.findOne({ _id: req.params.id, tenantId }).lean();
      if (!before) throw AppError.notFound('Designation not found');
      const { code, ...rest } = req.body as z.infer<typeof patchBody>;
      const update: Record<string, unknown> =
        code === null
          ? { $set: rest, $unset: { code: 1 } }
          : { $set: { ...rest, ...(code ? { code } : {}) } };
      const after = await Designation.findOneAndUpdate({ _id: before._id, tenantId }, update, {
        new: true,
      })
        .lean()
        .catch((e) => rethrowDuplicate(e, DUP));
      await writeAudit(req, {
        action: 'designation.update',
        entityType: 'Designation',
        entityId: before._id,
        before,
        after,
      });
      res.json({ success: true, data: ser(after!) });
    }),
  );

  route(
    v1,
    {
      method: 'delete',
      path: '/designations/:id',
      summary: 'Delete a designation that no employee uses (otherwise deactivate it).',
      tags: ['Designations'],
      auth: 'tenant',
      permission: 'designation:manage',
    },
    ...chain,
    requirePermission('designation:manage'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      const before = await Designation.findOne({ _id: req.params.id, tenantId }).lean();
      if (!before) throw AppError.notFound('Designation not found');
      if (await Employee.exists({ tenantId, designationId: before._id }))
        throw AppError.conflict('Designation is assigned to employees; deactivate it instead');
      await Designation.deleteOne({ _id: before._id, tenantId });
      await writeAudit(req, {
        action: 'designation.delete',
        entityType: 'Designation',
        entityId: before._id,
        before,
      });
      res.json({ success: true, data: { id: String(before._id) } });
    }),
  );
}
