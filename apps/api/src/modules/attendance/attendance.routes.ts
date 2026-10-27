import type { Request, Router } from 'express';
import type { Types } from 'mongoose';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { AttendanceCorrection } from '../../database/models/attendanceCorrection.model';
import { AttendanceDay } from '../../database/models/attendanceDay.model';
import { AttendanceEvent, EVENT_TYPES } from '../../database/models/attendanceEvent.model';
import { WorkLocation } from '../../database/models/workLocation.model';
import { AttendanceException } from '../../database/models/attendanceException.model';
import { DAY_STATUSES } from '../../database/models/attendanceDay.model';
import { Employee } from '../../database/models/employee.model';
import { authenticate, requirePermission, resolveTenant } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import type { Clock } from '../../utils/clock';
import { AppError } from '../../utils/errors';
import { route } from '../../utils/route';
import { idParams, objectId, paginationQuery, validate } from '../../utils/validate';
import { writeAudit } from '../audit/audit.service';
import { shiftForDate } from '../shifts/shifts.service';
import { addDays, shiftWindow, WORK_DATE_RE, isRealDate } from './dates';
import {
  allowedActions,
  computeDay,
  currentState,
  loadTenant,
  punch,
  resolveCheckInWorkDate,
  type PunchOutcome,
} from './attendance.service';
import { notifyEmployee } from '../notifications/push.service';
import { createCorrection, reviewCorrection, reviewException, teamScope } from './review.service';
import { latitude, longitude } from '../locations/locations.routes';
import { registerPhotoRoutes } from './photos';

const date = z
  .string()
  .regex(WORK_DATE_RE, 'Use YYYY-MM-DD')
  .refine(isRealDate, 'Invalid calendar date');
const isoDateTime = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid timestamp')
  .transform((s) => new Date(s));

const punchBody = z
  .object({
    idempotencyKey: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,100}$/, 'Use 8-100 characters: letters, digits, - or _'),
    location: z
      .object({
        latitude,
        longitude,
        accuracyMeters: z.number().min(0).max(100000),
        mockLocationDetected: z.boolean().optional(),
      })
      .strict()
      .optional(),
    clientTimestamp: isoDateTime.optional(),
    deviceId: z.string().max(100).optional(),
    exceptionReason: z.string().trim().min(5).max(500).optional(),
    photoId: objectId.optional(),
  })
  .strict();

const rangeQuery = { from: date, to: date };
const historyQuery = z
  .object({ ...paginationQuery, from: date.optional(), to: date.optional() })
  .strict();
const daysQuery = z
  .object({
    ...paginationQuery,
    ...rangeQuery,
    employeeId: objectId.optional(),
    departmentId: objectId.optional(),
    status: z.enum(DAY_STATUSES).optional(),
  })
  .strict()
  .refine((q) => q.to >= q.from, 'to is before from')
  .refine(
    (q) => Date.parse(q.to) - Date.parse(q.from) <= 92 * 86_400_000,
    'Date range cannot exceed 93 days',
  );
const myEventsQuery = z.object({ date }).strict();
const correctionBody = z
  .object({
    workDate: date,
    checkIn: isoDateTime.optional(),
    checkOut: isoDateTime.optional(),
    reason: z.string().trim().min(5).max(1000),
    employeeId: objectId.optional(),
  })
  .strict();
const reviewBody = z.object({ comment: z.string().trim().max(1000).optional() }).strict();
const rejectBody = z.object({ comment: z.string().trim().min(3).max(1000) }).strict();
const listReviewQuery = z
  .object({
    ...paginationQuery,
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
    employeeId: objectId.optional(),
  })
  .strict();

