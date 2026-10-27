import type { Router } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { AuditLog } from '../../database/models/auditLog.model';
import { User } from '../../database/models/user.model';
import { authenticate, requirePermission, resolveTenant } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { route } from '../../utils/route';
import { objectId, paginationQuery, validate } from '../../utils/validate';

const dateTime = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid date')
  .transform((s) => new Date(s));
const listQuery = z
  .object({
    ...paginationQuery,
    action: z.string().trim().min(1).max(100).optional(),
    entityType: z.string().trim().min(1).max(60).optional(),
    entityId: z.string().trim().min(1).max(64).optional(),
    actorUserId: objectId.optional(),
    from: dateTime.optional(),
    to: dateTime.optional(),
  })
  .strict();

export function registerAuditRoutes(v1: Router, env: Env): void {
  const chain = [authenticate(env), resolveTenant];
  route(
    v1,
    {
      method: 'get',
      path: '/audit-logs',
      summary:
        "Read the company's audit trail (newest first). Append-only; never includes secrets.",
      tags: ['Audit'],
      auth: 'tenant',
      permission: 'audit:read',
      query: listQuery,
    },
    ...chain,
    requirePermission('audit:read'),
    validate({ query: listQuery }),
    asyncHandler(async (req, res) => {
      const q = req.query as unknown as z.infer<typeof listQuery>;
      const filter: Record<string, unknown> = { tenantId: req.tenantCtx!.tenantId };
      if (q.action) filter.action = q.action;
      if (q.entityType) filter.entityType = q.entityType;
      if (q.entityId) filter.entityId = q.entityId;
      if (q.actorUserId) filter.actorUserId = q.actorUserId;
      if (q.from || q.to)
        filter.createdAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
      const [rows, total] = await Promise.all([
        AuditLog.find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
        AuditLog.countDocuments(filter),
      ]);
      const actorIds = [...new Set(rows.map((r) => String(r.actorUserId ?? '')).filter(Boolean))];
      const users = actorIds.length
        ? await User.find({ _id: { $in: actorIds } })
            .select('email')
            .lean()
        : [];
      const email = new Map(users.map((u) => [String(u._id), u.email]));
      res.json({
        success: true,
        data: rows.map((r) => ({
          id: String(r._id),
          createdAt: r.createdAt,
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          actorUserId: r.actorUserId ? String(r.actorUserId) : undefined,
          actorEmail: r.actorUserId ? email.get(String(r.actorUserId)) : undefined,
          reason: r.reason,
          before: r.sanitizedBefore,
          after: r.sanitizedAfter,
          requestId: r.requestId,
        })),
        meta: { page: q.page, limit: q.limit, total },
      });
    }),
  );
}
