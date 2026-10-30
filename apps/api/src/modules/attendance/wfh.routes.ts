import type { Router } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { Employee } from '../../database/models/employee.model';
import { WFH_STATUSES, WfhRequest } from '../../database/models/wfhRequest.model';
import { authenticate, requirePermission, resolveTenant } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import type { Clock } from '../../utils/clock';
import { AppError } from '../../utils/errors';
import { route } from '../../utils/route';
import { idParams, paginationQuery, validate } from '../../utils/validate';
import { writeAudit } from '../audit/audit.service';
import { hasPermission } from '../auth/permissions';
import { WORK_DATE_RE, isRealDate } from './dates';
import { applyForWfh, cancelWfh } from './wfh.service';

const date = z.string().regex(WORK_DATE_RE, 'Use YYYY-MM-DD').refine(isRealDate, 'Invalid date');
const applyBody = z
  .object({ startDate: date, endDate: date, reason: z.string().trim().max(1000).optional() })
  .strict();
const listQuery = z
  .object({
    ...paginationQuery,
    scope: z.enum(['mine', 'all']).default('mine'),
    status: z.enum(WFH_STATUSES).optional(),
  })
  .strict();

const ser = (d: Record<string, any>, name?: string) => ({
  id: String(d._id),
  employeeId: String(d.employeeId),
  employeeName: name,
  startDate: d.startDate,
  endDate: d.endDate,
  reason: d.reason,
  status: d.status,
  decidedAt: d.decidedAt,
  decisionComment: d.decisionComment,
  createdAt: d.createdAt,
});

export function registerWfhRoutes(v1: Router, env: Env, deps: { clock: Clock }): void {
  const chain = [authenticate(env), resolveTenant];

  route(
    v1,
    { method: 'post', path: '/wfh/requests', summary: 'Ask to work from home on given days. Decided through the approval workflow (default: your manager, or the owner if you have none).', tags: ['Attendance'], auth: 'tenant', permission: 'wfh:request', body: applyBody, successStatus: 201 },
    ...chain,
    requirePermission('wfh:request'),
    validate({ body: applyBody }),
    asyncHandler(async (req, res) => {
      const doc = await applyForWfh(req.tenantCtx!, req.auth!.userId, req.body, deps.clock.now());
      await writeAudit(req, { action: 'wfh.requested', entityType: 'WfhRequest', entityId: doc._id, after: { startDate: doc.startDate, endDate: doc.endDate } });
      res.status(201).json({ success: true, data: ser(doc.toObject()) });
    }),
  );

  route(
    v1,
    { method: 'get', path: '/wfh/requests', summary: 'Your work-from-home requests (scope=all, for HR with company-wide attendance access, lists everyone).', tags: ['Attendance'], auth: 'tenant', permission: 'wfh:request', query: listQuery },
    ...chain,
    requirePermission('wfh:request'),
    validate({ query: listQuery }),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      const q = req.query as unknown as z.infer<typeof listQuery>;
      if (q.scope === 'all' && !hasPermission(ctx.roles, 'attendance:read:all')) throw AppError.forbidden();
      const filter: Record<string, unknown> = {
        tenantId: ctx.tenantId,
        ...(q.scope === 'mine' ? { employeeId: ctx.employeeId ?? null } : {}),
        ...(q.status ? { status: q.status } : {}),
      };
      const [items, total] = await Promise.all([
        WfhRequest.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
        WfhRequest.countDocuments(filter),
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
    { method: 'post', path: '/wfh/requests/:id/cancel', summary: 'Withdraw your request (approved days that have started cannot be withdrawn).', tags: ['Attendance'], auth: 'tenant', permission: 'wfh:request' },
    ...chain,
    requirePermission('wfh:request'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const doc = await cancelWfh(req.tenantCtx!, String(req.params.id), deps.clock.now());
      await writeAudit(req, { action: 'wfh.cancelled', entityType: 'WfhRequest', entityId: doc._id });
      res.json({ success: true, data: ser(doc) });
    }),
  );
}
