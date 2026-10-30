import { DateTime } from 'luxon';
import type { Types } from 'mongoose';
import { AttendanceDay } from '../../database/models/attendanceDay.model';
import { Department } from '../../database/models/department.model';
import { ENDED_STATUSES, Employee } from '../../database/models/employee.model';
import { AppError } from '../../utils/errors';
import { addDays, localDate } from '../attendance/dates';
import { computeDay, type TenantInfo } from '../attendance/attendance.service';

/** Employees counted in reports: anyone who is not just an unaccepted invite. */
const REPORTABLE = ['ACTIVE', 'ON_LEAVE', 'NOTICE_PERIOD', ...ENDED_STATUSES];
const MAX_MISSING_DAYS = 4000;

export interface ScopedEmployee {
  _id: Types.ObjectId;
  employeeCode: string;
  firstName: string;
  lastName: string;
  departmentId?: Types.ObjectId;
  joiningDate?: Date;
  lastWorkingDate?: Date;
}

export async function scopedEmployees(
  tenantId: Types.ObjectId,
  scope: Types.ObjectId[] | undefined,
  filter: { departmentId?: string; employeeId?: string } = {},
): Promise<ScopedEmployee[]> {
  const q: Record<string, unknown> = {
    tenantId,
    employmentStatus: { $in: REPORTABLE },
    ...(filter.departmentId ? { departmentId: filter.departmentId } : {}),
  };
  const ids = scope ? scope.map(String) : undefined;
  if (filter.employeeId) {
    if (ids && !ids.includes(filter.employeeId)) return [];
    q._id = filter.employeeId;
  } else if (ids) q._id = { $in: ids };
  return Employee.find(q)
    .select('employeeCode firstName lastName departmentId joiningDate lastWorkingDate')
    .sort({ employeeCode: 1 })
    .lean() as unknown as ScopedEmployee[];
}

const isoDay = (d?: Date) => (d ? DateTime.fromJSDate(d, { zone: 'utc' }).toISODate()! : undefined);
const isDuplicateKey = (e: unknown) => (e as { code?: number })?.code === 11000;

/**
 * Past working days with no punches have no stored row until something calculates them (a nightly job
 * arrives in Phase 6). Reports must not silently miss absences, so they materialise the missing past
 * days here. This is idempotent (same inputs -> same row), never touches today, and skips days where the
 * employee had no shift and no punches (an unscheduled person is not "absent").
 */
export async function ensureDays(
  tenant: TenantInfo,
  employees: ScopedEmployee[],
  from: string,
  to: string,
  now: Date,
): Promise<void> {
  const today = localDate(now, tenant.timezone);
  const last = to < today ? to : addDays(today, -1);
  if (last < from || employees.length === 0) return;

  const existing = await AttendanceDay.find({
    tenantId: tenant._id,
    employeeId: { $in: employees.map((e) => e._id) },
    workDate: { $gte: from, $lte: last },
  })
    .select('employeeId workDate')
    .lean();
  const have = new Set(existing.map((d) => `${d.employeeId}|${d.workDate}`));

  const missing: { emp: ScopedEmployee; date: string }[] = [];
  for (const emp of employees) {
    const start = isoDay(emp.joiningDate);
    const end = isoDay(emp.lastWorkingDate);
    for (let d = from; d <= last; d = addDays(d, 1)) {
      if ((start && d < start) || (end && d > end)) continue;
      if (!have.has(`${emp._id}|${d}`)) missing.push({ emp, date: d });
    }
  }
  if (missing.length > MAX_MISSING_DAYS)
    throw new AppError(
      422,
      'RANGE_TOO_LARGE',
      'That range needs too many days calculated at once. Choose a shorter range or fewer employees.',
    );

  for (const { emp, date } of missing) {
    const { result, shiftId, correctionStatus } = await computeDay(tenant, emp._id, date, now);
    if (result.status === null) continue;
    if (!shiftId && result.status === 'ABSENT') continue; // unscheduled, not absent
    const { status, ...rest } = result;
    try {
      await AttendanceDay.updateOne(
        { tenantId: tenant._id, employeeId: emp._id, workDate: date },
        { $setOnInsert: { ...rest, status, shiftId, correctionStatus } },
        { upsert: true },
      );
    } catch (e) {
      if (!isDuplicateKey(e)) throw e; // another request materialised it first
    }
  }
}

