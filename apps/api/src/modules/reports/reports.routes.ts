import type { Router } from 'express';
import { DateTime } from 'luxon';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { AttendanceCorrection } from '../../database/models/attendanceCorrection.model';
import { AttendanceDay } from '../../database/models/attendanceDay.model';
import { AttendanceException } from '../../database/models/attendanceException.model';
import { Department } from '../../database/models/department.model';
import { authenticate, requirePermission, resolveTenant } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import type { Clock } from '../../utils/clock';
import { toCsv, type CsvCell } from '../../utils/csv';
import { route } from '../../utils/route';
import { objectId, paginationQuery, validate } from '../../utils/validate';
import { writeAudit } from '../audit/audit.service';
import { hasPermission } from '../auth/permissions';
import { addDays, isRealDate, localDate, WORK_DATE_RE } from '../attendance/dates';
import { computeDay, loadTenant } from '../attendance/attendance.service';
import { approvalScope, teamScope } from '../attendance/review.service';
import { buildSummary, ensureDays, scopedEmployees } from './reports.service';

const date = z
  .string()
  .regex(WORK_DATE_RE, 'Use YYYY-MM-DD')
  .refine(isRealDate, 'Invalid calendar date');
const MAX_DAYS = 93;
const inRange = (q: { from: string; to: string }) => q.to >= q.from;
const withinLimit = (q: { from: string; to: string }) =>
  Date.parse(q.to) - Date.parse(q.from) <= (MAX_DAYS - 1) * 86_400_000;

const rangeBase = {
  from: date,
  to: date,
  departmentId: objectId.optional(),
  employeeId: objectId.optional(),
};
const summaryQuery = z
  .object({ ...rangeBase, ...paginationQuery })
  .strict()
  .refine(inRange, 'to is before from')
  .refine(withinLimit, `Date range cannot exceed ${MAX_DAYS} days`);
const exportQuery = z
  .object({ ...rangeBase, type: z.enum(['summary', 'daily']).default('summary') })
  .strict()
  .refine(inRange, 'to is before from')
  .refine(withinLimit, `Date range cannot exceed ${MAX_DAYS} days`);

const TREND_DAYS = 14;
const MAX_EXPORT_ROWS = 50_000;

