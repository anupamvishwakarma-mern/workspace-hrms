import type { Request } from 'express';
import type { Types } from 'mongoose';
import { AttendanceCorrection } from '../../database/models/attendanceCorrection.model';
import { AttendanceDay } from '../../database/models/attendanceDay.model';
import { AttendanceException } from '../../database/models/attendanceException.model';
import { Employee } from '../../database/models/employee.model';
import { AppError } from '../../utils/errors';
import { hasPermission } from '../auth/permissions';
import { addDays, localDate } from './dates';
import {
  appendEvent,
  computeDay,
  loadTenant,
  recalculateDay,
  withEmployeeTransaction,
  type TenantInfo,
} from './attendance.service';

type Ctx = NonNullable<Request['tenantCtx']>;
export const CORRECTION_WINDOW_DAYS = 60;

/**
 * Whether the caller may review items belonging to `employeeId`.
 * Owner/HR: any employee in the tenant. Manager: direct reports only. Nobody reviews their own
 * item unless the tenant explicitly enabled self-approval AND they hold company-wide review rights.
 */
export async function assertCanReview(
  ctx: Ctx,
  actorUserId: Types.ObjectId,
  tenant: TenantInfo,
  item: { employeeId: Types.ObjectId; requestedBy?: Types.ObjectId },
) {
  const all = hasPermission(ctx.roles, 'attendance:review:all');
  const team = hasPermission(ctx.roles, 'attendance:review:team');
  if (!all && !team) throw AppError.forbidden();
  const own =
    (ctx.employeeId && String(item.employeeId) === String(ctx.employeeId)) ||
    (item.requestedBy && String(item.requestedBy) === String(actorUserId));
  if (own && !(tenant.settings.attendance.allowSelfApproval && all))
    throw AppError.forbidden('You cannot review your own request');
  if (!all) {
    const emp = await Employee.findOne({ _id: item.employeeId, tenantId: ctx.tenantId })
      .select('managerId')
      .lean();
    if (!emp || !ctx.employeeId || String(emp.managerId) !== String(ctx.employeeId))
      throw AppError.notFound(); // out of scope: do not reveal
  }
}

/** Employee ids a reviewer/reader may see: undefined = everyone in the tenant. */
export async function teamScope(
  ctx: Ctx,
  allPerm: Parameters<typeof hasPermission>[1],
  teamPerm: Parameters<typeof hasPermission>[1],
): Promise<Types.ObjectId[] | undefined> {
  if (hasPermission(ctx.roles, allPerm)) return undefined;
  const ids: Types.ObjectId[] = [];
  if (ctx.employeeId) ids.push(ctx.employeeId);
  if (hasPermission(ctx.roles, teamPerm) && ctx.employeeId) {
    const reports = await Employee.find({ tenantId: ctx.tenantId, managerId: ctx.employeeId })
      .select('_id')
      .lean();
    ids.push(...reports.map((r) => r._id));
  }
  return ids;
}

/* ------------------------------- corrections ------------------------------- */

export interface CorrectionInput {
  workDate: string;
  checkIn?: Date;
  checkOut?: Date;
  reason: string;
  employeeId?: string;
}

export async function createCorrection(
  ctx: Ctx,
  actorUserId: Types.ObjectId,
  input: CorrectionInput,
  now: Date,
) {
  const tenant = await loadTenant(ctx.tenantId);
  const onBehalf = input.employeeId && String(input.employeeId) !== String(ctx.employeeId);
  if (onBehalf && !hasPermission(ctx.roles, 'attendance:review:all')) throw AppError.forbidden();
  const employeeId = onBehalf ? input.employeeId! : ctx.employeeId;
  if (!employeeId) throw AppError.forbidden('No employee profile is linked to your account');
  const emp = await Employee.findOne({ _id: employeeId, tenantId: ctx.tenantId })
    .select('employmentStatus')
    .lean();
  if (!emp) throw AppError.notFound('Employee not found');
  if (!input.checkIn && !input.checkOut)
    throw AppError.badRequest('Provide checkIn and/or checkOut');
  if (input.checkIn && input.checkOut && input.checkOut <= input.checkIn)
    throw AppError.badRequest('checkOut must be after checkIn');
  if (
    input.checkIn &&
    input.checkOut &&
    input.checkOut.getTime() - input.checkIn.getTime() > 24 * 3_600_000
  )
    throw AppError.badRequest('A corrected session cannot exceed 24 hours');
  for (const t of [input.checkIn, input.checkOut])
    if (t && t > now) throw AppError.badRequest('Corrected times cannot be in the future');
  const today = localDate(now, tenant.timezone);
  if (input.workDate > today || input.workDate < addDays(today, -CORRECTION_WINDOW_DAYS))
    throw AppError.badRequest(`workDate must be within the last ${CORRECTION_WINDOW_DAYS} days`);
  for (const t of [input.checkIn, input.checkOut]) {
    if (
      t &&
      (t.getTime() < Date.parse(`${addDays(input.workDate, -1)}T00:00:00Z`) - 14 * 3_600_000 ||
        t.getTime() > Date.parse(`${addDays(input.workDate, 2)}T00:00:00Z`) + 14 * 3_600_000)
    )
      throw AppError.badRequest('Corrected times do not fall on the selected workDate');
  }
  if (
    await AttendanceCorrection.exists({
      tenantId: ctx.tenantId,
      employeeId,
      workDate: input.workDate,
      status: 'PENDING',
    })
  )
    throw AppError.conflict('A correction for this day is already pending');
  const day = await AttendanceDay.findOne({
    tenantId: ctx.tenantId,
    employeeId,
    workDate: input.workDate,
  })
    .select('_id')
    .lean();
  const doc = await AttendanceCorrection.create({
    tenantId: ctx.tenantId,
    employeeId,
    workDate: input.workDate,
    attendanceDayId: day?._id,
    requestedChanges: { checkIn: input.checkIn, checkOut: input.checkOut },
    reason: input.reason,
    requestedBy: actorUserId,
  });
  if (day)
    await AttendanceDay.updateOne(
      { _id: day._id, tenantId: ctx.tenantId },
      { $set: { correctionStatus: 'PENDING' } },
    );
  return doc;
}

