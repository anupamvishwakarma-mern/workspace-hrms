import type { Router } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { Department } from '../../database/models/department.model';
import { Employee } from '../../database/models/employee.model';
import { authenticate, requirePermission, resolveTenant } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/errors';
import { rethrowDuplicate } from '../../utils/mongo';
import { route } from '../../utils/route';
import { idParams, objectId, paginationQuery, validate } from '../../utils/validate';
import { writeAudit } from '../audit/audit.service';

const createBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(1000).optional(),
    headEmployeeId: objectId.optional(),
  })
  .strict();
const patchBody = createBody
  .partial()
  .extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() })
  .strict();
const listQuery = z
  .object({ ...paginationQuery, status: z.enum(['ACTIVE', 'INACTIVE']).optional() })
  .strict();

const ser = (d: Record<string, unknown> & { _id: unknown }) => ({
  id: String(d._id),
  name: d.name,
  description: d.description,
  headEmployeeId: d.headEmployeeId ? String(d.headEmployeeId) : undefined,
  status: d.status,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});

async function assertHeadInTenant(tenantId: unknown, headId?: string) {
  if (headId && !(await Employee.exists({ _id: headId, tenantId })))
    throw AppError.badRequest('headEmployeeId does not reference an employee in this company');
}

export function registerDepartmentRoutes(v1: Router, env: Env): void {
  const chain = [authenticate(env), resolveTenant];

  route(
    v1,
    {
      method: 'get',
      path: '/departments',
      summary: 'List departments.',
      tags: ['Departments'],
      auth: 'tenant',
      permission: 'department:read',
      query: listQuery,
    },
    ...chain,
    requirePermission('department:read'),
    validate({ query: listQuery }),
    asyncHandler(async (req, res) => {
      const q = req.query as unknown as z.infer<typeof listQuery>;
      const filter = {
        tenantId: req.tenantCtx!.tenantId,
        ...(q.status ? { status: q.status } : {}),
      };
      const [items, total] = await Promise.all([
        Department.find(filter)
          .sort({ name: 1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
        Department.countDocuments(filter),
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
      path: '/departments',
      summary: 'Create a department.',
      tags: ['Departments'],
      auth: 'tenant',
      permission: 'department:manage',
      body: createBody,
      successStatus: 201,
    },
    ...chain,
    requirePermission('department:manage'),
    validate({ body: createBody }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      await assertHeadInTenant(tenantId, req.body.headEmployeeId);
      const doc = await Department.create({ ...req.body, tenantId }).catch((e) =>
        rethrowDuplicate(e, 'A department with this name already exists'),
      );
      await writeAudit(req, {
        action: 'department.create',
        entityType: 'Department',
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
      path: '/departments/:id',
      summary: 'Update a department.',
      tags: ['Departments'],
      auth: 'tenant',
      permission: 'department:manage',
      body: patchBody,
    },
    ...chain,
    requirePermission('department:manage'),
    validate({ params: idParams, body: patchBody }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      const before = await Department.findOne({ _id: req.params.id, tenantId }).lean();
      if (!before) throw AppError.notFound('Department not found');
      await assertHeadInTenant(tenantId, req.body.headEmployeeId);
      const after = await Department.findOneAndUpdate(
        { _id: before._id, tenantId },
        { $set: req.body },
        { new: true },
      )
        .lean()
        .catch((e) => rethrowDuplicate(e, 'A department with this name already exists'));
      await writeAudit(req, {
        action: 'department.update',
        entityType: 'Department',
        entityId: before._id,
        before,
        after,
      });
      res.json({ success: true, data: ser(after!) });
    }),
  );
}
