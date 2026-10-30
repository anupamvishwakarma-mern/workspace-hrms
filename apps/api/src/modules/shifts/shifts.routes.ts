import type { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { Counter } from '../../database/models/counter.model';
import { Department } from '../../database/models/department.model';
import { Employee } from '../../database/models/employee.model';
import { Shift } from '../../database/models/shift.model';
import { ShiftAssignment } from '../../database/models/shiftAssignment.model';
import { authenticate, requirePermission, resolveTenant } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/errors';
import { rethrowDuplicate } from '../../utils/mongo';
import { route } from '../../utils/route';
import { idParams, objectId, paginationQuery, validate } from '../../utils/validate';
import { writeAudit } from '../audit/audit.service';
import { TIME_RE, WORK_DATE_RE, isRealDate, isValidTimezone } from '../attendance/dates';
import { hasPermission } from '../auth/permissions';
import { rangesOverlap } from './shifts.service';

const time = z.string().regex(TIME_RE, 'Use HH:mm (24h)');
const date = z
  .string()
  .regex(WORK_DATE_RE, 'Use YYYY-MM-DD')
  .refine(isRealDate, 'Invalid calendar date');
const tz = z.string().refine(isValidTimezone, 'Invalid IANA timezone');

const shiftFields = {
  shiftType: z.enum(['FIXED', 'FLEXIBLE']),
  name: z.string().trim().min(1).max(120),
  startTime: time,
  endTime: time,
  timezone: tz.optional(),
  graceMinutes: z.number().int().min(0).max(240),
  earlyDepartureGraceMinutes: z.number().int().min(0).max(240),
  minFullDayMinutes: z.number().int().min(1).max(1440),
  minHalfDayMinutes: z.number().int().min(1).max(1440),
  breakPolicy: z
    .object({
      type: z.enum(['RECORDED', 'AUTO_DEDUCT']),
      paidAllowanceMinutes: z.number().int().min(0).max(480),
      autoDeductMinutes: z.number().int().min(0).max(480),
      expectedUnpaidMinutes: z.number().int().min(0).max(480),
    })
    .partial()
    .strict(),
  weeklyOffDays: z
    .array(z.number().int().min(0).max(6))
    .max(7)
    .refine((a) => new Set(a).size === a.length, 'Duplicate days'),
  overtimePolicy: z
    .object({
      enabled: z.boolean(),
      thresholdMinutes: z.number().int().min(0).max(600),
      maxMinutesPerDay: z.number().int().min(1).max(1440),
    })
    .partial()
    .strict(),
  effectiveFrom: date,
  effectiveTo: date,
};
const rules = (b: Record<string, unknown>, ctx: z.RefinementCtx) => {
  if (b.startTime && b.endTime && b.startTime === b.endTime)
    ctx.addIssue({
      code: 'custom',
      path: ['endTime'],
      message:
        'Start and end time must differ (use an end earlier than start for overnight shifts)',
    });
  if (
    typeof b.minHalfDayMinutes === 'number' &&
    typeof b.minFullDayMinutes === 'number' &&
    b.minHalfDayMinutes > b.minFullDayMinutes
  )
    ctx.addIssue({
      code: 'custom',
      path: ['minHalfDayMinutes'],
      message: 'Half-day threshold cannot exceed full-day threshold',
    });
  if (
    typeof b.effectiveFrom === 'string' &&
    typeof b.effectiveTo === 'string' &&
    b.effectiveTo < b.effectiveFrom
  )
    ctx.addIssue({
      code: 'custom',
      path: ['effectiveTo'],
      message: 'effectiveTo is before effectiveFrom',
    });
};
const createBody = z
  .object({ ...shiftFields })
  .partial({
    shiftType: true,
    timezone: true,
    graceMinutes: true,
    earlyDepartureGraceMinutes: true,
    minFullDayMinutes: true,
    minHalfDayMinutes: true,
    breakPolicy: true,
    weeklyOffDays: true,
    overtimePolicy: true,
    effectiveFrom: true,
    effectiveTo: true,
  })
  .strict()
  .superRefine(rules)
  .superRefine((b, ctx) => {
    if (b.shiftType === 'FLEXIBLE' && b.minFullDayMinutes === undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['minFullDayMinutes'],
        message: 'A flexible shift needs the hours that make a full day (minFullDayMinutes)',
      });
  });