export async function reviewCorrection(
  ctx: Ctx,
  actorUserId: Types.ObjectId,
  id: string,
  decision: 'APPROVED' | 'REJECTED',
  comment: string | undefined,
  now: Date,
) {
  const tenant = await loadTenant(ctx.tenantId);
  const corr = await AttendanceCorrection.findOne({ _id: id, tenantId: ctx.tenantId }).lean();
  if (!corr) throw AppError.notFound('Correction not found');
  await assertCanReview(ctx, actorUserId, tenant, corr);
  return withEmployeeTransaction(ctx.tenantId, corr.employeeId, async (session) => {
    // Atomic PENDING -> decision flip: a second (or concurrent) review finds nothing to update.
    const flipped = await AttendanceCorrection.findOneAndUpdate(
      { _id: corr._id, tenantId: ctx.tenantId, status: 'PENDING' },
      {
        $set: {
          status: decision,
          reviewedBy: actorUserId,
          reviewComment: comment,
          reviewedAt: now,
        },
      },
      { new: true, session },
    ).lean();
    if (!flipped) throw AppError.conflict('This correction has already been reviewed');
    if (decision === 'APPROVED') {
      // Sanity check the resulting day before committing (e.g. corrected check-out earlier than an existing punch).
      const { result } = await computeDay(tenant, corr.employeeId, corr.workDate, now, session);
      if (result.firstCheckIn && result.lastCheckOut && result.lastCheckOut <= result.firstCheckIn)
        throw AppError.badRequest(
          'The corrected times conflict with recorded punches for that day',
        );
    }
    await recalculateDay(tenant, corr.employeeId, corr.workDate, now, session);
    return flipped;
  });
}

/* ------------------------------- exceptions ------------------------------- */

export async function reviewException(
  ctx: Ctx,
  actorUserId: Types.ObjectId,
  id: string,
  decision: 'APPROVED' | 'REJECTED',
  comment: string | undefined,
  now: Date,
) {
  const tenant = await loadTenant(ctx.tenantId);
  const ex = await AttendanceException.findOne({ _id: id, tenantId: ctx.tenantId }).lean();
  if (!ex) throw AppError.notFound('Exception not found');
  await assertCanReview(ctx, actorUserId, tenant, {
    employeeId: ex.employeeId,
    requestedBy: undefined,
  });
  return withEmployeeTransaction(ctx.tenantId, ex.employeeId, async (session) => {
    const flipped = await AttendanceException.findOneAndUpdate(
      { _id: ex._id, tenantId: ctx.tenantId, status: 'PENDING' },
      {
        $set: {
          status: decision,
          reviewedBy: actorUserId,
          reviewComment: comment,
          reviewedAt: now,
        },
      },
      { new: true, session },
    ).lean();
    if (!flipped) throw AppError.conflict('This exception has already been reviewed');
    if (decision === 'REJECTED') return { exception: flipped, event: null };
    // Approved: the punch is recorded at the server time of the original attempt. History is never rewritten.
    const out = await appendEvent(
      {
        tenant,
        employeeId: ex.employeeId,
        type: ex.eventType,
        at: ex.occurredAt,
        idempotencyKey: `exception:${ex._id}`,
        source: 'EXCEPTION',
        location: ex.location
          ? {
              latitude: ex.location.coordinates[1]!,
              longitude: ex.location.coordinates[0]!,
              accuracyMeters: ex.locationAccuracyMeters ?? 0,
            }
          : undefined,
        clientTimestamp: ex.clientTimestamp ?? undefined,
        deviceId: ex.deviceId ?? undefined,
        workLocationId: ex.workLocationId ? String(ex.workLocationId) : undefined,
        verification: {
          status: 'EXCEPTION_APPROVED',
          method: ex.failure,
          distanceMeters: ex.distanceMeters ?? undefined,
          mockLocationDetected: !!ex.mockLocationDetected,
        },
        exceptionId: ex._id,
        photoId: ex.photoId ?? undefined,
        requireNoLaterEvents: true,
      },
      session,
    );
    await AttendanceException.updateOne(
      { _id: ex._id, tenantId: ex.tenantId },
      { $set: { resultingEventId: out.event._id } },
      { session },
    );
    return { exception: { ...flipped, resultingEventId: out.event._id }, event: out.event };
  });
}
