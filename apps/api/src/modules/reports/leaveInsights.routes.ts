import type { Router } from 'express';
import { DateTime } from 'luxon';
import type { Types } from 'mongoose';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { Department } from '../../database/models/department.model';
import { Employee } from '../../database/models/employee.model';
import { LeaveRequest } from '../../database/models/leaveRequest.model';
import { LeaveType } from '../../database/models/leaveType.model';
import { authenticate, requirePermission, resolveTenant } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import type { Clock } from '../../utils/clock';
import { route } from '../../utils/route';
import { objectId, validate } from '../../utils/validate';
import { addDays, dayOfWeek, localDate } from '../attendance/dates';
import { loadTenant } from '../attendance/attendance.service';

/** Company-wide leave insights for owners and HR. Read-only. */

const MONTHS = 6;
const NO_LEAVE_MONTHS = 9;
const UNUSED_ALERT_DAYS = 25;
const COVER_ALERT = 0.15; // a team with this share off at once is "crowded"
const APPROVAL_WINDOW_DAYS = 2;
const HORIZON_DAYS = 35;
const REPORTABLE = ['ACTIVE', 'ON_LEAVE', 'NOTICE_PERIOD'];

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const query = z
  .object({ month: z.string().regex(MONTH_RE, 'Use YYYY-MM').optional(), locationId: objectId.optional() })
  .strict();

const shiftMonth = (m: string, n: number) =>
  DateTime.fromISO(`${m}-01`, { zone: 'utc' }).plus({ months: n }).toFormat('yyyy-LL');
const round1 = (n: number) => Math.round(n * 10) / 10;
const weekStart = (d: string) =>
  DateTime.fromISO(d, { zone: 'utc' }).startOf('week').toISODate()!; // Monday

