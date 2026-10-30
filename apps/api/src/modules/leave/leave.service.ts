import type { Request } from 'express';
import type { Types } from 'mongoose';
import { DateTime } from 'luxon';
import { isApproverFor } from '../attendance/review.service';
import { Employee } from '../../database/models/employee.model';
import { LeaveRequest } from '../../database/models/leaveRequest.model';
import { LeaveType } from '../../database/models/leaveType.model';
import { AppError } from '../../utils/errors';
import { hasPermission } from '../auth/permissions';
import {
  holidayOn,
  loadTenant,
  recalculateDay,
  withEmployeeTransaction,
  type TenantInfo,
} from '../attendance/attendance.service';
import { addDays, dayOfWeek, localDate } from '../attendance/dates';
import { shiftForDate } from '../shifts/shifts.service';
import { breakdownFor, isCapped } from './ledger.service';
import { ApprovalRequest } from '../../database/models/approvalRequest.model';
import { ApprovalWorkflow } from '../../database/models/approvalWorkflow.model';
import { decide, registerHooks, submitRequest } from '../approvals/approvals.service';

type Ctx = NonNullable<Request['tenantCtx']>;
export const MAX_LEAVE_SPAN_DAYS = 60;
const MAX_PAST_DAYS = 30;
const MAX_FUTURE_DAYS = 400;

export interface ApplyInput {
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  halfDay: boolean;
  halfDaySession?: 'FIRST' | 'SECOND';
  reason?: string;
}

/** Working days an employee would lose: weekly offs (per shift, else company week) and holidays are free. */
export async function chargeableDays(
  tenant: TenantInfo,
  employeeId: Types.ObjectId,
  locationIds: Types.ObjectId[],
  start: string,
  end: string,
  halfDay: boolean,
): Promise<number> {
  let n = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const shift = await shiftForDate(tenant._id, employeeId, d);
    const weeklyOff = shift
      ? (shift.weeklyOffDays as number[]).includes(dayOfWeek(d))
      : !tenant.workweek.includes(dayOfWeek(d));
    if (weeklyOff) continue;
    if (await holidayOn(tenant._id, d, locationIds)) continue;
    n += 1;
  }
  return halfDay ? n * 0.5 : n;
}

const yearOf = (d: string) => Number(d.slice(0, 4));

async function usedDays(
  tenantId: Types.ObjectId,
  employeeId: Types.ObjectId,
  leaveTypeId: Types.ObjectId,
  year: number,
  statuses: string[],
  excludeId?: Types.ObjectId,
): Promise<number> {
  const rows = await LeaveRequest.find({
    tenantId,
    employeeId,
    leaveTypeId,
    status: { $in: statuses },
    startDate: { $gte: `${year}-01-01`, $lte: `${year}-12-31` },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  })
    .select('days')
    .lean();
  return rows.reduce((a, r) => a + r.days, 0);
}

export async function balancesFor(
  tenantId: Types.ObjectId,
  employeeId: Types.ObjectId,
  year: number,
) {
  const types = await LeaveType.find({ tenantId, status: 'ACTIVE' }).sort({ name: 1 }).lean();
  return Promise.all(
    types.map(async (t) => {
      const [approved, pending] = await Promise.all([
        usedDays(tenantId, employeeId, t._id, year, ['APPROVED']),
        usedDays(tenantId, employeeId, t._id, year, ['PENDING']),
      ]);
      const capped = isCapped(t);
      const bd = await breakdownFor(tenantId, employeeId, t, year);
      return {
        leaveTypeId: String(t._id),
        name: t.name,
        code: t.code,
        paid: t.paid,
        year,
        accrualMode: t.accrualMode ?? 'ANNUAL',
        allowanceDays: capped ? bd.total : null,
        entitlement: capped ? bd : null,
        approvedDays: approved,
        pendingDays: pending,
        remainingDays: capped ? bd.total - approved - pending : null,
      };
    }),
  );
}

