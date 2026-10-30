import type { Router } from 'express';
import { DateTime } from 'luxon';
import type { Types } from 'mongoose';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { AttendanceCorrection } from '../../database/models/attendanceCorrection.model';
import { AttendanceDay } from '../../database/models/attendanceDay.model';
import { AttendanceException } from '../../database/models/attendanceException.model';
import { Department } from '../../database/models/department.model';
import { Employee } from '../../database/models/employee.model';
import { LeaveRequest } from '../../database/models/leaveRequest.model';
import { PayrollRun } from '../../database/models/payroll.model';
import { WorkLocation } from '../../database/models/workLocation.model';
import { authenticate, requirePermission, resolveTenant } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import type { Clock } from '../../utils/clock';
import { route } from '../../utils/route';
import { objectId, validate } from '../../utils/validate';
import { localDate } from '../attendance/dates';
import { computeDay, loadTenant, type TenantInfo } from '../attendance/attendance.service';
import { ensureDays, type ScopedEmployee } from './reports.service';

/** Company-wide insight endpoints (owner and HR). Everything is read-only. */

const REPORTABLE = ['ACTIVE', 'ON_LEAVE', 'NOTICE_PERIOD'];
const MONTHS = 6;
const LATE_MARK_LIMIT = 3;
const OVERTIME_ALERT_MINUTES = 20 * 60;
const ABSENT_STREAK = 3;
const OVERDUE_DAYS = 3;
const TEAM_RATE_FLOOR = 93;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const overviewQuery = z
  .object({
    month: z.string().regex(MONTH_RE, 'Use YYYY-MM').optional(),
    locationId: objectId.optional(),
  })
  .strict();
const liveQuery = z
  .object({ departmentId: objectId.optional(), locationId: objectId.optional() })
  .strict();

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
const monthOf = (date: string) => date.slice(0, 7);
const monthEnd = (m: string) =>
  DateTime.fromISO(`${m}-01`, { zone: 'utc' }).endOf('month').toISODate()!;
const shiftMonth = (m: string, n: number) =>
  DateTime.fromISO(`${m}-01`, { zone: 'utc' }).plus({ months: n }).toFormat('yyyy-LL');

interface Emp extends ScopedEmployee {
  workLocationIds?: Types.ObjectId[];
}

async function loadEmployees(
  tenantId: Types.ObjectId,
  f: { departmentId?: string; locationId?: string } = {},
): Promise<Emp[]> {
  return Employee.find({
    tenantId,
    employmentStatus: { $in: REPORTABLE },
    ...(f.departmentId ? { departmentId: f.departmentId } : {}),
    ...(f.locationId ? { workLocationIds: f.locationId } : {}),
  })
    .select(
      'employeeCode firstName lastName departmentId workLocationIds joiningDate lastWorkingDate',
    )
    .lean() as unknown as Emp[];
}

type TodayKey = 'PRESENT' | 'LEAVE' | 'ABSENT' | 'NOT_IN' | 'OFF' | 'UNSCHEDULED';

/** Where everyone stands today. Employees with no stored row yet are calculated, as the dashboard does. */
async function liveSnapshot(tenant: TenantInfo, employees: Emp[], now: Date) {
  const today = localDate(now, tenant.timezone);
  const rows = await AttendanceDay.find({
    tenantId: tenant._id,
    employeeId: { $in: employees.map((e) => e._id) },
    workDate: today,
  })
    .select('employeeId status firstCheckIn lateMinutes isOpen')
    .lean();
  const byEmp = new Map(rows.map((r) => [String(r.employeeId), r]));
  const kinds = new Map<string, TodayKey>();
  let late = 0;
  for (const e of employees) {
    const r = byEmp.get(String(e._id));
    let k: TodayKey;
    if (r && (r.firstCheckIn || r.isOpen)) {
      k = 'PRESENT';
      if ((r.lateMinutes ?? 0) > 0) late++;
    } else if (r?.status === 'ON_LEAVE') k = 'LEAVE';
    else if (r?.status === 'ABSENT') k = 'ABSENT';
    else if (r?.status === 'HOLIDAY' || r?.status === 'WEEKLY_OFF') k = 'OFF';
    else {
      const { result, shiftId } = await computeDay(tenant, e._id, today, now);
      if (result.status === 'HOLIDAY' || result.status === 'WEEKLY_OFF') k = 'OFF';
      else if (result.status === 'ON_LEAVE') k = 'LEAVE';
      else k = shiftId ? 'NOT_IN' : 'UNSCHEDULED';
    }
    kinds.set(String(e._id), k);
  }
  const tally = (list: Emp[]) => {
    const c = {
      headcount: list.length,
      present: 0,
      onLeave: 0,
      absent: 0,
      notIn: 0,
      off: 0,
      unscheduled: 0,
    };
    for (const e of list) {
      const k = kinds.get(String(e._id));
      if (k === 'PRESENT') c.present++;
      else if (k === 'LEAVE') c.onLeave++;
      else if (k === 'ABSENT') c.absent++;
      else if (k === 'NOT_IN') c.notIn++;
      else if (k === 'OFF') c.off++;
      else c.unscheduled++;
    }
    return c;
  };
  const total = tally(employees);
  const expected = total.headcount - total.onLeave - total.off - total.unscheduled;
  const deptIds = [...new Set(employees.map((e) => String(e.departmentId ?? '')).filter(Boolean))];
  const depts = await Department.find({ tenantId: tenant._id, _id: { $in: deptIds } })
    .select('name')
    .lean();
  const byDepartment = depts
    .map((d) => ({
      departmentId: String(d._id),
      name: d.name as string,
      ...tally(employees.filter((e) => String(e.departmentId) === String(d._id))),
    }))
    .sort((a, b) => b.headcount - a.headcount);
  return {
    workDate: today,
    ...total,
    expected,
    rate: pct(total.present, expected),
    lateToday: late,
    byDepartment,
  };
}

