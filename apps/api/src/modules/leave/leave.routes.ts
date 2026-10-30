import type { Router } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { Employee } from '../../database/models/employee.model';
import { LEAVE_STATUSES, LeaveRequest } from '../../database/models/leaveRequest.model';
import { LeaveType } from '../../database/models/leaveType.model';
import { authenticate, requirePermission, resolveTenant } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import type { Clock } from '../../utils/clock';
import { AppError } from '../../utils/errors';
import { rethrowDuplicate } from '../../utils/mongo';
import { route } from '../../utils/route';
import { idParams, objectId, paginationQuery, validate } from '../../utils/validate';
import { WORK_DATE_RE, isRealDate, localDate } from '../attendance/dates';
import { loadTenant } from '../attendance/attendance.service';
import { approvalScope, teamScope } from '../attendance/review.service';
import { writeAudit } from '../audit/audit.service';
import { notifyEmployee } from '../notifications/push.service';
import { hasPermission } from '../auth/permissions';
import * as svc from './leave.service';

const date = z.string().regex(WORK_DATE_RE, 'Use YYYY-MM-DD').refine(isRealDate, 'Invalid date');
const typeBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{1,20}$/, 'Letters, digits, - and _ only')
      .transform((s) => s.toUpperCase()),
    paid: z.boolean(),
    annualAllowanceDays: z.number().min(0).max(366).multipleOf(0.5),
    allowHalfDay: z.boolean(),
  })
  .strict();
const createType = typeBody.partial({ paid: true, annualAllowanceDays: true, allowHalfDay: true });
const patchType = typeBody
  .partial()
  .extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() })
  .strict();

const applyBody = z
  .object({
    leaveTypeId: objectId,
    startDate: date,
    endDate: date,
    halfDay: z.boolean().default(false),
    halfDaySession: z.enum(['FIRST', 'SECOND']).optional(),
    reason: z.string().trim().max(1000).optional(),
  })
  .strict();
const decisionBody = z.object({ comment: z.string().trim().max(1000).optional() }).strict();
const rejectBody = z.object({ comment: z.string().trim().min(3).max(1000) }).strict();
const listQuery = z
  .object({
    ...paginationQuery,
    scope: z.enum(['mine', 'review']).default('mine'),
    status: z.enum(LEAVE_STATUSES).optional(),
    employeeId: objectId.optional(),
    from: date.optional(),
    to: date.optional(),
  })
  .strict();
const balanceQuery = z
  .object({
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    employeeId: objectId.optional(),
  })
  .strict();

const serType = (t: Record<string, unknown> & { _id: unknown }) => ({
  id: String(t._id),
  name: t.name,
  code: t.code,
  paid: t.paid,
  annualAllowanceDays: t.annualAllowanceDays,
  allowHalfDay: t.allowHalfDay,
  status: t.status,
});