export async function applyForLeave(
  ctx: Ctx,
  actorUserId: Types.ObjectId,
  input: ApplyInput,
  now: Date,
) {
  if (!ctx.employeeId) throw AppError.forbidden('Your account has no employee record');
  const tenant = await loadTenant(ctx.tenantId);
  const employeeId = ctx.employeeId;
  const type = await LeaveType.findOne({ _id: input.leaveTypeId, tenantId: ctx.tenantId }).lean();
  if (!type || type.status !== 'ACTIVE')
    throw AppError.badRequest('Unknown or inactive leave type');
  if (input.endDate < input.startDate) throw AppError.badRequest('endDate is before startDate');
  if (yearOf(input.startDate) !== yearOf(input.endDate))
    throw AppError.badRequest('A request cannot span two calendar years; submit one per year');
  if (input.halfDay) {
    if (!type.allowHalfDay) throw AppError.badRequest('This leave type does not allow half days');
    if (input.startDate !== input.endDate)
      throw AppError.badRequest('Half-day leave must be a single day');
  }
  const today = localDate(now, tenant.timezone);
  if (input.startDate < addDays(today, -MAX_PAST_DAYS))
    throw AppError.badRequest(`Leave can be requested at most ${MAX_PAST_DAYS} days in the past`);
  if (input.startDate > addDays(today, MAX_FUTURE_DAYS))
    throw AppError.badRequest('Start date is too far in the future');
  const span =
    DateTime.fromISO(input.endDate).diff(DateTime.fromISO(input.startDate), 'days').days + 1;
  if (span > MAX_LEAVE_SPAN_DAYS)
    throw AppError.badRequest(`A request can cover at most ${MAX_LEAVE_SPAN_DAYS} days`);

  const emp = await Employee.findOne({ _id: employeeId, tenantId: ctx.tenantId })
    .select('workLocationIds joiningDate employmentStatus')
    .lean();
  if (!emp) throw AppError.notFound('Employee not found');
  if (emp.employmentStatus === 'TERMINATED') throw AppError.forbidden();

  const days = await chargeableDays(
    tenant,
    employeeId,
    emp.workLocationIds ?? [],
    input.startDate,
    input.endDate,
    input.halfDay,
  );
  if (days === 0)
    throw AppError.unprocessable(
      'The selected dates contain no working days (weekly offs and holidays are free)',
    );

  const created = await withEmployeeTransaction(ctx.tenantId, employeeId, async (session) => {
    const clash = await LeaveRequest.exists({
      tenantId: ctx.tenantId,
      employeeId,
      status: { $in: ['PENDING', 'APPROVED'] },
      startDate: { $lte: input.endDate },
      endDate: { $gte: input.startDate },
    }).session(session);
    if (clash)
      throw AppError.conflict('You already have a pending or approved request for these dates');
    if (isCapped(type)) {
      const [used, bd] = await Promise.all([
        usedDays(ctx.tenantId, employeeId, type._id, yearOf(input.startDate), ['PENDING', 'APPROVED']),
        breakdownFor(ctx.tenantId, employeeId, type, yearOf(input.startDate)),
      ]);
      if (used + days > bd.total)
        throw AppError.unprocessable(
          `Insufficient ${type.name} balance: ${bd.total - used} day(s) left, ${days} requested`,
        );
    }
    const [doc] = await LeaveRequest.create(
      [
        {
          tenantId: ctx.tenantId,
          employeeId,
          leaveTypeId: type._id,
          requestedBy: actorUserId,
          startDate: input.startDate,
          endDate: input.endDate,
          halfDay: input.halfDay,
          halfDaySession: input.halfDay ? input.halfDaySession : undefined,
          days,
          reason: input.reason,
        },
      ],
      { session },
    );
    return doc!;
  });
  return routeThroughWorkflow(ctx, actorUserId, created, type.name);
}

/**
 * When the company has an active LEAVE workflow, its chain decides the request. Otherwise the
 * built-in rule (manager, or owner when unmanaged) applies unchanged.
 */