interface Agg {
  present: number;
  half: number;
  absent: number;
  incomplete: number;
  lateDays: number;
  workedMinutes: number;
  workedDays: number;
  overtimeMinutes: number;
}
const zero = (): Agg => ({
  present: 0,
  half: 0,
  absent: 0,
  incomplete: 0,
  lateDays: 0,
  workedMinutes: 0,
  workedDays: 0,
  overtimeMinutes: 0,
});
const add = (a: Agg, b: Agg) => {
  for (const k of Object.keys(a) as (keyof Agg)[]) a[k] += b[k];
  return a;
};
/** Days the person was expected to work, excluding leave, holidays and weekly offs. */
const expectedDays = (a: Agg) => a.present + a.half + a.absent + a.incomplete;
const metrics = (a: Agg) => ({
  attendanceRate: pct(a.present + a.half * 0.5, expectedDays(a)),
  absenteeism: pct(a.absent, expectedDays(a)),
  lateRate: pct(a.lateDays, a.present + a.half),
  avgNetMinutes: a.workedDays ? Math.round(a.workedMinutes / a.workedDays) : null,
  overtimeMinutes: a.overtimeMinutes,
});

export function registerInsightRoutes(v1: Router, env: Env, deps: { clock: Clock }): void {
  const chain = [authenticate(env), resolveTenant];

  route(
    v1,
    {
      method: 'get',
      path: '/reports/attendance/live',
      summary:
        'Where everyone stands right now: headcount, present, on leave, absent and not yet in, in total and by department. Company-wide.',
      tags: ['Reports'],
      auth: 'tenant',
      permission: 'attendance:read:all',
      query: liveQuery,
    },
    ...chain,
    requirePermission('attendance:read:all'),
    validate({ query: liveQuery }),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      const q = req.query as unknown as z.infer<typeof liveQuery>;
      const tenant = await loadTenant(ctx.tenantId);
      const employees = await loadEmployees(ctx.tenantId, q);
      res.json({ success: true, data: await liveSnapshot(tenant, employees, deps.clock.now()) });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/reports/attendance/overview',
      summary:
        'Company insights for one month: rates versus the previous month, a six-month trend, absenteeism by weekday, department and location comparison, and items needing attention. Based on stored attendance days.',
      tags: ['Reports'],
      auth: 'tenant',
      permission: 'attendance:read:all',
      query: overviewQuery,
    },
    ...chain,
    requirePermission('attendance:read:all'),
    validate({ query: overviewQuery }),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      const q = req.query as unknown as z.infer<typeof overviewQuery>;
      const now = deps.clock.now();
      const tenant = await loadTenant(ctx.tenantId);
      const today = localDate(now, tenant.timezone);
      const month = q.month ?? monthOf(today);
      const months = Array.from({ length: MONTHS }, (_, i) => shiftMonth(month, i - (MONTHS - 1)));
      const from = `${months[0]}-01`;
      const to = monthEnd(month) < today ? monthEnd(month) : today;
      const employees = await loadEmployees(ctx.tenantId, { locationId: q.locationId });
      const ids = employees.map((e) => e._id);

      // Absences are only stored once calculated; do it for the month being viewed (best effort).
      try {
        await ensureDays(tenant, employees, `${month}-01`, to, now);
      } catch {
        /* range too large: report what is stored */
      }

      const grouped = await AttendanceDay.aggregate<{
        _id: { e: Types.ObjectId; m: string };
        present: number;
        half: number;
        absent: number;
        incomplete: number;
        lateDays: number;
        workedMinutes: number;
        workedDays: number;
        overtimeMinutes: number;
      }>([
        {
          $match: {
            tenantId: tenant._id,
            employeeId: { $in: ids },
            workDate: { $gte: from, $lte: to },
          },
        },
        {
          $group: {
            _id: { e: '$employeeId', m: { $substrBytes: ['$workDate', 0, 7] } },
            present: { $sum: { $cond: [{ $eq: ['$status', 'PRESENT'] }, 1, 0] } },
            half: { $sum: { $cond: [{ $eq: ['$status', 'HALF_DAY'] }, 1, 0] } },
            absent: { $sum: { $cond: [{ $eq: ['$status', 'ABSENT'] }, 1, 0] } },
            incomplete: { $sum: { $cond: [{ $eq: ['$status', 'INCOMPLETE'] }, 1, 0] } },
            lateDays: { $sum: { $cond: [{ $gt: ['$lateMinutes', 0] }, 1, 0] } },
            workedMinutes: { $sum: '$workedMinutes' },
            workedDays: { $sum: { $cond: [{ $gt: ['$workedMinutes', 0] }, 1, 0] } },
            overtimeMinutes: { $sum: '$overtimeMinutes' },
          },
        },
      ]);
      const perEmpMonth = new Map<string, Agg>();
      const perMonth = new Map<string, Agg>(months.map((m) => [m, zero()]));
      for (const g of grouped) {
        const a: Agg = {
          present: g.present,
          half: g.half,
          absent: g.absent,
          incomplete: g.incomplete,
          lateDays: g.lateDays,
          workedMinutes: g.workedMinutes,
          workedDays: g.workedDays,
          overtimeMinutes: g.overtimeMinutes,
        };
        perEmpMonth.set(`${g._id.e}|${g._id.m}`, a);
        add(perMonth.get(g._id.m) ?? zero(), a);
      }
      const prev = shiftMonth(month, -1);
      const cur = metrics(perMonth.get(month) ?? zero());
      const before = metrics(perMonth.get(prev) ?? zero());

      const forEmp = (e: Emp, m = month) => perEmpMonth.get(`${e._id}|${m}`) ?? zero();
      const rollup = (list: Emp[]) =>
        metrics(list.reduce((s, e) => add(s, { ...forEmp(e) }), zero()));

      const depts = await Department.find({ tenantId: tenant._id }).select('name').lean();
      const byDepartment = depts
        .map((d) => {
          const list = employees.filter((e) => String(e.departmentId) === String(d._id));
          return {
            departmentId: String(d._id),
            name: d.name as string,
            headcount: list.length,
            ...rollup(list),
          };
        })
        .filter((d) => d.headcount > 0)
        .sort((a, b) => (b.attendanceRate ?? -1) - (a.attendanceRate ?? -1));

      const locs = await WorkLocation.find({ tenantId: tenant._id }).select('name status').lean();
      const firstLoc = (e: Emp) => (e.workLocationIds?.length ? String(e.workLocationIds[0]) : '');
      const byLocation = [
        ...locs.map((l) => ({ locationId: String(l._id), name: l.name as string })),
        { locationId: '', name: 'No location assigned' },
      ]
        .map((l) => {
          const list = employees.filter((e) => firstLoc(e) === l.locationId);
          return { ...l, headcount: list.length, attendanceRate: rollup(list).attendanceRate };
        })
        .filter((l) => l.headcount > 0)
        .sort((a, b) => (b.attendanceRate ?? -1) - (a.attendanceRate ?? -1));

      // Absenteeism by weekday for the month being viewed.
      const dayRows = await AttendanceDay.aggregate<{
        _id: string;
        absent: number;
        expected: number;
      }>([
        {
          $match: {
            tenantId: tenant._id,
            employeeId: { $in: ids },
            workDate: { $gte: `${month}-01`, $lte: to },
          },
        },
        {
          $group: {
            _id: '$workDate',
            absent: { $sum: { $cond: [{ $eq: ['$status', 'ABSENT'] }, 1, 0] } },
            expected: {
              $sum: {
                $cond: [
                  { $in: ['$status', ['PRESENT', 'HALF_DAY', 'ABSENT', 'INCOMPLETE']] },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]);
      const wd = Array.from({ length: 7 }, () => ({ absent: 0, expected: 0 }));
      for (const r of dayRows) {
        const i = DateTime.fromISO(r._id, { zone: 'utc' }).weekday % 7;
        wd[i]!.absent += r.absent;
        wd[i]!.expected += r.expected;
      }
      const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const weekday = wd
        .map((w, i) => ({
          day: WEEKDAYS[i]!,
          dayIndex: i,
          absenteeism: pct(w.absent, w.expected),
          expected: w.expected,
        }))
        .filter((w) => w.expected > 0);

      // Needs attention.
      const absentDays = await AttendanceDay.find({
        tenantId: tenant._id,
        employeeId: { $in: ids },
        workDate: { $gte: `${month}-01`, $lte: to },
        status: { $in: ['ABSENT', 'PRESENT', 'HALF_DAY', 'ON_LEAVE', 'INCOMPLETE'] },
      })
        .select('employeeId workDate status')
        .sort({ employeeId: 1, workDate: 1 })
        .lean();
      const streakers = new Set<string>();
      let run = 0;
      let runEmp = '';
      for (const d of absentDays) {
        const e = String(d.employeeId);
        if (e !== runEmp) {
          runEmp = e;
          run = 0;
        }
        if (d.status === 'ABSENT') {
          run++;
          if (run >= ABSENT_STREAK) streakers.add(e);
        } else run = 0;
      }
      const overdueBefore = new Date(now.getTime() - OVERDUE_DAYS * 86_400_000);
      const [corr, exc, leave] = await Promise.all([
        AttendanceCorrection.countDocuments({
          tenantId: tenant._id,
          status: 'PENDING',
          createdAt: { $lt: overdueBefore },
        }),
        AttendanceException.countDocuments({
          tenantId: tenant._id,
          status: 'PENDING',
          createdAt: { $lt: overdueBefore },
        }),
        LeaveRequest.countDocuments({
          tenantId: tenant._id,
          status: 'PENDING',
          createdAt: { $lt: overdueBefore },
        }),
      ]);
      const attention = {
        lateMarkLimit: {
          limit: LATE_MARK_LIMIT,
          count: employees.filter((e) => forEmp(e).lateDays >= LATE_MARK_LIMIT).length,
        },
        absentStreak: { days: ABSENT_STREAK, count: streakers.size },
        highOvertime: {
          hours: OVERTIME_ALERT_MINUTES / 60,
          count: employees.filter((e) => forEmp(e).overtimeMinutes >= OVERTIME_ALERT_MINUTES)
            .length,
        },
        overdueApprovals: { days: OVERDUE_DAYS, count: corr + exc + leave },
        teamsBelowFloor: {
          floor: TEAM_RATE_FLOOR,
          names: byDepartment
            .filter((d) => d.attendanceRate !== null && d.attendanceRate < TEAM_RATE_FLOOR)
            .map((d) => d.name),
        },
      };

      // Compliance facts we can verify from data.
      const [lastRun, thisRun, manualEdits, openExceptions] = await Promise.all([
        PayrollRun.findOne({ tenantId: tenant._id, month: prev }).select('status').lean(),
        PayrollRun.findOne({ tenantId: tenant._id, month }).select('status').lean(),
        AttendanceCorrection.countDocuments({
          tenantId: tenant._id,
          status: 'APPROVED',
          reviewedAt: {
            $gte: new Date(`${month}-01T00:00:00Z`),
            $lte: new Date(`${monthEnd(month)}T23:59:59Z`),
          },
        }),
        AttendanceException.countDocuments({ tenantId: tenant._id, status: 'PENDING' }),
      ]);
      const activeLocs = locs.filter((l) => l.status === 'ACTIVE').length;

      const live = await liveSnapshot(
        tenant,
        await loadEmployees(ctx.tenantId, { locationId: q.locationId }),
        now,
      );
      res.json({
        success: true,
        data: {
          month,
          previousMonth: prev,
          timezone: tenant.timezone,
          headcount: employees.length,
          locations: activeLocs,
          basis: 'Stored attendance days; absences are calculated for the month being viewed.',
          live,
          current: cur,
          previous: before,
          trend: months.map((m) => ({
            month: m,
            attendanceRate: metrics(perMonth.get(m) ?? zero()).attendanceRate,
          })),
          weekday,
          byDepartment,
          byLocation,
          attention,
          compliance: {
            previousMonthPayroll: lastRun ? (lastRun.status as string) : null,
            currentMonthPayroll: thisRun ? (thisRun.status as string) : null,
            geofenceRequired: !!tenant.settings.attendance.requireGeofence,
            activeLocations: activeLocs,
            manualEditsApproved: manualEdits,
            openLocationExceptions: openExceptions,
          },
        },
      });
    }),
  );
}