export function registerLeaveInsightRoutes(v1: Router, env: Env, deps: { clock: Clock }): void {
  const chain = [authenticate(env), resolveTenant];
  route(
    v1,
    {
      method: 'get',
      path: '/reports/leave/overview',
      summary:
        'Company leave insights: who is off today and next week, days taken and the unplanned share versus last month, a six-month trend, leave by type, department comparison, coverage risks, unused-leave liability and items needing attention.',
      tags: ['Reports'],
      auth: 'tenant',
      permission: 'leave:read:all',
      query,
    },
    ...chain,
    requirePermission('leave:read:all'),
    validate({ query }),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      const q = req.query as unknown as z.infer<typeof query>;
      const now = deps.clock.now();
      const tenant = await loadTenant(ctx.tenantId);
      const tz = tenant.timezone;
      const today = localDate(now, tz);
      const month = q.month ?? today.slice(0, 7);
      const months = Array.from({ length: MONTHS }, (_, i) => shiftMonth(month, i - (MONTHS - 1)));
      const prev = shiftMonth(month, -1);
      const year = Number(today.slice(0, 4));
      const horizonEnd = addDays(today, HORIZON_DAYS);
      const lookback = addDays(today, -Math.round(NO_LEAVE_MONTHS * 31));
      const firstMonth = `${months[0]}-01`;
      const since = firstMonth < lookback ? firstMonth : lookback;

      const employees = (await Employee.find({
        tenantId: tenant._id,
        employmentStatus: { $in: REPORTABLE },
        ...(q.locationId ? { workLocationIds: q.locationId } : {}),
      })
        .select('departmentId')
        .lean()) as unknown as { _id: Types.ObjectId; departmentId?: Types.ObjectId }[];
      const ids = employees.map((e) => e._id);
      const deptOf = new Map(employees.map((e) => [String(e._id), e.departmentId ? String(e.departmentId) : '']));
      const [types, depts] = await Promise.all([
        LeaveType.find({ tenantId: tenant._id, status: 'ACTIVE' }).sort({ name: 1 }).lean(),
        Department.find({ tenantId: tenant._id }).select('name').lean(),
      ]);
      const typeName = new Map(types.map((t) => [String(t._id), t.name as string]));

      const reqs = await LeaveRequest.find({
        tenantId: tenant._id,
        employeeId: { $in: ids },
        status: { $in: ['APPROVED', 'PENDING'] },
        endDate: { $gte: since },
        startDate: { $lte: horizonEnd },
      })
        .select('employeeId leaveTypeId startDate endDate days status createdAt')
        .lean();
      const approved = reqs.filter((r) => r.status === 'APPROVED');

      // Days are attributed to the month the leave starts in.
      const unplanned = (r: (typeof reqs)[number]) =>
        localDate(r.createdAt as Date, tz) >= r.startDate;
      const monthAgg = new Map(months.map((m) => [m, { days: 0, unplanned: 0 }]));
      const byType = new Map<string, number>();
      let six = 0;
      let sixUnplanned = 0;
      for (const r of approved) {
        const m = r.startDate.slice(0, 7);
        const a = monthAgg.get(m);
        if (!a || r.startDate > today) continue;
        a.days += r.days;
        if (unplanned(r)) a.unplanned += r.days;
        six += r.days;
        if (unplanned(r)) sixUnplanned += r.days;
        const n = typeName.get(String(r.leaveTypeId)) ?? 'Other';
        byType.set(n, (byType.get(n) ?? 0) + r.days);
      }
      const cur = monthAgg.get(month) ?? { days: 0, unplanned: 0 };
      const before = monthAgg.get(prev) ?? { days: 0, unplanned: 0 };
      const share = (a: { days: number; unplanned: number }) => (a.days ? round1((a.unplanned / a.days) * 100) : null);

      // Balances this leave year (approved + pending, as the balance API counts them).
      const used = new Map<string, number>(); // employee|type -> days
      for (const r of reqs) {
        if (Number(r.startDate.slice(0, 4)) !== year || r.startDate > horizonEnd) continue;
        const k = `${r.employeeId}|${r.leaveTypeId}`;
        used.set(k, (used.get(k) ?? 0) + r.days);
      }
      const capped = types.filter((t) => t.annualAllowanceDays > 0);
      const unused = new Map<string, { all: number; paid: number; negative: boolean }>();
      for (const e of employees) {
        let all = 0;
        let paid = 0;
        let negative = false;
        for (const t of capped) {
          const left = t.annualAllowanceDays - (used.get(`${e._id}|${t._id}`) ?? 0);
          if (left < 0) negative = true;
          all += Math.max(0, left);
          if (t.paid) paid += Math.max(0, left);
        }
        unused.set(String(e._id), { all, paid, negative });
      }
      const sum = (f: (u: { all: number; paid: number }) => number) =>
        [...unused.values()].reduce((s, u) => s + f(u), 0);

      // Who is off, day by day, for today and the next five weeks (approved and pending, working days only).
      const off = new Map<string, Set<string>>();
      const offApproved = new Map<string, Set<string>>();
      for (const r of reqs) {
        for (let d = r.startDate < today ? today : r.startDate; d <= r.endDate && d <= horizonEnd; d = addDays(d, 1)) {
          if (!tenant.workweek.includes(dayOfWeek(d))) continue;
          if (!off.has(d)) off.set(d, new Set());
          off.get(d)!.add(String(r.employeeId));
          if (r.status === 'APPROVED') {
            if (!offApproved.has(d)) offApproved.set(d, new Set());
            offApproved.get(d)!.add(String(r.employeeId));
          }
        }
      }
      const next7: { date: string; people: number }[] = [];
      for (let d = today, n = 0; n < 7 && d <= horizonEnd; d = addDays(d, 1)) {
        if (!tenant.workweek.includes(dayOfWeek(d))) continue;
        next7.push({ date: d, people: offApproved.get(d)?.size ?? 0 });
        n++;
      }
      const offToday = offApproved.get(today)?.size ?? 0;

      // Coverage by department and week.
      const deptRows = depts
        .map((d) => {
          const members = employees.filter((e) => String(e.departmentId) === String(d._id));
          return { id: String(d._id), name: d.name as string, members };
        })
        .filter((d) => d.members.length > 0);
      const weeks = new Map<string, Map<string, number>>(); // dept -> weekStart -> peak
      const peak = new Map<string, number>();
      for (const [d, set] of off) {
        const perDept = new Map<string, number>();
        for (const id of set) {
          const dep = deptOf.get(id);
          if (dep) perDept.set(dep, (perDept.get(dep) ?? 0) + 1);
        }
        for (const [dep, n] of perDept) {
          peak.set(dep, Math.max(peak.get(dep) ?? 0, n));
          const w = weekStart(d);
          const m = weeks.get(dep) ?? new Map<string, number>();
          m.set(w, Math.max(m.get(w) ?? 0, n));
          weeks.set(dep, m);
        }
      }
      const coverage = deptRows
        .flatMap((d) =>
          [...(weeks.get(d.id) ?? new Map<string, number>())].map(([w, n]) => ({
            department: d.name,
            weekStart: w,
            off: n,
            headcount: d.members.length,
            pct: Math.round((n / d.members.length) * 100),
          })),
        )
        .filter((c) => c.off / c.headcount >= COVER_ALERT)
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 8);

      const deptDays = (id: string) => {
        let days = 0;
        let un = 0;
        for (const r of approved) {
          if (deptOf.get(String(r.employeeId)) !== id || r.startDate > today || r.startDate < `${months[0]}-01`) continue;
          days += r.days;
          if (unplanned(r)) un += r.days;
        }
        return { days, un };
      };
      const byDepartment = deptRows
        .map((d) => {
          const { days, un } = deptDays(d.id);
          const u = d.members.map((m) => unused.get(String(m._id))?.all ?? 0);
          const p = peak.get(d.id) ?? 0;
          return {
            departmentId: d.id,
            name: d.name,
            headcount: d.members.length,
            daysPerPerson: round1(days / d.members.length),
            unplannedShare: days ? round1((un / days) * 100) : null,
            avgUnused: round1(u.reduce((s, x) => s + x, 0) / d.members.length),
            highUnused: u.filter((x) => x >= UNUSED_ALERT_DAYS).length,
            peakOff: { off: p, headcount: d.members.length, pct: Math.round((p / d.members.length) * 100) },
          };
        })
        .sort((a, b) => b.headcount - a.headcount);

      const recentLeave = new Set(
        approved.filter((r) => r.startDate >= lookback && r.startDate <= today).map((r) => String(r.employeeId)),
      );
      const pastWindow = await LeaveRequest.countDocuments({
        tenantId: tenant._id,
        status: 'PENDING',
        createdAt: { $lt: new Date(now.getTime() - APPROVAL_WINDOW_DAYS * 86_400_000) },
      });
      const crowded = [...new Set(coverage.map((c) => c.department))];
      const typeTotal = [...byType.values()].reduce((s, x) => s + x, 0) || 1;
      const sorted = [...byType].sort((a, b) => b[1] - a[1]);
      const top = sorted.slice(0, 3);
      const other = sorted.slice(3).reduce((s, [, v]) => s + v, 0);

      res.json({
        success: true,
        data: {
          month,
          previousMonth: prev,
          timezone: tz,
          today,
          headcount: employees.length,
          basis:
            'Approved leave, counted in working days against the month it starts. Unplanned means applied on or after the first day of leave.',
          onLeaveToday: { people: offToday, headcount: employees.length },
          next7,
          current: { days: round1(cur.days), unplannedShare: share(cur) },
          previous: { days: round1(before.days), unplannedShare: share(before) },
          daysPerPerson6m: employees.length ? round1(six / employees.length) : 0,
          totalDays6m: round1(six),
          trend: months.map((m) => ({ month: m, days: round1(monthAgg.get(m)?.days ?? 0) })),
          byType: [
            ...top.map(([name, v]) => ({ name, days: round1(v), share: Math.round((v / typeTotal) * 100) })),
            ...(other > 0 ? [{ name: 'Other', days: round1(other), share: Math.round((other / typeTotal) * 100) }] : []),
          ],
          plannedShare: six ? round1(100 - (sixUnplanned / six) * 100) : null,
          unplannedShare6m: six ? round1((sixUnplanned / six) * 100) : null,
          byDepartment,
          coverage,
          liability: {
            unusedDays: round1(sum((u) => u.all)),
            paidUnusedDays: round1(sum((u) => u.paid)),
            avgUnusedPerPerson: employees.length ? round1(sum((u) => u.all) / employees.length) : 0,
          },
          attention: {
            highUnused: { days: UNUSED_ALERT_DAYS, count: [...unused.values()].filter((u) => u.all >= UNUSED_ALERT_DAYS).length },
            noLeave: { months: NO_LEAVE_MONTHS, count: employees.filter((e) => !recentLeave.has(String(e._id))).length },
            pastWindow: { days: APPROVAL_WINDOW_DAYS, count: pastWindow },
            negativeBalances: [...unused.values()].filter((u) => u.negative).length,
            crowdedTeams: { pct: Math.round(COVER_ALERT * 100), names: crowded },
          },
          policy: types.map((t) => ({
            id: String(t._id),
            name: t.name as string,
            code: t.code as string,
            paid: !!t.paid,
            annualAllowanceDays: t.annualAllowanceDays as number,
            allowHalfDay: !!t.allowHalfDay,
          })),
        },
      });
    }),
  );
}
