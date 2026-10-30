import type { Request } from 'express';
import type { Types } from 'mongoose';
import { DateTime } from 'luxon';
import { Employee } from '../../database/models/employee.model';
import { ApprovalRequest } from '../../database/models/approvalRequest.model';
import { WfhRequest } from '../../database/models/wfhRequest.model';
import { AppError } from '../../utils/errors';
import { ensureWorkflow, registerHooks, submitRequest } from '../approvals/approvals.service';
import { loadTenant } from './attendance.service';
import { addDays, localDate } from './dates';

type Ctx = NonNullable<Request['tenantCtx']>;
const MAX_SPAN_DAYS = 31;
const MAX_PAST_DAYS = 7;
const MAX_FUTURE_DAYS = 180;

export async function applyForWfh(
  ctx: Ctx,
  actorUserId: Types.ObjectId,
  input: { startDate: string; endDate: string; reason?: string },
  now: Date,
) {
  if (!ctx.employeeId) throw AppError.forbidden('Your account has no employee record');
  const tenant = await loadTenant(ctx.tenantId);
  const emp = await Employee.findOne({ _id: ctx.employeeId, tenantId: ctx.tenantId })
    .select('attendanceMode employmentStatus')
    .lean();
  if (!emp || !['ACTIVE', 'NOTICE_PERIOD'].includes(emp.employmentStatus)) throw AppError.forbidden();
  if (emp.attendanceMode === 'REMOTE')
    throw AppError.unprocessable('You already work remotely; no request is needed');
  if (input.endDate < input.startDate) throw AppError.badRequest('endDate is before startDate');
  const today = localDate(now, tenant.timezone);
  if (input.startDate < addDays(today, -MAX_PAST_DAYS))
    throw AppError.badRequest(`Work from home can be requested at most ${MAX_PAST_DAYS} days back`);
  if (input.startDate > addDays(today, MAX_FUTURE_DAYS)) throw AppError.badRequest('Start date is too far ahead');
  const span = DateTime.fromISO(input.endDate).diff(DateTime.fromISO(input.startDate), 'days').days + 1;
  if (span > MAX_SPAN_DAYS) throw AppError.badRequest(`A request can cover at most ${MAX_SPAN_DAYS} days`);
  if (
    await WfhRequest.exists({
      tenantId: ctx.tenantId,
      employeeId: ctx.employeeId,
      status: { $in: ['PENDING', 'APPROVED'] },
      startDate: { $lte: input.endDate },
      endDate: { $gte: input.startDate },
    })
  )
    throw AppError.conflict('You already have a pending or approved request for these dates');

  await ensureWorkflow(ctx.tenantId, 'WFH', 'Work from home');
  const doc = await WfhRequest.create({
    tenantId: ctx.tenantId,
    employeeId: ctx.employeeId,
    requestedBy: actorUserId,
    startDate: input.startDate,
    endDate: input.endDate,
    reason: input.reason,
  });
  try {
    const ar = await submitRequest(
      { tenantId: ctx.tenantId, userId: actorUserId, employeeId: ctx.employeeId },
      {
        requestType: 'WFH',
        title: `Work from home: ${input.startDate} to ${input.endDate}`,
        details: { startDate: input.startDate, endDate: input.endDate },
      },
    );
    doc.approvalRequestId = ar._id;
    await WfhRequest.updateOne({ _id: doc._id, tenantId: ctx.tenantId }, { $set: { approvalRequestId: ar._id } });
    return doc;
  } catch (e) {
    await WfhRequest.deleteOne({ _id: doc._id, tenantId: ctx.tenantId });
    throw e;
  }
}

/** Employee withdraws: pending always; approved only while it has not started. */
export async function cancelWfh(ctx: Ctx, id: string, now: Date) {
  const tenant = await loadTenant(ctx.tenantId);
  const today = localDate(now, tenant.timezone);
  const req = await WfhRequest.findOne({ _id: id, tenantId: ctx.tenantId, employeeId: ctx.employeeId ?? null }).lean();
  if (!req) throw AppError.notFound('Request not found');
  if (req.status === 'APPROVED' && req.startDate <= today)
    throw AppError.conflict('Approved days that have started cannot be withdrawn');
  const done = await WfhRequest.findOneAndUpdate(
    { _id: req._id, tenantId: ctx.tenantId, status: { $in: ['PENDING', 'APPROVED'] } },
    { $set: { status: 'CANCELLED', decidedAt: now } },
    { new: true },
  ).lean();
  if (!done) throw AppError.conflict('This request can no longer be withdrawn');
  if (req.status === 'PENDING' && req.approvalRequestId)
    await ApprovalRequest.updateOne(
      { _id: req.approvalRequestId, tenantId: ctx.tenantId, status: 'PENDING' },
      { $set: { status: 'CANCELLED', decidedAt: now } },
    );
  return done;
}

registerHooks('WFH', {
  async afterFinal(req, actor) {
    const status = req.status as 'APPROVED' | 'REJECTED' | 'CANCELLED';
    const comment = [...req.steps].reverse().find((s) => s.comment)?.comment ?? undefined;
    await WfhRequest.updateOne(
      { tenantId: req.tenantId, approvalRequestId: req._id, status: 'PENDING' },
      { $set: { status, decidedAt: actor.now ?? new Date(), decisionComment: comment } },
    );
  },
});
