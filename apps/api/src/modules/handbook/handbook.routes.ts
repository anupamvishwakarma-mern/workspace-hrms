import type { Request, Router } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { HandbookSection } from '../../database/models/handbookSection.model';
import { authenticate, requirePermission, resolveTenant } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import type { Clock } from '../../utils/clock';
import { AppError } from '../../utils/errors';
import { route } from '../../utils/route';
import { idParams, validate } from '../../utils/validate';
import { writeAudit } from '../audit/audit.service';
import { hasPermission } from '../auth/permissions';

const sectionBody = z
  .object({
    title: z.string().trim().min(2).max(150),
    body: z.string().trim().min(1).max(50000),
    order: z.number().int().min(0).max(10000).optional(),
    status: z.enum(['DRAFT', 'PUBLISHED']).optional(),
  })
  .strict();
const sectionPatch = sectionBody.partial().strict();
const listQuery = z.object({ includeDrafts: z.enum(['true', 'false']).optional() }).strict();

const ser = (s: Record<string, unknown> & { _id: unknown }) => ({
  id: String(s._id),
  title: s.title,
  body: s.body,
  order: s.order,
  status: s.status,
  updatedAt: s.updatedAt,
});

export function registerHandbookRoutes(v1: Router, env: Env, deps: { clock: Clock }): void {
  const chain = [authenticate(env), resolveTenant];

  route(
    v1,
    {
      method: 'get',
      path: '/handbook',
      summary:
        'Handbook sections in order. Everyone sees published sections; HR/owner can also ask for drafts.',
      tags: ['Handbook'],
      auth: 'tenant',
      permission: 'handbook:read',
      query: listQuery,
    },
    ...chain,
    requirePermission('handbook:read'),
    validate({ query: listQuery }),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      const q = req.query as unknown as z.infer<typeof listQuery>;
      const drafts = q.includeDrafts === 'true' && hasPermission(ctx, 'handbook:manage');
      const rows = await HandbookSection.find({
        tenantId: ctx.tenantId,
        ...(drafts ? {} : { status: 'PUBLISHED' }),
      })
        .sort({ order: 1, createdAt: 1 })
        .limit(300)
        .lean();
      res.json({ success: true, data: rows.map(ser) });
    }),
  );

  route(
    v1,
    {
      method: 'post',
      path: '/handbook',
      summary: 'Add a handbook section (starts as a draft unless status is PUBLISHED).',
      tags: ['Handbook'],
      auth: 'tenant',
      permission: 'handbook:manage',
      body: sectionBody,
      successStatus: 201,
    },
    ...chain,
    requirePermission('handbook:manage'),
    validate({ body: sectionBody }),
    asyncHandler(async (req, res) => {
      const b = req.body as z.infer<typeof sectionBody>;
      const s = await HandbookSection.create({
        ...b,
        tenantId: req.tenantCtx!.tenantId,
        updatedBy: req.auth!.userId,
        publishedAt: b.status === 'PUBLISHED' ? deps.clock.now() : undefined,
      });
      await writeAudit(req as Request, {
        action: 'handbook.created',
        entityType: 'HandbookSection',
        entityId: s._id,
      });
      res.status(201).json({ success: true, data: ser(s.toObject()) });
    }),
  );

  route(
    v1,
    {
      method: 'patch',
      path: '/handbook/:id',
      summary: 'Edit, reorder, publish or unpublish a section.',
      tags: ['Handbook'],
      auth: 'tenant',
      permission: 'handbook:manage',
      body: sectionPatch,
    },
    ...chain,
    requirePermission('handbook:manage'),
    validate({ params: idParams, body: sectionPatch }),
    asyncHandler(async (req, res) => {
      const b = req.body as z.infer<typeof sectionPatch>;
      const s = await HandbookSection.findOneAndUpdate(
        { _id: req.params.id, tenantId: req.tenantCtx!.tenantId },
        {
          $set: {
            ...b,
            updatedBy: req.auth!.userId,
            ...(b.status === 'PUBLISHED' ? { publishedAt: deps.clock.now() } : {}),
          },
        },
        { new: true },
      ).lean();
      if (!s) throw AppError.notFound('Section not found');
      await writeAudit(req as Request, {
        action: 'handbook.updated',
        entityType: 'HandbookSection',
        entityId: s._id,
        after: { status: s.status },
      });
      res.json({ success: true, data: ser(s) });
    }),
  );

  route(
    v1,
    {
      method: 'delete',
      path: '/handbook/:id',
      summary: 'Delete a section.',
      tags: ['Handbook'],
      auth: 'tenant',
      permission: 'handbook:manage',
      successStatus: 204,
    },
    ...chain,
    requirePermission('handbook:manage'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const r = await HandbookSection.deleteOne({
        _id: req.params.id,
        tenantId: req.tenantCtx!.tenantId,
      });
      if (r.deletedCount !== 1) throw AppError.notFound('Section not found');
      await writeAudit(req as Request, {
        action: 'handbook.deleted',
        entityType: 'HandbookSection',
        entityId: String(req.params.id),
      });
      res.status(204).end();
    }),
  );
}