const patchBody = z
  .object({ ...shiftFields, status: z.enum(['ACTIVE', 'INACTIVE']) })
  .partial()
  .strict()
  .superRefine(rules);
const listQuery = z
  .object({ ...paginationQuery, status: z.enum(['ACTIVE', 'INACTIVE']).optional() })
  .strict();

const assignBody = z
  .object({
    shiftId: objectId,
    employeeIds: z.array(objectId).min(1).max(500).optional(),
    departmentId: objectId.optional(),
    effectiveFrom: date,
    effectiveTo: date.optional(),
  })
  .strict()
  .refine(
    (b) => !!b.employeeIds !== !!b.departmentId,
    'Provide exactly one of employeeIds or departmentId',
  )
  .refine(
    (b) => !b.effectiveTo || b.effectiveTo >= b.effectiveFrom,
    'effectiveTo is before effectiveFrom',
  );
const assignPatch = z.object({ effectiveTo: date }).strict();
const assignList = z.object({ ...paginationQuery, employeeId: objectId.optional() }).strict();

const serShift = (s: Record<string, unknown> & { _id: unknown }) => ({
  id: String(s._id),
  name: s.name,
  shiftType: s.shiftType ?? 'FIXED',
  startTime: s.startTime,
  endTime: s.endTime,
  overnight: String(s.endTime) <= String(s.startTime),
  timezone: s.timezone,
  graceMinutes: s.graceMinutes,
  earlyDepartureGraceMinutes: s.earlyDepartureGraceMinutes,
  minFullDayMinutes: s.minFullDayMinutes,
  minHalfDayMinutes: s.minHalfDayMinutes,
  breakPolicy: s.breakPolicy,
  weeklyOffDays: s.weeklyOffDays,
  overtimePolicy: s.overtimePolicy,
  effectiveFrom: s.effectiveFrom,
  effectiveTo: s.effectiveTo,
  status: s.status,
});
const serAssign = (a: Record<string, unknown> & { _id: unknown }) => ({
  id: String(a._id),
  employeeId: String(a.employeeId),
  shiftId: String(a.shiftId),
  effectiveFrom: a.effectiveFrom,
  effectiveTo: a.effectiveTo,
  assignedBy: a.assignedBy ? String(a.assignedBy) : undefined,
});