const serEvent = (e: Record<string, unknown> & { _id: unknown }, withGps = false) => ({
  id: String(e._id),
  eventType: e.eventType,
  occurredAt: e.occurredAt,
  workDate: e.workDate,
  source: e.source,
  verification: e.verification,
  hasPhoto: !!e.photoId,
  ...(withGps
    ? {
        location: e.location,
        locationAccuracyMeters: e.locationAccuracyMeters,
        workLocationId: e.workLocationId ? String(e.workLocationId) : undefined,
        deviceId: e.deviceId,
        clientTimestamp: e.clientTimestamp,
        receivedAt: e.receivedAt,
      }
    : {}),
});
/** The employee's own punches: includes where they punched (their own data) and whether a photo was attached. */
async function serOwnEvents(
  tenantId: Types.ObjectId,
  events: (Record<string, unknown> & { _id: unknown })[],
) {
  const ids = [
    ...new Set(
      events
        .map((e) => e.workLocationId)
        .filter(Boolean)
        .map(String),
    ),
  ];
  const locs = ids.length
    ? await WorkLocation.find({ tenantId, _id: { $in: ids } })
        .select('name')
        .lean()
    : [];
  const names = new Map(locs.map((l) => [String(l._id), l.name]));
  return events.map((e) => {
    const coords = (e.location as { coordinates?: number[] } | undefined)?.coordinates;
    return {
      ...serEvent(e),
      location:
        coords && coords.length === 2
          ? {
              latitude: coords[1],
              longitude: coords[0],
              accuracyMeters: e.locationAccuracyMeters,
            }
          : undefined,
      workLocationName: e.workLocationId ? names.get(String(e.workLocationId)) : undefined,
    };
  });
}
const serDay = (d: Record<string, unknown> & { _id: unknown }) => ({
  id: String(d._id),
  employeeId: String(d.employeeId),
  workDate: d.workDate,
  status: d.status,
  firstCheckIn: d.firstCheckIn,
  lastCheckOut: d.lastCheckOut,
  workedMinutes: d.workedMinutes,
  breakMinutes: d.breakMinutes,
  unpaidBreakMinutes: d.unpaidBreakMinutes,
  overtimeMinutes: d.overtimeMinutes,
  lateMinutes: d.lateMinutes,
  earlyDepartureMinutes: d.earlyDepartureMinutes,
  scheduledMinutes: d.scheduledMinutes,
  isOpen: d.isOpen,
  correctionStatus: d.correctionStatus,
  shiftId: d.shiftId ? String(d.shiftId) : undefined,
  calculationVersion: d.calculationVersion,
  sessions: d.sessions,
});
const serCorrection = (c: Record<string, unknown> & { _id: unknown }) => ({
  id: String(c._id),
  employeeId: String(c.employeeId),
  workDate: c.workDate,
  requestedChanges: c.requestedChanges,
  reason: c.reason,
  status: c.status,
  requestedBy: String(c.requestedBy),
  reviewedBy: c.reviewedBy ? String(c.reviewedBy) : undefined,
  reviewComment: c.reviewComment,
  reviewedAt: c.reviewedAt,
  createdAt: c.createdAt,
});
const serException = (x: Record<string, unknown> & { _id: unknown }) => ({
  id: String(x._id),
  employeeId: String(x.employeeId),
  eventType: x.eventType,
  occurredAt: x.occurredAt,
  failure: x.failure,
  distanceMeters: x.distanceMeters,
  locationAccuracyMeters: x.locationAccuracyMeters,
  mockLocationDetected: x.mockLocationDetected,
  employeeReason: x.employeeReason,
  status: x.status,
  reviewedBy: x.reviewedBy ? String(x.reviewedBy) : undefined,
  reviewComment: x.reviewComment,
  reviewedAt: x.reviewedAt,
  resultingEventId: x.resultingEventId ? String(x.resultingEventId) : undefined,
});

const employeeRef = (e: Record<string, unknown> & { _id: unknown }) => ({
  id: String(e._id),
  employeeCode: e.employeeCode,
  firstName: e.firstName,
  lastName: e.lastName,
});

