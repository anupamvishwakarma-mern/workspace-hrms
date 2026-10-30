import type { Router } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { authenticate, requirePermission, resolveTenant } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import type { Clock } from '../../utils/clock';
import { route } from '../../utils/route';
import { objectId, validate } from '../../utils/validate';
import { writeAudit } from '../audit/audit.service';
import { WORK_DATE_RE, isRealDate } from './dates';
import { recordManualAttendance } from './review.service';

const body = z
  .object({
    employeeId: objectId,
    workDate: z.string().regex(WORK_DATE_RE, 'Use YYYY-MM-DD').refine(isRealDate, 'Invalid date'),
    checkIn: z.coerce.date().optional(),
    checkOut: z.coerce.date().optional(),
    reason: z.string().trim().min(5).max(1000),
  })
  .strict();

export function registerManualAttendanceRoutes(v1: Router, env: Env, deps: { clock: Clock }): void {
  const chain = [authenticate(env), resolveTenant];
  route(
    v1,
    {
      method: 'post',
      path: '/attendance/manual',
      summary:
        "Record someone's check-in and/or check-out directly (HR/owner, never for yourself, reason required). Stored as an approved correction marked HR_MANUAL; original punches are untouched.",
      tags: ['Attendance corrections'],
      auth: 'tenant',
      permission: 'attendance:manual',
      body,
      successStatus: 201,
    },
    ...chain,
    requirePermission('attendance:manual'),
    validate({ body }),
    asyncHandler(async (req, res) => {
      const b = req.body as z.infer<typeof body>;
      const doc = await recordManualAttendance(req.tenantCtx!, req.auth!.userId, b, deps.clock.now());
      await writeAudit(req, {
        action: 'attendance.manual_entry',
        entityType: 'AttendanceCorrection',
        entityId: doc._id,
        reason: b.reason,
        after: { employeeId: b.employeeId, workDate: b.workDate, checkIn: b.checkIn, checkOut: b.checkOut },
      });
      res.status(201).json({
        success: true,
        data: {
          id: String(doc._id),
          employeeId: String(doc.employeeId),
          workDate: doc.workDate,
          status: doc.status,
          origin: 'HR_MANUAL',
          requestedChanges: doc.requestedChanges,
          reason: doc.reason,
        },
      });
    }),
  );
}