async function routeThroughWorkflow<T extends { _id: Types.ObjectId; startDate: string; endDate: string; days: number; halfDay?: boolean | null }>(
  ctx: Ctx,
  actorUserId: Types.ObjectId,
  doc: T,
  typeName: string,
): Promise<T> {
  const wf = await ApprovalWorkflow.exists({ tenantId: ctx.tenantId, requestType: 'LEAVE', status: 'ACTIVE' });
  if (!wf) return doc;
  try {
    const ar = await submitRequest(
      { tenantId: ctx.tenantId, userId: actorUserId, employeeId: ctx.employeeId },
      {
        requestType: 'LEAVE',
        title: `${typeName}: ${doc.startDate} to ${doc.endDate}`,
        // The reason is deliberately not copied: approvers see it on the leave request itself.
        details: { leaveType: typeName, startDate: doc.startDate, endDate: doc.endDate, days: doc.days, halfDay: !!doc.halfDay },
      },
    );
    await LeaveRequest.updateOne({ _id: doc._id, tenantId: ctx.tenantId }, { $set: { approvalRequestId: ar._id } });
    (doc as unknown as { approvalRequestId?: Types.ObjectId }).approvalRequestId = ar._id;
    return doc;
  } catch (e) {
    // No eligible approver (or any failure): do not leave an orphan request nobody can decide.
    await LeaveRequest.deleteOne({ _id: doc._id, tenantId: ctx.tenantId });
    throw e;
  }
}

/** Applies a finished approval to the leave request it belongs to (the same effects as a direct review). */
async function applyOutcome(
  tenantId: Types.ObjectId,
  approval: { _id: Types.ObjectId; status: string; steps: { comment?: string | null; actedAt?: Date | null }[] },
  actorUserId: Types.ObjectId,
  now: Date,
) {
  const leave = await LeaveRequest.findOne({ tenantId, approvalRequestId: approval._id }).lean();
  if (!leave) return;
  const status = approval.status as 'APPROVED' | 'REJECTED' | 'CANCELLED';
  const tenant = await loadTenant(tenantId);
  const comment = [...approval.steps].reverse().find((s) => s.comment)?.comment ?? undefined;
  await withEmployeeTransaction(tenantId, leave.employeeId, async (session) => {
    const flipped = await LeaveRequest.findOneAndUpdate(
      { _id: leave._id, tenantId, status: 'PENDING' },
      { $set: { status, reviewedBy: actorUserId, reviewedAt: now, reviewComment: comment } },
      { new: true, session },
    ).lean();
    if (flipped && status === 'APPROVED')
      await recalcRange(tenant, leave.employeeId, leave.startDate, leave.endDate, now, session);
  });
}

registerHooks('LEAVE', {
  async beforeFinalApprove(req) {
    const leave = await LeaveRequest.findOne({ tenantId: req.tenantId, approvalRequestId: req._id }).lean();
    if (!leave) return;
    const type = await LeaveType.findOne({ _id: leave.leaveTypeId, tenantId: req.tenantId }).lean();
    if (type && isCapped(type)) {
      const [used, bd] = await Promise.all([
        usedDays(req.tenantId, leave.employeeId, type._id, yearOf(leave.startDate), ['APPROVED'], leave._id),
        breakdownFor(req.tenantId, leave.employeeId, type, yearOf(leave.startDate)),
      ]);
      if (used + leave.days > bd.total)
        throw AppError.unprocessable('Approving this would exceed the annual allowance');
    }
  },
  async afterFinal(req, actor) {
    await applyOutcome(req.tenantId, req as never, actor.userId as Types.ObjectId, actor.now ?? new Date());
  },
});

async function recalcRange(
  tenant: TenantInfo,
  employeeId: Types.ObjectId,
  start: string,
  end: string,
  now: Date,
  session: Parameters<typeof recalculateDay>[4],
) {
  const today = localDate(now, tenant.timezone);
  for (let d = start; d <= end && d <= today; d = addDays(d, 1))
    await recalculateDay(tenant, employeeId, d, now, session);
}