export interface SummaryRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  department?: string;
  present: number;
  halfDay: number;
  absent: number;
  onLeave: number;
  holiday: number;
  weeklyOff: number;
  incomplete: number;
  lateDays: number;
  lateMinutes: number;
  earlyDepartureDays: number;
  workedMinutes: number;
  overtimeMinutes: number;
}

export async function buildSummary(
  tenant: TenantInfo,
  employees: ScopedEmployee[],
  from: string,
  to: string,
): Promise<SummaryRow[]> {
  const days = await AttendanceDay.aggregate<{
    _id: Types.ObjectId;
    present: number;
    halfDay: number;
    absent: number;
    onLeave: number;
    holiday: number;
    weeklyOff: number;
    incomplete: number;
    lateDays: number;
    lateMinutes: number;
    earlyDepartureDays: number;
    workedMinutes: number;
    overtimeMinutes: number;
  }>([
    {
      $match: {
        tenantId: tenant._id,
        employeeId: { $in: employees.map((e) => e._id) },
        workDate: { $gte: from, $lte: to },
      },
    },
    {
      $group: {
        _id: '$employeeId',
        present: { $sum: { $cond: [{ $eq: ['$status', 'PRESENT'] }, 1, 0] } },
        halfDay: { $sum: { $cond: [{ $eq: ['$status', 'HALF_DAY'] }, 1, 0] } },
        absent: { $sum: { $cond: [{ $eq: ['$status', 'ABSENT'] }, 1, 0] } },
        onLeave: { $sum: { $cond: [{ $eq: ['$status', 'ON_LEAVE'] }, 1, 0] } },
        holiday: { $sum: { $cond: [{ $eq: ['$status', 'HOLIDAY'] }, 1, 0] } },
        weeklyOff: { $sum: { $cond: [{ $eq: ['$status', 'WEEKLY_OFF'] }, 1, 0] } },
        incomplete: { $sum: { $cond: [{ $eq: ['$status', 'INCOMPLETE'] }, 1, 0] } },
        lateDays: { $sum: { $cond: [{ $gt: ['$lateMinutes', 0] }, 1, 0] } },
        lateMinutes: { $sum: '$lateMinutes' },
        earlyDepartureDays: { $sum: { $cond: [{ $gt: ['$earlyDepartureMinutes', 0] }, 1, 0] } },
        workedMinutes: { $sum: '$workedMinutes' },
        overtimeMinutes: { $sum: '$overtimeMinutes' },
      },
    },
  ]);
  const byEmp = new Map(days.map((d) => [String(d._id), d]));
  const deptIds = [...new Set(employees.map((e) => String(e.departmentId ?? '')).filter(Boolean))];
  const depts = await Department.find({ tenantId: tenant._id, _id: { $in: deptIds } })
    .select('name')
    .lean();
  const deptName = new Map(depts.map((d) => [String(d._id), d.name]));
  return employees.map((e) => {
    const d = byEmp.get(String(e._id));
    return {
      employeeId: String(e._id),
      employeeCode: e.employeeCode,
      name: `${e.firstName} ${e.lastName}`.trim(),
      department: e.departmentId ? deptName.get(String(e.departmentId)) : undefined,
      present: d?.present ?? 0,
      halfDay: d?.halfDay ?? 0,
      absent: d?.absent ?? 0,
      onLeave: d?.onLeave ?? 0,
      holiday: d?.holiday ?? 0,
      weeklyOff: d?.weeklyOff ?? 0,
      incomplete: d?.incomplete ?? 0,
      lateDays: d?.lateDays ?? 0,
      lateMinutes: d?.lateMinutes ?? 0,
      earlyDepartureDays: d?.earlyDepartureDays ?? 0,
      workedMinutes: d?.workedMinutes ?? 0,
      overtimeMinutes: d?.overtimeMinutes ?? 0,
    };
  });
}
