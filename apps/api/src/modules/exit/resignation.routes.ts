import type { Router } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { Employee } from '../../database/models/employee.model';
import { RESIGNATION_STATUSES, Resignation } from '../../database/models/resignation.model';
import { authenticate, requirePermission, resolveTenant } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import type { Clock } from '../../utils/clock';
import { AppError } from '../../utils/errors';
import { route } from '../../utils/route';
import { idParams, paginationQuery, validate } from '../../utils/validate';
import { writeAudit } from '../audit/audit.service';
import { WORK_DATE_RE, isRealDate } from '../attendance/dates';
import { hasPermission } from '../auth/permissions';
import { cancelResignation, submitResignation } from './resignation.service';

const date = z.string().regex(WORK_DATE_RE, 'Use YYYY-MM-DD').refine(isRealDate, 'Invalid date');
const applyBody = z.object({ proposedLastDay: date, reason: z.string().trim().max(2000).optional() }).strict();
const listQuery = z
  .object({ ...paginationQuery, scope: z.enum(['mine', 'all']).default('mine'), status: z.enum(RESIGNATION_STATUSES).optional() })
  .strict();

const ser = (d: Record<string, any>, name?: string) => ({
  id: String(d._id),
  employeeId: String(d.employeeId),
  employeeName: name,
  proposedLastDay: d.proposedLastDay,
  reason: d.reason,
  status: d.status,
  decidedAt: d.decidedAt,
  decisionComment: d.decisionComment,
  applyError: d.applyError,
  createdAt: d.createdAt,
});

export function registerResignationRoutes(v1: Router, env: Env, deps: { clock: Clock }): void {
  const chain = [authenticate(env), resolveTenant];

  route(
    v1,
    { method: 'post', path: '/resignations', summary: 'Resign. Decided through the approval workflow (default: your manager, or the owner if you have none); approval starts your notice period.', tags: ['Exit'], auth: 'tenant', permission: 'exit:request', body: applyBody, successStatus: 201 },
    ...chain,
    requirePermission('exit:request'),
    validate({ body: applyBody }),
    asyncHandler(async (req, res) => {
      const doc = await submitResignation(req.tenantCtx!, req.auth!.userId, req.body, deps.clock.now());
      await writeAudit(req, { action: 'resignation.submitted', entityType: 'Resignation', entityId: doc._id, after: { proposedLastDay: doc.proposedLastDay } });
      res.status(201).json({ success: true, data: ser(doc.toObject()) });
    }),
  );

  route(
    v1,
    { method: 'get', path: '/resignations', summary: 'Your resignations (scope=all, for people who manage exits, lists everyone).', tags: ['Exit'], auth: 'tenant', permission: 'exit:request', query: listQuery },
    ...chain,
    requirePermission('exit:request'),
    validate({ query: listQuery }),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      const q = req.query as unknown as z.infer<typeof listQuery>;
      if (q.scope === 'all' && !hasPermission(ctx, 'exit:manage')) throw AppError.forbidden();
      const filter: Record<string, unknown> = {
        tenantId: ctx.tenantId,
        ...(q.scope === 'mine' ? { employeeId: ctx.employeeId ?? null } : {}),
        ...(q.status ? { status: q.status } : {}),
      };
      const [items, total] = await Promise.all([
        Resignation.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
        Resignation.countDocuments(filter),
      ]);
      const emps = await Employee.find({ tenantId: ctx.tenantId, _id: { $in: items.map((i) => i.employeeId) } })
        .select('firstName lastName')
        .lean();
      const names = new Map(emps.map((e) => [String(e._id), `${e.firstName} ${e.lastName}`]));
      res.json({ success: true, data: items.map((i) => ser(i, names.get(String(i.employeeId)))), meta: { page: q.page, limit: q.limit, total } });
    }),
  );

  route(
    v1,
    { method: 'post', path: '/resignations/:id/cancel', summary: 'Withdraw your resignation while it is still pending.', tags: ['Exit'], auth: 'tenant', permission: 'exit:request' },
    ...chain,
    requirePermission('exit:request'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const doc = await cancelResignation(req.tenantCtx!, String(req.params.id), deps.clock.now());
      await writeAudit(req, { action: 'resignation.cancelled', entityType: 'Resignation', entityId: doc._id });
      res.json({ success: true, data: ser(doc) });
    }),
  );
}