export function registerShiftRoutes(v1: Router, env: Env): void {
  const chain = [authenticate(env), resolveTenant];

  route(
    v1,
    {
      method: 'get',
      path: '/shifts',
      summary: 'List shifts.',
      tags: ['Shifts'],
      auth: 'tenant',
      permission: 'shift:read',
      query: listQuery,
    },
    ...chain,
    requirePermission('shift:read'),
    validate({ query: listQuery }),
    asyncHandler(async (req, res) => {
      const q = req.query as unknown as z.infer<typeof listQuery>;
      const filter = {
        tenantId: req.tenantCtx!.tenantId,
        ...(q.status ? { status: q.status } : {}),
      };
      const [items, total] = await Promise.all([
        Shift.find(filter)
          .sort({ name: 1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
        Shift.countDocuments(filter),
      ]);
      res.json({
        success: true,
        data: items.map(serShift),
        meta: { page: q.page, limit: q.limit, total },
      });
    }),
  );

  route(
    v1,
    {
      method: 'post',
      path: '/shifts',
      summary: 'Create a shift (end time earlier than start time = overnight shift).',
      tags: ['Shifts'],
      auth: 'tenant',
      permission: 'shift:manage',
      body: createBody,
      successStatus: 201,
    },
    ...chain,
    requirePermission('shift:manage'),
    validate({ body: createBody }),
    asyncHandler(async (req, res) => {
      const doc = await Shift.create({ ...req.body, tenantId: req.tenantCtx!.tenantId }).catch(
        (e) => rethrowDuplicate(e, 'A shift with this name already exists'),
      );
      await writeAudit(req, {
        action: 'shift.create',
        entityType: 'Shift',
        entityId: doc._id,
        after: doc,
      });
      res.status(201).json({ success: true, data: serShift(doc.toObject()) });
    }),
  );

  route(
    v1,
    {
      method: 'patch',
      path: '/shifts/:id',
      summary: 'Update a shift. Applies to future recalculations; past punches are not rewritten.',
      tags: ['Shifts'],
      auth: 'tenant',
      permission: 'shift:manage',
      body: patchBody,
    },
    ...chain,
    requirePermission('shift:manage'),
    validate({ params: idParams, body: patchBody }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      const before = await Shift.findOne({ _id: req.params.id, tenantId }).lean();
      if (!before) throw AppError.notFound('Shift not found');
      const merged = { ...before, ...req.body };
      if (merged.startTime === merged.endTime)
        throw AppError.badRequest('Start and end time must differ');
      if (merged.shiftType === 'FLEXIBLE' && !merged.minFullDayMinutes)
        throw AppError.unprocessable('A flexible shift needs the hours that make a full day (minFullDayMinutes)');
      const { breakPolicy, overtimePolicy, ...rest } = req.body as Record<
        string,
        Record<string, unknown> | unknown
      >;
      const $set: Record<string, unknown> = { ...rest };
      for (const [k, v] of Object.entries((breakPolicy as Record<string, unknown>) ?? {}))
        $set[`breakPolicy.${k}`] = v;
      for (const [k, v] of Object.entries((overtimePolicy as Record<string, unknown>) ?? {}))
        $set[`overtimePolicy.${k}`] = v;
      const after = await Shift.findOneAndUpdate(
        { _id: before._id, tenantId },
        { $set },
        { new: true },
      )
        .lean()
        .catch((e) => rethrowDuplicate(e, 'A shift with this name already exists'));
      await writeAudit(req, {
        action: 'shift.update',
        entityType: 'Shift',
        entityId: before._id,
        before,
        after,
      });
      res.json({ success: true, data: serShift(after!) });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/shift-assignments',
      summary: 'List shift assignments. Managers of schedules see anyone; others only their own.',
      tags: ['Shifts'],
      auth: 'tenant',
      permission: 'shift:read',
      query: assignList,
    },
    ...chain,
    requirePermission('shift:read'),
    validate({ query: assignList }),
    asyncHandler(async (req, res) => {
      const q = req.query as unknown as z.infer<typeof assignList>;
      const ctx = req.tenantCtx!;
      const canManage = hasPermission(ctx.roles, 'shift:manage');
      const employeeId = canManage ? q.employeeId : ctx.employeeId;
      if (!canManage && q.employeeId && q.employeeId !== String(ctx.employeeId))
        throw AppError.forbidden();
      const filter = { tenantId: ctx.tenantId, ...(employeeId ? { employeeId } : {}) };
      const [items, total] = await Promise.all([
        ShiftAssignment.find(filter)
          .sort({ effectiveFrom: -1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
        ShiftAssignment.countDocuments(filter),
      ]);
      res.json({
        success: true,
        data: items.map(serAssign),
        meta: { page: q.page, limit: q.limit, total },
      });
    }),
  );

  route(
    v1,
    {
      method: 'post',
      path: '/shift-assignments',
      summary:
        'Assign a shift to employees or a whole department. Rejects (409) if any employee already has an overlapping assignment; nothing is written in that case.',
      tags: ['Shifts'],
      auth: 'tenant',
      permission: 'shift:manage',
      body: assignBody,
      successStatus: 201,
    },
    ...chain,
    requirePermission('shift:manage'),
    validate({ body: assignBody }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      const b = req.body as z.infer<typeof assignBody>;
      const shift = await Shift.findOne({ _id: b.shiftId, tenantId, status: 'ACTIVE' }).lean();
      if (!shift)
        throw AppError.badRequest('shiftId does not reference an active shift in this company');
      let employeeIds: string[];
      if (b.departmentId) {
        if (!(await Department.exists({ _id: b.departmentId, tenantId })))
          throw AppError.badRequest('departmentId does not reference a department in this company');
        employeeIds = (
          await Employee.find({
            tenantId,
            departmentId: b.departmentId,
            employmentStatus: { $in: ['ACTIVE', 'ON_LEAVE', 'NOTICE_PERIOD'] },
          })
            .select('_id')
            .lean()
        ).map((e) => String(e._id));
        if (employeeIds.length === 0)
          throw AppError.badRequest('Department has no assignable employees');
      } else {
        employeeIds = [...new Set(b.employeeIds!)];
        const found = await Employee.find({
          tenantId,
          _id: { $in: employeeIds },
          employmentStatus: { $ne: 'TERMINATED' },
        })
          .select('_id')
          .lean();
        if (found.length !== employeeIds.length)
          throw AppError.badRequest(
            'One or more employees were not found in this company or are terminated',
          );
      }
      const session = await mongoose.startSession();
      let created: { _id: unknown }[] = [];
      try {
        await session.withTransaction(async () => {
          // Per-employee lock document: concurrent assignments for the same employee conflict and serialise.
          for (const id of [...employeeIds].sort())
            await Counter.updateOne(
              { _id: `shiftassign:${tenantId}:${id}` },
              { $inc: { seq: 1 } },
              { upsert: true, session },
            );
          const existing = await ShiftAssignment.find({
            tenantId,
            employeeId: { $in: employeeIds },
          })
            .session(session)
            .lean();
          const conflicts = existing
            .filter((a) =>
              rangesOverlap(a.effectiveFrom, a.effectiveTo, b.effectiveFrom, b.effectiveTo),
            )
            .map((a) => ({
              employeeId: String(a.employeeId),
              assignmentId: String(a._id),
              effectiveFrom: a.effectiveFrom,
              effectiveTo: a.effectiveTo,
            }));
          if (conflicts.length)
            throw AppError.conflict('Overlapping shift assignments exist; end them first', {
              conflicts,
            });
          created = await ShiftAssignment.create(
            employeeIds.map((employeeId) => ({
              tenantId,
              employeeId,
              shiftId: b.shiftId,
              effectiveFrom: b.effectiveFrom,
              effectiveTo: b.effectiveTo,
              assignedBy: req.auth!.userId,
            })),
            { session, ordered: true },
          );
        });
      } finally {
        await session.endSession();
      }
      await writeAudit(req, {
        action: 'shift.assign',
        entityType: 'ShiftAssignment',
        after: {
          shiftId: b.shiftId,
          employeeCount: employeeIds.length,
          effectiveFrom: b.effectiveFrom,
          effectiveTo: b.effectiveTo,
        },
      });
      res.status(201).json({
        success: true,
        data: (
          created as unknown as { toObject(): Record<string, unknown> & { _id: unknown } }[]
        ).map((c) => serAssign(c.toObject())),
      });
    }),
  );

  route(
    v1,
    {
      method: 'patch',
      path: '/shift-assignments/:id',
      summary: 'End an assignment by setting effectiveTo.',
      tags: ['Shifts'],
      auth: 'tenant',
      permission: 'shift:manage',
      body: assignPatch,
    },
    ...chain,
    requirePermission('shift:manage'),
    validate({ params: idParams, body: assignPatch }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      const before = await ShiftAssignment.findOne({ _id: req.params.id, tenantId }).lean();
      if (!before) throw AppError.notFound('Assignment not found');
      if (req.body.effectiveTo < before.effectiveFrom)
        throw AppError.badRequest('effectiveTo is before effectiveFrom');
      const after = await ShiftAssignment.findOneAndUpdate(
        { _id: before._id, tenantId },
        { $set: { effectiveTo: req.body.effectiveTo } },
        { new: true },
      ).lean();
      await writeAudit(req, {
        action: 'shift.assignment_end',
        entityType: 'ShiftAssignment',
        entityId: before._id,
        before,
        after,
      });
      res.json({ success: true, data: serAssign(after!) });
    }),
  );
}
