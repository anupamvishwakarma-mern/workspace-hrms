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
  const all = hasPermission(ctx, 'attendance:review:all');
  const team = hasPermission(ctx, 'attendance:review:team');
  if (!all && !team) throw AppError.forbidden();
  const own =
    (ctx.employeeId && String(item.employeeId) === String(ctx.employeeId)) ||
    (item.requestedBy && String(item.requestedBy) === String(actorUserId));
  if (own && !(tenant.settings.attendance.allowSelfApproval && all))
    throw AppError.forbidden('You cannot review your own request');
  if (!(await isApproverFor(ctx, item.employeeId))) throw AppError.notFound(); // out of scope: do not reveal
}

/**
 * Approval rule: an employee's requests are decided by their manager. When the employee has no
 * manager, the company owner decides. HR and other roles do not approve on someone else's behalf.
 */
export async function isApproverFor(ctx: Ctx, employeeId: Types.ObjectId | string): Promise<boolean> {
  if (!ctx.employeeId && !ctx.roles.includes('COMPANY_OWNER')) return false;
  const emp = await Employee.findOne({ _id: employeeId, tenantId: ctx.tenantId })
    .select('managerId')
    .lean();
  if (!emp) return false;
  if (emp.managerId) return !!ctx.employeeId && String(emp.managerId) === String(ctx.employeeId);
  return ctx.roles.includes('COMPANY_OWNER');
}

/** Employees whose requests this person decides: direct reports, plus unmanaged people for the owner. */
export async function approvalScope(ctx: Ctx): Promise<Types.ObjectId[]> {
  const or: Record<string, unknown>[] = [];
  if (ctx.employeeId) or.push({ managerId: ctx.employeeId });
  if (ctx.roles.includes('COMPANY_OWNER')) or.push({ managerId: null });
  if (or.length === 0) return [];
  const rows = await Employee.find({ tenantId: ctx.tenantId, $or: or }).select('_id').lean();
  return rows.map((r) => r._id);
}

/** Employee ids a reviewer/reader may see: undefined = everyone in the tenant. */
export async function teamScope(
  ctx: Ctx,
  allPerm: Parameters<typeof hasPermission>[1],
  teamPerm: Parameters<typeof hasPermission>[1],
): Promise<Types.ObjectId[] | undefined> {
  if (hasPermission(ctx, allPerm)) return undefined;
  const ids: Types.ObjectId[] = [];
  if (ctx.employeeId) ids.push(ctx.employeeId);
  if (hasPermission(ctx, teamPerm) && ctx.employeeId) {
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
  if (onBehalf && !hasPermission(ctx, 'attendance:review:all')) throw AppError.forbidden();
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
  return decideCorrection(ctx, actorUserId, tenant, corr, decision, comment, now);
}

/** Applies a decision to a correction. Callers have already checked who may decide. */
export async function decideCorrection(
  ctx: Ctx,
  actorUserId: Types.ObjectId,
  tenant: TenantInfo,
  corr: { _id: Types.ObjectId; employeeId: Types.ObjectId; workDate: string },
  decision: 'APPROVED' | 'REJECTED',
  comment: string | undefined,
  now: Date,
) {
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

/**
 * HR records someone's attendance directly. It is stored as an already-approved correction (so the
 * original punches stay untouched and the calculator applies it like any other), marked HR_MANUAL.
 * Never for your own record, and a reason is always required.
 */
export async function recordManualAttendance(
  ctx: Ctx,
  actorUserId: Types.ObjectId,
  input: CorrectionInput & { employeeId: string },
  now: Date,
) {
  if (!hasPermission(ctx, 'attendance:manual')) throw AppError.forbidden();
  if (ctx.employeeId && String(input.employeeId) === String(ctx.employeeId))
    throw AppError.forbidden('You cannot record attendance for yourself');
  const tenant = await loadTenant(ctx.tenantId);
  const corr = await createCorrection(ctx, actorUserId, input, now);
  try {
    await AttendanceCorrection.updateOne(
      { _id: corr._id, tenantId: ctx.tenantId },
      { $set: { origin: 'HR_MANUAL' } },
    );
    return await decideCorrection(
      ctx,
      actorUserId,
      tenant,
      corr.toObject(),
      'APPROVED',
      'Recorded manually by HR',
      now,
    );
  } catch (e) {
    // Do not leave a half-made request behind (for example when the times clash with real punches).
    await AttendanceCorrection.deleteOne({ _id: corr._id, tenantId: ctx.tenantId, status: 'PENDING' });
    await withEmployeeTransaction(ctx.tenantId, corr.employeeId, (session) =>
      recalculateDay(tenant, corr.employeeId, corr.workDate, now, session),
    );
    throw e;
  }
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