export function registerReportRoutes(v1: Router, env: Env, deps: { clock: Clock }): void {
  const chain = [authenticate(env), resolveTenant];
  const perm = ['attendance:read:all', 'attendance:read:team'] as const;

  route(
    v1,
    {
      method: 'get',
      path: '/reports/dashboard',
      summary:
        "Today's attendance overview, a 14-day trend and pending approvals, limited to the caller's scope (everyone, or self + direct reports).",
      tags: ['Reports'],
      auth: 'tenant',
      permission: 'attendance:read:all | attendance:read:team',
    },
    ...chain,
    requirePermission(...perm),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      const now = deps.clock.now();
      const tenant = await loadTenant(ctx.tenantId);
      const today = localDate(now, tenant.timezone);
      const scope = await teamScope(ctx, 'attendance:read:all', 'attendance:read:team');
      const employees = await scopedEmployees(ctx.tenantId, scope);
      const ids = employees.map((e) => e._id);
      const trendFrom = addDays(today, -(TREND_DAYS - 1));

      await ensureDays(tenant, employees, trendFrom, addDays(today, -1), now);

      const rows = await AttendanceDay.find({
        tenantId: ctx.tenantId,
        employeeId: { $in: ids },
        workDate: { $gte: trendFrom, $lte: today },
      })
        .select('employeeId workDate status lateMinutes isOpen')
        .lean();

      const todayRows = rows.filter((r) => r.workDate === today);
      const counts = {
        present: 0,
        halfDay: 0,
        absent: 0,
        onLeave: 0,
        holiday: 0,
        weeklyOff: 0,
        incomplete: 0,
        workingNow: 0,
        lateToday: 0,
        notYetIn: 0,
        unscheduled: 0,
      };
      const key = {
        PRESENT: 'present',
        HALF_DAY: 'halfDay',
        ABSENT: 'absent',
        ON_LEAVE: 'onLeave',
        HOLIDAY: 'holiday',
        WEEKLY_OFF: 'weeklyOff',
        INCOMPLETE: 'incomplete',
      } as const;
      for (const r of todayRows) {
        counts[key[r.status]]++;
        if (r.isOpen) counts.workingNow++;
        if ((r.lateMinutes ?? 0) > 0) counts.lateToday++;
      }
      const seen = new Set(todayRows.map((r) => String(r.employeeId)));
      for (const e of employees) {
        if (seen.has(String(e._id))) continue;
        const { result, shiftId } = await computeDay(tenant, e._id, today, now);
        if (result.status === 'HOLIDAY') counts.holiday++;
        else if (result.status === 'WEEKLY_OFF') counts.weeklyOff++;
        else if (result.status === 'ON_LEAVE') counts.onLeave++;
        else if (!shiftId) counts.unscheduled++;
        else counts.notYetIn++;
      }

      const trend = Array.from({ length: TREND_DAYS }, (_, i) => {
        const d = addDays(trendFrom, i);
        const day = rows.filter((r) => r.workDate === d);
        return {
          date: d,
          present: day.filter((r) => r.status === 'PRESENT').length,
          halfDay: day.filter((r) => r.status === 'HALF_DAY').length,
          absent: day.filter((r) => r.status === 'ABSENT').length,
          late: day.filter((r) => (r.lateMinutes ?? 0) > 0).length,
        };
      });

      let pending: { corrections: number; exceptions: number } | null = null;
      if (
        hasPermission(ctx, 'attendance:review:all') ||
        hasPermission(ctx, 'attendance:review:team')
      ) {
        const rscope = await approvalScope(ctx);
        // A reviewer cannot approve their own request, so those are not "waiting on them".
        const ownerFilter = rscope
          ? { employeeId: { $in: rscope.filter((i) => String(i) !== String(ctx.employeeId)) } }
          : {};
        const f = { tenantId: ctx.tenantId, status: 'PENDING', ...ownerFilter };
        const [corrections, exceptions] = await Promise.all([
          AttendanceCorrection.countDocuments(f),
          AttendanceException.countDocuments(f),
        ]);
        pending = { corrections, exceptions };
      }

      res.json({
        success: true,
        data: {
          workDate: today,
          timezone: tenant.timezone,
          scope: scope ? 'TEAM' : 'ALL',
          headcount: employees.length,
          today: counts,
          trend,
          pending,
        },
      });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/reports/attendance/summary',
      summary:
        "Per-employee attendance totals for a date range (max 93 days) within the caller's scope. Missing past days are calculated on demand.",
      tags: ['Reports'],
      auth: 'tenant',
      permission: 'attendance:read:all | attendance:read:team',
      query: summaryQuery,
    },
    ...chain,
    requirePermission(...perm),
    validate({ query: summaryQuery }),
    asyncHandler(async (req, res) => {
      const q = req.query as unknown as z.infer<typeof summaryQuery>;
      const ctx = req.tenantCtx!;
      const tenant = await loadTenant(ctx.tenantId);
      const scope = await teamScope(ctx, 'attendance:read:all', 'attendance:read:team');
      const all = await scopedEmployees(ctx.tenantId, scope, q);
      const page = all.slice((q.page - 1) * q.limit, q.page * q.limit);
      await ensureDays(tenant, page, q.from, q.to, deps.clock.now());
      res.json({
        success: true,
        data: await buildSummary(tenant, page, q.from, q.to),
        meta: { page: q.page, limit: q.limit, total: all.length },
      });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/reports/attendance/export',
      summary:
        'Download attendance as CSV (type=summary or daily). Same scope as the on-screen reports; every export is audit-logged. Cells that could run as spreadsheet formulas are neutralised.',
      tags: ['Reports'],
      auth: 'tenant',
      permission: 'attendance:read:all | attendance:read:team',
      query: exportQuery,
    },
    ...chain,
    requirePermission(...perm),
    validate({ query: exportQuery }),
    asyncHandler(async (req, res) => {
      const q = req.query as unknown as z.infer<typeof exportQuery>;
      const ctx = req.tenantCtx!;
      const now = deps.clock.now();
      const tenant = await loadTenant(ctx.tenantId);
      const scope = await teamScope(ctx, 'attendance:read:all', 'attendance:read:team');
      const employees = await scopedEmployees(ctx.tenantId, scope, q);
      await ensureDays(tenant, employees, q.from, q.to, now);

      let header: string[];
      let rows: CsvCell[][];
      if (q.type === 'summary') {
        header = [
          'Employee code',
          'Employee',
          'Department',
          'Present',
          'Half day',
          'Absent',
          'On leave',
          'Holiday',
          'Weekly off',
          'Incomplete',
          'Late days',
          'Late minutes',
          'Early departure days',
          'Worked minutes',
          'Overtime minutes',
        ];
        rows = (await buildSummary(tenant, employees, q.from, q.to)).map((r) => [
          r.employeeCode,
          r.name,
          r.department,
          r.present,
          r.halfDay,
          r.absent,
          r.onLeave,
          r.holiday,
          r.weeklyOff,
          r.incomplete,
          r.lateDays,
          r.lateMinutes,
          r.earlyDepartureDays,
          r.workedMinutes,
          r.overtimeMinutes,
        ]);
      } else {
        const days = await AttendanceDay.find({
          tenantId: ctx.tenantId,
          employeeId: { $in: employees.map((e) => e._id) },
          workDate: { $gte: q.from, $lte: q.to },
        })
          .sort({ workDate: 1, employeeId: 1 })
          .limit(MAX_EXPORT_ROWS + 1)
          .lean();
        if (days.length > MAX_EXPORT_ROWS)
          return void res.status(422).json({
            success: false,
            error: {
              code: 'RANGE_TOO_LARGE',
              message: 'Too many rows. Choose a shorter range or filter by department.',
            },
            requestId: req.id,
          });
        const emp = new Map(employees.map((e) => [String(e._id), e]));
        const depts = new Map(
          (await Department.find({ tenantId: ctx.tenantId }).select('name').lean()).map((d) => [
            String(d._id),
            d.name,
          ]),
        );
        const hhmm = (d?: Date | null) =>
          d ? DateTime.fromJSDate(d, { zone: tenant.timezone }).toFormat('HH:mm') : '';
        header = [
          'Date',
          'Employee code',
          'Employee',
          'Department',
          'Status',
          'First in',
          'Last out',
          'Worked minutes',
          'Break minutes',
          'Late minutes',
          'Early departure minutes',
          'Overtime minutes',
          'Correction',
        ];
        rows = days.map((d) => {
          const e = emp.get(String(d.employeeId));
          return [
            d.workDate,
            e?.employeeCode,
            e ? `${e.firstName} ${e.lastName}`.trim() : '',
            e?.departmentId ? depts.get(String(e.departmentId)) : '',
            d.status,
            hhmm(d.firstCheckIn),
            hhmm(d.lastCheckOut),
            d.workedMinutes,
            d.breakMinutes,
            d.lateMinutes,
            d.earlyDepartureMinutes,
            d.overtimeMinutes,
            d.correctionStatus,
          ];
        });
      }
      await writeAudit(req, {
        action: 'report.exported',
        entityType: 'Report',
        after: {
          type: q.type,
          from: q.from,
          to: q.to,
          rows: rows.length,
          scope: scope ? 'TEAM' : 'ALL',
        },
      });
      res
        .status(200)
        .set({
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="attendance-${q.type}_${q.from}_${q.to}.csv"`,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        })
        .send(toCsv(header, rows));
    }),
  );
}