export function registerLeaveRoutes(v1: Router, env: Env, deps: { clock: Clock }): void {
  const chain = [authenticate(env), resolveTenant];

  route(
    v1,
    {
      method: 'get',
      path: '/leave-types',
      summary: 'List leave types.',
      tags: ['Leave'],
      auth: 'tenant',
      permission: 'leave:apply',
    },
    ...chain,
    requirePermission('leave:apply'),
    asyncHandler(async (req, res) => {
      const manage = hasPermission(req.tenantCtx!.roles, 'leave:manage');
      const items = await LeaveType.find({
        tenantId: req.tenantCtx!.tenantId,
        ...(manage ? {} : { status: 'ACTIVE' }),
      })
        .sort({ name: 1 })
        .lean();
      res.json({ success: true, data: items.map(serType) });
    }),
  );

  route(
    v1,
    {
      method: 'post',
      path: '/leave-types',
      summary: 'Create a leave type.',
      tags: ['Leave'],
      auth: 'tenant',
      permission: 'leave:manage',
      body: createType,
      successStatus: 201,
    },
    ...chain,
    requirePermission('leave:manage'),
    validate({ body: createType }),
    asyncHandler(async (req, res) => {
      const doc = await LeaveType.create({ ...req.body, tenantId: req.tenantCtx!.tenantId }).catch(
        (e) => rethrowDuplicate(e, 'A leave type with this name or code already exists'),
      );
      await writeAudit(req, {
        action: 'leave_type.create',
        entityType: 'LeaveType',
        entityId: doc._id,
        after: doc,
      });
      res.status(201).json({ success: true, data: serType(doc.toObject()) });
    }),
  );

  route(
    v1,
    {
      method: 'patch',
      path: '/leave-types/:id',
      summary: 'Update a leave type. Approved requests keep their charged days.',
      tags: ['Leave'],
      auth: 'tenant',
      permission: 'leave:manage',
      body: patchType,
    },
    ...chain,
    requirePermission('leave:manage'),
    validate({ params: idParams, body: patchType }),
    asyncHandler(async (req, res) => {
      const before = await LeaveType.findOne({
        _id: req.params.id,
        tenantId: req.tenantCtx!.tenantId,
      }).lean();
      if (!before) throw AppError.notFound('Leave type not found');
      const doc = await LeaveType.findOneAndUpdate(
        { _id: before._id, tenantId: req.tenantCtx!.tenantId },
        { $set: req.body },
        { new: true },
      )
        .lean()
        .catch((e) => rethrowDuplicate(e, 'A leave type with this name or code already exists'));
      await writeAudit(req, {
        action: 'leave_type.update',
        entityType: 'LeaveType',
        entityId: before._id,
        before,
        after: doc,
      });
      res.json({ success: true, data: serType(doc!) });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/leave/balances',
      summary: 'Leave balances for a year (own by default; others within your read scope).',
      tags: ['Leave'],
      auth: 'tenant',
      permission: 'leave:apply',
      query: balanceQuery,
    },
    ...chain,
    requirePermission('leave:apply'),
    validate({ query: balanceQuery }),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      const q = req.query as unknown as z.infer<typeof balanceQuery>;
      let target = ctx.employeeId;
      if (q.employeeId && String(q.employeeId) !== String(ctx.employeeId)) {
        const scope = await teamScope(ctx, 'leave:read:all', 'leave:read:team');
        if (scope && !scope.some((i) => String(i) === q.employeeId)) throw AppError.notFound();
        if (!(await Employee.exists({ _id: q.employeeId, tenantId: ctx.tenantId })))
          throw AppError.notFound();
        target = q.employeeId as never;
      }
      if (!target) throw AppError.forbidden('Your account has no employee record');
      const tenant = await loadTenant(ctx.tenantId);
      const year = q.year ?? Number(localDate(deps.clock.now(), tenant.timezone).slice(0, 4));
      res.json({ success: true, data: await svc.balancesFor(ctx.tenantId, target, year) });
    }),
  );

  route(
    v1,
    {
      method: 'post',
      path: '/leave/requests',
      summary: 'Apply for leave. Employee, tenant and requester come from the session.',
      tags: ['Leave'],
      auth: 'tenant',
      permission: 'leave:apply',
      body: applyBody,
      successStatus: 201,
    },
    ...chain,
    requirePermission('leave:apply'),
    validate({ body: applyBody }),
    asyncHandler(async (req, res) => {
      const doc = await svc.applyForLeave(
        req.tenantCtx!,
        req.auth!.userId,
        req.body,
        deps.clock.now(),
      );
      await writeAudit(req, {
        action: 'leave.requested',
        entityType: 'LeaveRequest',
        entityId: doc._id,
        after: {
          startDate: doc.startDate,
          endDate: doc.endDate,
          days: doc.days,
          employeeId: doc.employeeId,
        },
      });
      res
        .status(201)
        .json({ success: true, data: await serOne(doc.toObject(), req.tenantCtx!, true) });
    }),
  );

  async function serOne(
    r: Record<string, unknown> & { _id: unknown },
    ctx: NonNullable<Express.Request['tenantCtx']>,
    seeReason: boolean,
  ) {
    const [emp, type] = await Promise.all([
      Employee.findOne({ _id: r.employeeId, tenantId: ctx.tenantId })
        .select('employeeCode firstName lastName')
        .lean(),
      LeaveType.findOne({ _id: r.leaveTypeId, tenantId: ctx.tenantId }).select('name code').lean(),
    ]);
    return shape(r, emp, type, seeReason);
  }
  const shape = (
    r: Record<string, unknown> & { _id: unknown },
    emp:
      | { _id: unknown; employeeCode: string; firstName: string; lastName: string }
      | null
      | undefined,
    type: { name: string; code: string } | null | undefined,
    seeReason: boolean,
  ) => ({
    id: String(r._id),
    employeeId: String(r.employeeId),
    employee: emp
      ? {
          id: String(emp._id),
          employeeCode: emp.employeeCode,
          firstName: emp.firstName,
          lastName: emp.lastName,
        }
      : undefined,
    leaveTypeId: String(r.leaveTypeId),
    leaveType: type ? { name: type.name, code: type.code } : undefined,
    startDate: r.startDate,
    endDate: r.endDate,
    halfDay: r.halfDay,
    halfDaySession: r.halfDaySession,
    days: r.days,
    status: r.status,
    reason: seeReason ? r.reason : undefined,
    reviewComment: r.reviewComment,
    reviewedAt: r.reviewedAt,
    createdAt: r.createdAt,
  });

  route(
    v1,
    {
      method: 'get',
      path: '/leave/requests',
      summary:
        'List leave requests: your own (scope=mine) or those in your review/read scope (scope=review).',
      tags: ['Leave'],
      auth: 'tenant',
      permission: 'leave:apply',
      query: listQuery,
    },
    ...chain,
    requirePermission('leave:apply'),
    validate({ query: listQuery }),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      const q = req.query as unknown as z.infer<typeof listQuery>;
      const filter: Record<string, unknown> = { tenantId: ctx.tenantId };
      let seeAllReasons = true;
      if (q.scope === 'mine') {
        if (!ctx.employeeId) throw AppError.forbidden('Your account has no employee record');
        filter.employeeId = ctx.employeeId;
      } else {
        const reviewer =
          hasPermission(ctx.roles, 'leave:review:all') ||
          hasPermission(ctx.roles, 'leave:review:team');
        const all = !reviewer && hasPermission(ctx.roles, 'leave:read:all');
        if (!reviewer && !all) throw AppError.forbidden();
        // Payroll may read dates/types company-wide but not the private reason text.
        seeAllReasons = reviewer;
        // Reviewers see the requests they decide: their reports, plus unmanaged people for the owner.
        if (!all) filter.employeeId = { $in: await approvalScope(ctx) };
        if (q.employeeId) {
          const allowed = filter.employeeId as { $in: unknown[] } | undefined;
          if (allowed && !allowed.$in.some((i) => String(i) === q.employeeId))
            filter.employeeId = { $in: [] };
          else filter.employeeId = q.employeeId;
        }
      }
      if (q.status) filter.status = q.status;
      if (q.from) filter.endDate = { $gte: q.from };
      if (q.to) filter.startDate = { $lte: q.to };
      const [rows, total] = await Promise.all([
        LeaveRequest.find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
        LeaveRequest.countDocuments(filter),
      ]);
      const [emps, types] = await Promise.all([
        Employee.find({ tenantId: ctx.tenantId, _id: { $in: rows.map((r) => r.employeeId) } })
          .select('employeeCode firstName lastName')
          .lean(),
        LeaveType.find({ tenantId: ctx.tenantId, _id: { $in: rows.map((r) => r.leaveTypeId) } })
          .select('name code')
          .lean(),
      ]);
      const em = new Map(emps.map((e) => [String(e._id), e]));
      const ty = new Map(types.map((t) => [String(t._id), t]));
      res.json({
        success: true,
        data: rows.map((r) =>
          shape(
            r,
            em.get(String(r.employeeId)),
            ty.get(String(r.leaveTypeId)),
            q.scope === 'mine' || seeAllReasons,
          ),
        ),
        meta: { page: q.page, limit: q.limit, total },
      });
    }),
  );

  for (const [action, body, decision] of [
    ['approve', decisionBody, 'APPROVED'],
    ['reject', rejectBody, 'REJECTED'],
  ] as const) {
    route(
      v1,
      {
        method: 'post',
        path: `/leave/requests/:id/${action}`,
        summary: `${action === 'approve' ? 'Approve' : 'Reject'} a leave request (not your own).`,
        tags: ['Leave'],
        auth: 'tenant',
        permission: 'leave:review:all | leave:review:team',
        body,
      },
      ...chain,
      requirePermission('leave:review:all', 'leave:review:team'),
      validate({ params: idParams, body }),
      asyncHandler(async (req, res) => {
        const doc = await svc.reviewLeave(
          req.tenantCtx!,
          req.auth!.userId,
          String(req.params.id),
          decision,
          req.body.comment,
          deps.clock.now(),
        );
        await writeAudit(req, {
          action: `leave.${action}d`,
          entityType: 'LeaveRequest',
          entityId: doc._id,
          reason: req.body.comment,
          after: { status: doc.status, employeeId: doc.employeeId },
        });
        notifyEmployee(env, req.tenantCtx!.tenantId, doc.employeeId, {
          title: `Leave ${decision === 'APPROVED' ? 'approved' : 'rejected'}`,
          body: `Your leave request for ${doc.startDate}${doc.endDate !== doc.startDate ? ` to ${doc.endDate}` : ''} was ${decision.toLowerCase()}.`,
          data: { type: 'leave', id: String(doc._id) },
        });
        res.json({ success: true, data: await serOne(doc, req.tenantCtx!, true) });
      }),
    );
  }

  route(
    v1,
    {
      method: 'post',
      path: '/leave/requests/:id/cancel',
      summary:
        'Cancel your own request (HR can cancel any). Cancelling approved leave restores attendance calculation.',
      tags: ['Leave'],
      auth: 'tenant',
      permission: 'leave:apply',
      body: decisionBody,
    },
    ...chain,
    requirePermission('leave:apply'),
    validate({ params: idParams, body: decisionBody }),
    asyncHandler(async (req, res) => {
      const { before, after } = await svc.cancelLeave(
        req.tenantCtx!,
        req.auth!.userId,
        String(req.params.id),
        deps.clock.now(),
      );
      await writeAudit(req, {
        action: 'leave.cancelled',
        entityType: 'LeaveRequest',
        entityId: after._id,
        before: { status: before },
        after: { status: after.status, employeeId: after.employeeId },
      });
      res.json({ success: true, data: await serOne(after, req.tenantCtx!, true) });
    }),
  );
}
