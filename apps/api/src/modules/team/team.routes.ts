import { Department } from '../../database/models/department.model';
import { AttendanceEvent } from '../../database/models/attendanceEvent.model';
import { Employee } from '../../database/models/employee.model';
import { LeaveRequest } from '../../database/models/leaveRequest.model';
import { authenticate, requirePermission, resolveTenant } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import type { Clock } from '../../utils/clock';
import { route } from '../../utils/route';
import { loadTenant } from '../attendance/attendance.service';
import { localDate } from '../attendance/dates';
import { teamScope } from '../attendance/review.service';

type TeamStatus = 'WORKING' | 'ON_BREAK' | 'CHECKED_OUT' | 'ON_LEAVE' | 'NOT_IN';

export function registerTeamRoutes(
  v1: import('express').Router,
  env: import('../../config/env').Env,
  deps: { clock: Clock },
): void {
  const chain = [authenticate(env), resolveTenant];
  route(
    v1,
    {
      method: 'get',
      path: '/team/today',
      summary:
        'Who is in today. Managers see their direct reports; HR/owner see everyone. Status only: no locations, photos or times.',
      tags: ['Team'],
      auth: 'tenant',
      permission: 'attendance:read:all | attendance:read:team',
    },
    ...chain,
    requirePermission('attendance:read:all', 'attendance:read:team'),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      const now = deps.clock.now();
      const tenant = await loadTenant(ctx.tenantId);
      const today = localDate(now, tenant.timezone);
      const scope = await teamScope(ctx, 'attendance:read:all', 'attendance:read:team');
      const q: Record<string, unknown> = {
        tenantId: ctx.tenantId,
        employmentStatus: { $in: ['ACTIVE', 'ON_LEAVE', 'NOTICE_PERIOD'] },
      };
      if (scope) q._id = { $in: scope.filter((s) => String(s) !== String(ctx.employeeId)) };
      else if (ctx.employeeId) q._id = { $ne: ctx.employeeId };
      const emps = await Employee.find(q)
        .select(
          'employeeCode firstName lastName designation departmentId phone workEmail managerId',
        )
        .sort({ firstName: 1, lastName: 1 })
        .limit(500)
        .lean();
      const ids = emps.map((e) => e._id);
      const [events, leaves, depts] = await Promise.all([
        AttendanceEvent.find({
          tenantId: ctx.tenantId,
          employeeId: { $in: ids },
          occurredAt: { $gte: new Date(now.getTime() - 20 * 3_600_000) },
        })
          .sort({ occurredAt: -1, _id: -1 })
          .select('employeeId eventType')
          .lean(),
        LeaveRequest.find({
          tenantId: ctx.tenantId,
          employeeId: { $in: ids },
          status: 'APPROVED',
          startDate: { $lte: today },
          endDate: { $gte: today },
        })
          .select('employeeId')
          .lean(),
        Department.find({ tenantId: ctx.tenantId }).select('name').lean(),
      ]);
      const last = new Map<string, string>();
      for (const e of events)
        if (!last.has(String(e.employeeId))) last.set(String(e.employeeId), e.eventType);
      const onLeave = new Set(leaves.map((l) => String(l.employeeId)));
      const dn = new Map(depts.map((d) => [String(d._id), d.name as string]));
      const statusOf = (id: string): TeamStatus => {
        const ev = last.get(id);
        if (ev === 'CHECK_IN' || ev === 'BREAK_END') return 'WORKING';
        if (ev === 'BREAK_START') return 'ON_BREAK';
        if (onLeave.has(id)) return 'ON_LEAVE';
        return ev === 'CHECK_OUT' ? 'CHECKED_OUT' : 'NOT_IN';
      };
      const members = emps.map((e) => ({
        id: String(e._id),
        employeeCode: e.employeeCode,
        name: `${e.firstName} ${e.lastName}`,
        designation: e.designation,
        department: e.departmentId ? dn.get(String(e.departmentId)) : undefined,
        phone: e.phone,
        email: e.workEmail,
        status: statusOf(String(e._id)),
      }));
      const counts: Record<TeamStatus, number> = {
        WORKING: 0,
        ON_BREAK: 0,
        CHECKED_OUT: 0,
        ON_LEAVE: 0,
        NOT_IN: 0,
      };
      for (const m of members) counts[m.status] += 1;
      res.json({ success: true, data: { date: today, counts, members } });
    }),
  );
}