/** Adds a minimal employee reference (code + name) to rows so reviewers see who a request is from. */
async function withEmployees<T extends { employeeId: string }>(
  tenantId: Types.ObjectId,
  rows: T[],
): Promise<(T & { employee?: ReturnType<typeof employeeRef> })[]> {
  const emps = await Employee.find({
    tenantId,
    _id: { $in: [...new Set(rows.map((r) => r.employeeId))] },
  })
    .select('employeeCode firstName lastName')
    .lean();
  const byId = new Map(emps.map((e) => [String(e._id), employeeRef(e)]));
  return rows.map((r) => ({ ...r, employee: byId.get(r.employeeId) }));
}

export function registerAttendanceRoutes(v1: Router, env: Env, deps: { clock: Clock }): void {
  const chain = [authenticate(env), resolveTenant];
  const needEmployee = (req: Request): Types.ObjectId => {
    if (!req.tenantCtx?.employeeId)
      throw AppError.forbidden('No employee profile is linked to your account');
    return req.tenantCtx.employeeId;
  };

  const sendPunch = (res: import('express').Response, out: PunchOutcome) => {
    if (out.kind === 'EXCEPTION') {
      res.status(202).json({
        success: true,
        data: {
          status: 'PENDING_REVIEW',
          replayed: out.replayed,
          exception: serException(out.exception),
        },
      });
      return;
    }
    res.status(out.replayed ? 200 : 201).json({
      success: true,
      data: {
        replayed: out.replayed,
        event: serEvent(out.event),
        state: out.state,
        allowedActions: allowedActions(out.state),
      },
    });
  };

  registerPhotoRoutes(v1, env, deps);

  const punchRoute = (path: string, type: (typeof EVENT_TYPES)[number], summary: string) =>
    route(
      v1,
      {
        method: 'post',
        path,
        summary,
        tags: ['Attendance'],
        auth: 'tenant',
        permission: 'attendance:punch',
        body: punchBody,
        successStatus: 201,
      },
      ...chain,
      requirePermission('attendance:punch'),
      validate({ body: punchBody }),
      asyncHandler(async (req, res) => {
        const employeeId = needEmployee(req);
        const b = req.body as z.infer<typeof punchBody>;
        const source = req.header('x-client-type') === 'web' ? 'WEB' : 'MOBILE';
        const out = await punch(
          req.tenantCtx!.tenantId,
          employeeId,
          { type, source, ...b },
          deps.clock.now(),
          env,
        );
        if (!out.replayed) {
          // Coordinates are deliberately not written to audit logs (data minimisation).
          await writeAudit(
            req,
            out.kind === 'EXCEPTION'
              ? {
                  action: 'attendance.exception_requested',
                  entityType: 'AttendanceException',
                  entityId: out.exception._id,
                  after: { eventType: type, failure: out.exception.failure },
                }
              : {
                  action: `attendance.${type.toLowerCase()}`,
                  entityType: 'AttendanceEvent',
                  entityId: out.event._id,
                  after: { verification: (out.event.verification as { status: string }).status },
                },
          );
        }
        sendPunch(res, out);
      }),
    );

  punchRoute(
    '/attendance/check-in',
    'CHECK_IN',
    "Check in. Server time is authoritative; GPS is verified against the employee's geofence policy.",
  );
  punchRoute('/attendance/check-out', 'CHECK_OUT', 'Check out.');
  punchRoute('/attendance/break-start', 'BREAK_START', 'Start a break.');
  punchRoute('/attendance/break-end', 'BREAK_END', 'End a break.');

  route(
    v1,
    {
      method: 'get',
      path: '/attendance/me/today',
      summary:
        "Current state, available actions (with reasons when disabled), live totals and today's punches.",
      tags: ['Attendance'],
      auth: 'tenant',
      permission: 'attendance:read:self',
    },
    ...chain,
    requirePermission('attendance:read:self'),
    asyncHandler(async (req, res) => {
      const employeeId = needEmployee(req);
      const tenantId = req.tenantCtx!.tenantId;
      const now = deps.clock.now();
      const tenant = await loadTenant(tenantId);
      const st = await currentState(
        tenantId,
        employeeId,
        now,
        tenant.settings.attendance.maxOpenSessionHours,
      );
      const resolved = st.workDate
        ? { workDate: st.workDate, shift: await shiftForDate(tenantId, employeeId, st.workDate) }
        : await resolveCheckInWorkDate(tenant, employeeId, now);
      const { result, events, correctionStatus } = await computeDay(
        tenant,
        employeeId,
        resolved.workDate,
        now,
      );
      const shift = resolved.shift;
      let shiftInfo;
      if (shift) {
        const tz = (shift.timezone as string | undefined) ?? tenant.timezone;
        const w = shiftWindow(
          resolved.workDate,
          shift as unknown as { startTime: string; endTime: string },
          tz,
        );
        shiftInfo = {
          id: String(shift._id),
          name: shift.name,
          startTime: shift.startTime,
          endTime: shift.endTime,
          timezone: tz,
          overnight: w.overnight,
          start: w.start,
          end: w.end,
          remainingMinutes:
            now >= w.start && now < w.end
              ? Math.floor((w.end.getTime() - now.getTime()) / 60_000)
              : undefined,
        };
      }
      res.json({
        success: true,
        data: {
          workDate: resolved.workDate,
          timezone: shiftInfo?.timezone ?? tenant.timezone,
          state: st.state,
          openSince: st.openSince && !st.stale ? st.openSince : undefined,
          previousSessionIncomplete: st.stale
            ? { workDate: st.staleWorkDate, since: st.openSince }
            : undefined,
          currentSessionMinutes:
            st.state !== 'OFF' && st.openSince
              ? Math.floor((now.getTime() - st.openSince.getTime()) / 60_000)
              : undefined,
          allowedActions: allowedActions(st.state),
          shift: shiftInfo,
          correctionStatus,
          summary: {
            status: result.status,
            firstCheckIn: result.firstCheckIn,
            lastCheckOut: result.lastCheckOut,
            workedMinutes: result.workedMinutes,
            breakMinutes: result.breakMinutes,
            lateMinutes: result.lateMinutes,
            earlyDepartureMinutes: result.earlyDepartureMinutes,
            overtimeMinutes: result.overtimeMinutes,
            scheduledMinutes: result.scheduledMinutes,
            isOpen: result.isOpen,
          },
          photoRequired: tenant.settings.attendance.requirePhoto,
          events: await serOwnEvents(tenantId, events),
          serverTime: now,
        },
      });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/attendance/me/events',
      summary: 'Own punches (including breaks) for a work date, with where they were recorded.',
      tags: ['Attendance'],
      auth: 'tenant',
      permission: 'attendance:read:self',
      query: myEventsQuery,
    },
    ...chain,
    requirePermission('attendance:read:self'),
    validate({ query: myEventsQuery }),
    asyncHandler(async (req, res) => {
      const events = await AttendanceEvent.find({
        tenantId: req.tenantCtx!.tenantId,
        employeeId: needEmployee(req),
        workDate: (req.query as { date: string }).date,
      })
        .sort({ occurredAt: 1, _id: 1 })
        .lean();
      res.json({ success: true, data: await serOwnEvents(req.tenantCtx!.tenantId, events) });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/attendance/me/history',
      summary: 'Own daily attendance history (newest first).',
      tags: ['Attendance'],
      auth: 'tenant',
      permission: 'attendance:read:self',
      query: historyQuery,
    },
    ...chain,
    requirePermission('attendance:read:self'),
    validate({ query: historyQuery }),
    asyncHandler(async (req, res) => {
      const q = req.query as unknown as z.infer<typeof historyQuery>;
      const filter: Record<string, unknown> = {
        tenantId: req.tenantCtx!.tenantId,
        employeeId: needEmployee(req),
      };
      if (q.from || q.to)
        filter.workDate = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
      const [items, total] = await Promise.all([
        AttendanceDay.find(filter)
          .sort({ workDate: -1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
        AttendanceDay.countDocuments(filter),
      ]);
      res.json({
        success: true,
        data: items.map(serDay),
        meta: { page: q.page, limit: q.limit, total },
      });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/attendance/me/exceptions',
      summary: 'Own GPS exception requests and their review status (no coordinates).',
      tags: ['Attendance exceptions'],
      auth: 'tenant',
      permission: 'attendance:read:self',
      query: z.object({ ...paginationQuery }).strict(),
    },
    ...chain,
    requirePermission('attendance:read:self'),
    validate({ query: z.object({ ...paginationQuery }).strict() }),
    asyncHandler(async (req, res) => {
      const q = req.query as unknown as { page: number; limit: number };
      const filter = { tenantId: req.tenantCtx!.tenantId, employeeId: needEmployee(req) };
      const [items, total] = await Promise.all([
        AttendanceException.find(filter)
          .sort({ createdAt: -1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
        AttendanceException.countDocuments(filter),
      ]);
      res.json({
        success: true,
        data: items.map(serException),
        meta: { page: q.page, limit: q.limit, total },
      });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/attendance/days',
      summary:
        "Attendance days across employees within the caller's scope (all / direct reports). Summaries only.",
      tags: ['Attendance'],
      auth: 'tenant',
      permission: 'attendance:read:all | attendance:read:team',
      query: daysQuery,
    },
    ...chain,
    requirePermission('attendance:read:all', 'attendance:read:team'),
    validate({ query: daysQuery }),
    asyncHandler(async (req, res) => {
      const q = req.query as unknown as z.infer<typeof daysQuery>;
      const ctx = req.tenantCtx!;
      const scope = await teamScope(ctx, 'attendance:read:all', 'attendance:read:team');
      let ids: Types.ObjectId[] | undefined = scope;
      if (q.departmentId) {
        const inDept = (
          await Employee.find({ tenantId: ctx.tenantId, departmentId: q.departmentId })
            .select('_id')
            .lean()
        ).map((e) => e._id);
        ids = scope ? inDept.filter((d) => scope.some((s) => String(s) === String(d))) : inDept;
      }
      if (q.employeeId)
        ids =
          !ids || ids.some((i) => String(i) === q.employeeId)
            ? [q.employeeId as unknown as Types.ObjectId]
            : [];
      const filter: Record<string, unknown> = {
        tenantId: ctx.tenantId,
        workDate: { $gte: q.from, $lte: q.to },
        ...(q.status ? { status: q.status } : {}),
        ...(ids ? { employeeId: { $in: ids } } : {}),
      };
      const [items, total] = await Promise.all([
        AttendanceDay.find(filter)
          .sort({ workDate: -1, employeeId: 1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
        AttendanceDay.countDocuments(filter),
      ]);
      const emps = await Employee.find({
        tenantId: ctx.tenantId,
        _id: { $in: [...new Set(items.map((i) => String(i.employeeId)))] },
      })
        .select('employeeCode firstName lastName')
        .lean();
      const byId = new Map(emps.map((e) => [String(e._id), employeeRef(e)]));
      res.json({
        success: true,
        data: items.map((d) => ({ ...serDay(d), employee: byId.get(String(d.employeeId)) })),
        meta: { page: q.page, limit: q.limit, total },
      });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/attendance/days/:id',
      summary:
        "One day with punch-level detail and GPS verification (HR, owner, and the employee's manager).",
      tags: ['Attendance'],
      auth: 'tenant',
      permission: 'attendance:events:read',
    },
    ...chain,
    requirePermission('attendance:events:read'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      const day = await AttendanceDay.findOne({
        _id: req.params.id,
        tenantId: ctx.tenantId,
      }).lean();
      const scope = await teamScope(ctx, 'attendance:review:all', 'attendance:read:team');
      if (!day || (scope && !scope.some((s) => String(s) === String(day.employeeId))))
        throw AppError.notFound('Attendance record not found');
      const [events, corrections, exceptions, emp] = await Promise.all([
        AttendanceEvent.find({
          tenantId: ctx.tenantId,
          employeeId: day.employeeId,
          workDate: day.workDate,
        })
          .sort({ occurredAt: 1, _id: 1 })
          .lean(),
        AttendanceCorrection.find({
          tenantId: ctx.tenantId,
          employeeId: day.employeeId,
          workDate: day.workDate,
        })
          .sort({ createdAt: 1 })
          .lean(),
        AttendanceException.find({
          tenantId: ctx.tenantId,
          employeeId: day.employeeId,
          occurredAt: {
            $gte: new Date(Date.parse(day.workDate) - 86_400_000),
            $lte: new Date(Date.parse(addDays(day.workDate, 2))),
          },
        }).lean(),
        Employee.findOne({ _id: day.employeeId, tenantId: ctx.tenantId })
          .select('employeeCode firstName lastName')
          .lean(),
      ]);
      res.json({
        success: true,
        data: {
          ...serDay(day),
          employee: emp ? employeeRef(emp) : undefined,
          events: events.map((e) => serEvent(e, true)),
          corrections: corrections.map(serCorrection),
          exceptions: exceptions.map(serException),
        },
      });
    }),
  );

  /* ---- corrections ---- */
  route(
    v1,
    {
      method: 'post',
      path: '/attendance/corrections',
      summary:
        "Request a correction of a day's check-in and/or check-out. Original punches are never modified.",
      tags: ['Attendance corrections'],
      auth: 'tenant',
      permission: 'attendance:read:self',
      body: correctionBody,
      successStatus: 201,
    },
    ...chain,
    requirePermission('attendance:read:self'),
    validate({ body: correctionBody }),
    asyncHandler(async (req, res) => {
      const doc = await createCorrection(
        req.tenantCtx!,
        req.auth!.userId,
        req.body,
        deps.clock.now(),
      );
      await writeAudit(req, {
        action: 'attendance.correction_requested',
        entityType: 'AttendanceCorrection',
        entityId: doc._id,
        after: { workDate: doc.workDate, employeeId: doc.employeeId },
      });
      res.status(201).json({ success: true, data: serCorrection(doc.toObject()) });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/attendance/corrections',
      summary:
        'List corrections: own for employees, direct reports for managers, everyone for HR/owner.',
      tags: ['Attendance corrections'],
      auth: 'tenant',
      permission: 'attendance:read:self',
      query: listReviewQuery,
    },
    ...chain,
    requirePermission('attendance:read:self'),
    validate({ query: listReviewQuery }),
    asyncHandler(async (req, res) => {
      const q = req.query as unknown as z.infer<typeof listReviewQuery>;
      const ctx = req.tenantCtx!;
      const scope = await teamScope(ctx, 'attendance:review:all', 'attendance:review:team');
      let ids = scope;
      if (q.employeeId)
        ids =
          !ids || ids.some((i) => String(i) === q.employeeId)
            ? [q.employeeId as unknown as Types.ObjectId]
            : [];
      const filter = {
        tenantId: ctx.tenantId,
        ...(q.status ? { status: q.status } : {}),
        ...(ids ? { employeeId: { $in: ids } } : {}),
      };
      const [items, total] = await Promise.all([
        AttendanceCorrection.find(filter)
          .sort({ createdAt: -1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
        AttendanceCorrection.countDocuments(filter),
      ]);
      res.json({
        success: true,
        data: await withEmployees(ctx.tenantId, items.map(serCorrection)),
        meta: { page: q.page, limit: q.limit, total },
      });
    }),
  );

  const decide = (kind: 'corrections' | 'exceptions', action: 'approve' | 'reject') => {
    const decision = action === 'approve' ? 'APPROVED' : 'REJECTED';
    const body = action === 'approve' ? reviewBody : rejectBody;
    route(
      v1,
      {
        method: 'post',
        path: `/attendance/${kind}/:id/${action}`,
        summary: `${action === 'approve' ? 'Approve' : 'Reject'} a ${kind === 'corrections' ? 'correction' : 'GPS exception'}. Self-review is blocked unless the company enables it.`,
        tags: [kind === 'corrections' ? 'Attendance corrections' : 'Attendance exceptions'],
        auth: 'tenant',
        permission: 'attendance:review:all | attendance:review:team',
        body,
      },
      ...chain,
      requirePermission('attendance:review:all', 'attendance:review:team'),
      validate({ params: idParams, body }),
      asyncHandler(async (req, res) => {
        const id = String(req.params.id);
        const comment = (req.body as { comment?: string }).comment;
        if (kind === 'corrections') {
          const c = await reviewCorrection(
            req.tenantCtx!,
            req.auth!.userId,
            id,
            decision,
            comment,
            deps.clock.now(),
          );
          await writeAudit(req, {
            action: `attendance.correction_${action}d`,
            entityType: 'AttendanceCorrection',
            entityId: id,
            reason: comment,
            after: { status: decision, workDate: c.workDate },
          });
          notifyEmployee(env, req.tenantCtx!.tenantId, c.employeeId, {
            title: `Correction ${decision === 'APPROVED' ? 'approved' : 'rejected'}`,
            body: `Your attendance correction for ${c.workDate} was ${decision.toLowerCase()}.`,
            data: { type: 'correction', id },
          });
          res.json({ success: true, data: serCorrection(c as never) });
        } else {
          const r = await reviewException(
            req.tenantCtx!,
            req.auth!.userId,
            id,
            decision,
            comment,
            deps.clock.now(),
          );
          await writeAudit(req, {
            action: `attendance.exception_${action}d`,
            entityType: 'AttendanceException',
            entityId: id,
            reason: comment,
            after: { status: decision },
          });
          notifyEmployee(env, req.tenantCtx!.tenantId, r.exception.employeeId, {
            title: `Location request ${decision === 'APPROVED' ? 'approved' : 'rejected'}`,
            body: `Your ${decision === 'APPROVED' ? 'punch was recorded' : 'punch request was declined'}.`,
            data: { type: 'exception', id },
          });
          res.json({
            success: true,
            data: {
              exception: serException(r.exception as never),
              event: r.event ? serEvent(r.event.toObject() as never) : null,
            },
          });
        }
      }),
    );
  };
  decide('corrections', 'approve');
  decide('corrections', 'reject');

  route(
    v1,
    {
      method: 'get',
      path: '/attendance/exceptions',
      summary: "List GPS exception requests within the caller's review scope.",
      tags: ['Attendance exceptions'],
      auth: 'tenant',
      permission: 'attendance:review:all | attendance:review:team',
      query: listReviewQuery,
    },
    ...chain,
    requirePermission('attendance:review:all', 'attendance:review:team'),
    validate({ query: listReviewQuery }),
    asyncHandler(async (req, res) => {
      const q = req.query as unknown as z.infer<typeof listReviewQuery>;
      const ctx = req.tenantCtx!;
      const scope = await teamScope(ctx, 'attendance:review:all', 'attendance:review:team');
      let ids = scope;
      if (q.employeeId)
        ids =
          !ids || ids.some((i) => String(i) === q.employeeId)
            ? [q.employeeId as unknown as Types.ObjectId]
            : [];
      const filter = {
        tenantId: ctx.tenantId,
        ...(q.status ? { status: q.status } : {}),
        ...(ids ? { employeeId: { $in: ids } } : {}),
      };
      const [items, total] = await Promise.all([
        AttendanceException.find(filter)
          .sort({ createdAt: -1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
        AttendanceException.countDocuments(filter),
      ]);
      res.json({
        success: true,
        data: await withEmployees(ctx.tenantId, items.map(serException)),
        meta: { page: q.page, limit: q.limit, total },
      });
    }),
  );
  decide('exceptions', 'approve');
  decide('exceptions', 'reject');
}
