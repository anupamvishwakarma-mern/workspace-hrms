import type { Request } from 'express';
import type { Types } from 'mongoose';
import { ApprovalRequest } from '../../database/models/approvalRequest.model';
import { Employee } from '../../database/models/employee.model';
import { Resignation } from '../../database/models/resignation.model';
import { AppError } from '../../utils/errors';
import { ensureWorkflow, registerHooks, submitRequest } from '../approvals/approvals.service';
import { loadTenant } from '../attendance/attendance.service';
import { addDays, localDate } from '../attendance/dates';
import { startNoticePeriod } from '../employees/employees.service';

type Ctx = NonNullable<Request['tenantCtx']>;
const MAX_FUTURE_DAYS = 365;

export async function submitResignation(
  ctx: Ctx,
  actorUserId: Types.ObjectId,
  input: { proposedLastDay: string; reason?: string },
  now: Date,
) {
  if (!ctx.employeeId) throw AppError.forbidden('Your account has no employee record');
  const tenant = await loadTenant(ctx.tenantId);
  const emp = await Employee.findOne({ _id: ctx.employeeId, tenantId: ctx.tenantId })
    .select('employmentStatus joiningDate')
    .lean();
  if (!emp) throw AppError.forbidden();
  if (emp.employmentStatus === 'NOTICE_PERIOD') throw AppError.conflict('You are already serving a notice period');
  if (emp.employmentStatus !== 'ACTIVE') throw AppError.forbidden();
  const today = localDate(now, tenant.timezone);
  if (input.proposedLastDay < today) throw AppError.badRequest('The last working day cannot be in the past');
  if (input.proposedLastDay > addDays(today, MAX_FUTURE_DAYS)) throw AppError.badRequest('Last working day is too far ahead');
  if (await Resignation.exists({ tenantId: ctx.tenantId, employeeId: ctx.employeeId, status: { $in: ['PENDING', 'APPROVED'] } }))
    throw AppError.conflict('You already have a resignation in progress');

  await ensureWorkflow(ctx.tenantId, 'RESIGNATION', 'Resignation');
  const doc = await Resignation.create({
    tenantId: ctx.tenantId,
    employeeId: ctx.employeeId,
    requestedBy: actorUserId,
    proposedLastDay: input.proposedLastDay,
    reason: input.reason,
  });
  try {
    const ar = await submitRequest(
      { tenantId: ctx.tenantId, userId: actorUserId, employeeId: ctx.employeeId },
      { requestType: 'RESIGNATION', title: `Resignation: last day ${input.proposedLastDay}`, details: { proposedLastDay: input.proposedLastDay } },
    );
    await Resignation.updateOne({ _id: doc._id, tenantId: ctx.tenantId }, { $set: { approvalRequestId: ar._id } });
    doc.approvalRequestId = ar._id;
    return doc;
  } catch (e) {
    await Resignation.deleteOne({ _id: doc._id, tenantId: ctx.tenantId });
    throw e;
  }
}

/** Withdraw while pending. Once approved the notice period is HR's to change, so it cannot be withdrawn here. */
export async function cancelResignation(ctx: Ctx, id: string, now: Date) {
  const doc = await Resignation.findOneAndUpdate(
    { _id: id, tenantId: ctx.tenantId, employeeId: ctx.employeeId ?? null, status: 'PENDING' },
    { $set: { status: 'CANCELLED', decidedAt: now } },
    { new: true },
  ).lean();
  if (!doc) {
    const exists = await Resignation.exists({ _id: id, tenantId: ctx.tenantId, employeeId: ctx.employeeId ?? null });
    throw exists ? AppError.conflict('Only a pending resignation can be withdrawn') : AppError.notFound('Resignation not found');
  }
  if (doc.approvalRequestId)
    await ApprovalRequest.updateOne(
      { _id: doc.approvalRequestId, tenantId: ctx.tenantId, status: 'PENDING' },
      { $set: { status: 'CANCELLED', decidedAt: now } },
    );
  return doc;
}

registerHooks('RESIGNATION', {
  async afterFinal(req, actor) {
    const status = req.status as 'APPROVED' | 'REJECTED' | 'CANCELLED';
    const now = actor.now ?? new Date();
    const comment = [...req.steps].reverse().find((s) => s.comment)?.comment ?? undefined;
    const doc = await Resignation.findOneAndUpdate(
      { tenantId: req.tenantId, approvalRequestId: req._id, status: 'PENDING' },
      { $set: { status, decidedAt: now, decisionComment: comment } },
      { new: true },
    ).lean();
    if (!doc || status !== 'APPROVED') return;
    try {
      await startNoticePeriod(req.tenantId, actor.userId as Types.ObjectId, String(doc.employeeId), {
        noticePeriodStartDate: now,
        lastWorkingDate: new Date(`${doc.proposedLastDay}T00:00:00.000Z`),
        reason: 'Resignation approved',
      });
    } catch (e) {
      await Resignation.updateOne(
        { _id: doc._id, tenantId: req.tenantId },
        { $set: { applyError: (e as Error).message.slice(0, 300) } },
      );
    }
  },
});