export async function reviewLeave(
  ctx: Ctx,
  actorUserId: Types.ObjectId,
  id: string,
  decision: 'APPROVED' | 'REJECTED',
  comment: string | undefined,
  now: Date,
) {
  // Permission first: someone who may not review at all must not learn whether an id exists.
  const all = hasPermission(ctx.roles, 'leave:review:all');
  const team = hasPermission(ctx.roles, 'leave:review:team');
  if (!all && !team) throw AppError.forbidden();
  const tenant = await loadTenant(ctx.tenantId);
  const req = await LeaveRequest.findOne({ _id: id, tenantId: ctx.tenantId }).lean();
  if (!req) throw AppError.notFound('Leave request not found');
  const own =
    (ctx.employeeId && String(req.employeeId) === String(ctx.employeeId)) ||
    String(req.requestedBy) === String(actorUserId);
  if (own && !(tenant.settings.attendance.allowSelfApproval && all))
    throw AppError.forbidden('You cannot review your own request');
  if (req.approvalRequestId) {
    // Decided by the approval engine; its hooks apply the outcome to this request.
    await decide(
      { tenantId: ctx.tenantId, userId: actorUserId, employeeId: ctx.employeeId, now },
      req.approvalRequestId,
      decision === 'APPROVED' ? 'APPROVE' : 'REJECT',
      comment,
    );
    return (await LeaveRequest.findOne({ _id: req._id, tenantId: ctx.tenantId }).lean())!;
  }
  if (!(await isApproverFor(ctx, req.employeeId))) throw AppError.notFound();
  return withEmployeeTransaction(ctx.tenantId, req.employeeId, async (session) => {
    const flipped = await LeaveRequest.findOneAndUpdate(
      { _id: req._id, tenantId: ctx.tenantId, status: 'PENDING' },
      {
        $set: {
          status: decision,
          reviewedBy: actorUserId,
          reviewedAt: now,
          reviewComment: comment,
        },
      },
      { new: true, session },
    ).lean();
    if (!flipped) throw AppError.conflict('This request has already been decided');
    if (decision === 'APPROVED') {
      const type = await LeaveType.findOne({ _id: req.leaveTypeId, tenantId: ctx.tenantId })
        .session(session)
        .lean();
      if (type && isCapped(type)) {
        const [used, bd] = await Promise.all([
          usedDays(ctx.tenantId, req.employeeId, type._id, yearOf(req.startDate), ['APPROVED'], req._id),
          breakdownFor(ctx.tenantId, req.employeeId, type, yearOf(req.startDate)),
        ]);
        if (used + req.days > bd.total)
          throw AppError.unprocessable('Approving this would exceed the annual allowance');
      }
      await recalcRange(tenant, req.employeeId, req.startDate, req.endDate, now, session);
    }
    return flipped;
  });
}

/** Employees cancel their own pending/approved-and-not-started requests; HR may cancel any approved one. */
export async function cancelLeave(ctx: Ctx, actorUserId: Types.ObjectId, id: string, now: Date) {
  const tenant = await loadTenant(ctx.tenantId);
  const req = await LeaveRequest.findOne({ _id: id, tenantId: ctx.tenantId }).lean();
  if (!req) throw AppError.notFound('Leave request not found');
  const mine = ctx.employeeId && String(req.employeeId) === String(ctx.employeeId);
  const hr = hasPermission(ctx.roles, 'leave:review:all');
  if (!mine && !hr) throw AppError.notFound(); // do not reveal other people's requests
  const today = localDate(now, tenant.timezone);
  if (req.status === 'APPROVED' && !hr && req.startDate < today)
    throw AppError.conflict('Leave that has already started can only be cancelled by HR');
  return withEmployeeTransaction(ctx.tenantId, req.employeeId, async (session) => {
    const flipped = await LeaveRequest.findOneAndUpdate(
      { _id: req._id, tenantId: ctx.tenantId, status: { $in: ['PENDING', 'APPROVED'] } },
      { $set: { status: 'CANCELLED', reviewedBy: actorUserId, reviewedAt: now } },
      { new: true, session },
    ).lean();
    if (!flipped) throw AppError.conflict('This request can no longer be cancelled');
    if (req.approvalRequestId && req.status === 'PENDING')
      await ApprovalRequest.updateOne(
        { _id: req.approvalRequestId, tenantId: ctx.tenantId, status: 'PENDING' },
        { $set: { status: 'CANCELLED', decidedAt: now } },
      );
    if (req.status === 'APPROVED')
      await recalcRange(tenant, req.employeeId, req.startDate, req.endDate, now, session);
    return { before: req.status, after: flipped };
  });
}
