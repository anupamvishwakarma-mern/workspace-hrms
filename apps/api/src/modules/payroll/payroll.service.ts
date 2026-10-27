import { DateTime } from 'luxon';
import type { Types } from 'mongoose';
import { AttendanceDay } from '../../database/models/attendanceDay.model';
import { Department } from '../../database/models/department.model';
import { Employee } from '../../database/models/employee.model';
import { LeaveRequest } from '../../database/models/leaveRequest.model';
import { LeaveType } from '../../database/models/leaveType.model';
import { PayrollRun, Payslip } from '../../database/models/payroll.model';
import { SalaryStructure } from '../../database/models/salaryStructure.model';
import { AppError } from '../../utils/errors';
import { addDays, localDate } from '../attendance/dates';
import type { TenantInfo } from '../attendance/attendance.service';
import { ensureDays, type ScopedEmployee } from '../reports/reports.service';
import { calculatePayslip, type PayComponent } from './calc';

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const isoDay = (d?: Date | null) =>
  d ? DateTime.fromJSDate(d, { zone: 'utc' }).toISODate()! : undefined;

export const monthBounds = (month: string) => {
  const start = DateTime.fromISO(`${month}-01`, { zone: 'UTC' });
  return {
    from: start.toISODate()!,
    to: start.endOf('month').toISODate()!,
    days: start.daysInMonth!,
  };
};

/** The structure in force for a month: the latest version starting on or before the month's last day. */
export async function effectiveStructure(
  tenantId: Types.ObjectId,
  employeeId: Types.ObjectId,
  onOrBefore: string,
) {
  return SalaryStructure.findOne({ tenantId, employeeId, effectiveFrom: { $lte: onOrBefore } })
    .sort({ effectiveFrom: -1, createdAt: -1 })
    .lean();
}

export async function generateRun(
  tenant: TenantInfo,
  month: string,
  actorId: Types.ObjectId,
  now: Date,
) {
  const today = localDate(now, tenant.timezone);
  if (month >= today.slice(0, 7))
    throw new AppError(
      422,
      'MONTH_NOT_COMPLETE',
      'Payroll can only be generated for a month that has fully ended',
    );
  const { from, to, days } = monthBounds(month);
  let run = await PayrollRun.findOne({ tenantId: tenant._id, month });
  if (run?.status === 'PUBLISHED')
    throw AppError.conflict('This month is already published and cannot be regenerated');

  const emps = await Employee.find({
    tenantId: tenant._id,
    employmentStatus: { $in: ['ACTIVE', 'ON_LEAVE', 'NOTICE_PERIOD', 'TERMINATED'] },
  })
    .select('employeeCode firstName lastName designation departmentId joiningDate lastWorkingDate')
    .sort({ employeeCode: 1 })
    .lean();
  const employed = emps.filter((e) => {
    const j = isoDay(e.joiningDate);
    const l = isoDay(e.lastWorkingDate);
    return (!j || j <= to) && (!l || l >= from);
  });

  const structures = await SalaryStructure.find({
    tenantId: tenant._id,
    employeeId: { $in: employed.map((e) => e._id) },
    effectiveFrom: { $lte: to },
  })
    .sort({ effectiveFrom: -1, createdAt: -1 })
    .lean();
  const structOf = new Map<string, (typeof structures)[number]>();
  for (const s of structures)
    if (!structOf.has(String(s.employeeId))) structOf.set(String(s.employeeId), s);

  const skipped: { employeeId: Types.ObjectId; name: string; reason: string }[] = [];
  const payable = employed.filter((e) => {
    if (structOf.has(String(e._id))) return true;
    skipped.push({
      employeeId: e._id,
      name: `${e.firstName} ${e.lastName}`,
      reason: 'NO_SALARY_STRUCTURE',
    });
    return false;
  });

  await ensureDays(tenant, payable as unknown as ScopedEmployee[], from, to, now);
  const ids = payable.map((e) => e._id);
  const dayRows = await AttendanceDay.find({
    tenantId: tenant._id,
    employeeId: { $in: ids },
    workDate: { $gte: from, $lte: to },
  })
    .select('employeeId workDate status')
    .lean();
  const unpaidTypes = await LeaveType.find({ tenantId: tenant._id, paid: false })
    .select('_id')
    .lean();
  const unpaidReqs = unpaidTypes.length
    ? await LeaveRequest.find({
        tenantId: tenant._id,
        employeeId: { $in: ids },
        status: 'APPROVED',
        leaveTypeId: { $in: unpaidTypes.map((t) => t._id) },
        startDate: { $lte: to },
        endDate: { $gte: from },
      }).lean()
    : [];
  const depts = new Map(
    (await Department.find({ tenantId: tenant._id }).select('name').lean()).map((d) => [
      String(d._id),
      d.name as string,
    ]),
  );

  if (!run)
    run = new PayrollRun({
      tenantId: tenant._id,
      month,
      generatedBy: actorId,
      generatedAt: now,
    });
  run.generatedBy = actorId;
  run.generatedAt = now;
  await run.save();
  await Payslip.deleteMany({ tenantId: tenant._id, runId: run._id });

  const docs = payable.map((e) => {
    const st = structOf.get(String(e._id))!;
    const mine = dayRows.filter((d) => String(d.employeeId) === String(e._id));
    const status = new Map(mine.map((d) => [d.workDate, d.status as string]));
    const count = (s: string) => mine.filter((d) => d.status === s).length;

    // loss of pay per date: absent = 1, half day = 0.5, unpaid approved leave = 1 (or 0.5 for a half-day request)
    const lopByDate = new Map<string, number>();
    for (const d of mine) {
      if (d.status === 'ABSENT') lopByDate.set(d.workDate, 1);
      else if (d.status === 'HALF_DAY') lopByDate.set(d.workDate, 0.5);
    }
    let unpaidLeaveDays = 0;
    for (const r of unpaidReqs.filter((x) => String(x.employeeId) === String(e._id))) {
      for (
        let d = r.startDate > from ? r.startDate : from;
        d <= (r.endDate < to ? r.endDate : to);
        d = addDays(d, 1)
      ) {
        const charge = r.halfDay ? 0.5 : status.get(d) === 'ON_LEAVE' ? 1 : 0;
        if (charge > (lopByDate.get(d) ?? 0)) {
          unpaidLeaveDays += charge - (status.get(d) === 'ON_LEAVE' ? 0 : 0);
          lopByDate.set(d, charge);
        }
      }
    }
    const lop = [...lopByDate.values()].reduce((a, b) => a + b, 0);

    const j = isoDay(e.joiningDate);
    const l = isoDay(e.lastWorkingDate);
    let notEmployed = 0;
    if (j && j > from)
      notEmployed += Math.min(days, DateTime.fromISO(j).diff(DateTime.fromISO(from), 'days').days);
    if (l && l < to)
      notEmployed += Math.min(days, DateTime.fromISO(to).diff(DateTime.fromISO(l), 'days').days);

    const calc = calculatePayslip({
      components: st.components as PayComponent[],
      daysInMonth: days,
      lopDays: lop,
      notEmployedDays: notEmployed,
    });
    const warnings = [...calc.warnings];
    const incomplete = count('INCOMPLETE');
    if (incomplete) warnings.push('INCOMPLETE_DAYS');
    return {
      tenantId: tenant._id,
      runId: run!._id,
      employeeId: e._id,
      month,
      status: 'DRAFT' as const,
      structureId: st._id,
      currency: st.currency,
      employee: {
        code: e.employeeCode,
        name: `${e.firstName} ${e.lastName}`,
        designation: e.designation ?? undefined,
        department: e.departmentId ? depts.get(String(e.departmentId)) : undefined,
      },
      attendance: {
        daysInMonth: days,
        payableDays: calc.payableDays,
        lopDays: lop,
        notEmployedDays: notEmployed,
        presentDays: count('PRESENT'),
        halfDays: count('HALF_DAY'),
        absentDays: count('ABSENT'),
        paidLeaveDays: Math.max(0, count('ON_LEAVE') - unpaidLeaveDays),
        unpaidLeaveDays,
        holidays: count('HOLIDAY'),
        weeklyOffs: count('WEEKLY_OFF'),
        incompleteDays: incomplete,
      },
      lines: calc.lines,
      grossMinor: calc.grossMinor,
      deductionsMinor: calc.deductionsMinor,
      netMinor: calc.netMinor,
      warnings,
    };
  });
  if (docs.length) await Payslip.insertMany(docs);
  run.totals = {
    employees: docs.length,
    grossMinor: docs.reduce((s, d) => s + d.grossMinor, 0),
    deductionsMinor: docs.reduce((s, d) => s + d.deductionsMinor, 0),
    netMinor: docs.reduce((s, d) => s + d.netMinor, 0),
  };
  run.skipped = skipped as never;
  await run.save();
  return run.toObject();
}

export async function publishRun(
  tenantId: Types.ObjectId,
  runId: string,
  actorId: Types.ObjectId,
  now: Date,
) {
  const run = await PayrollRun.findOne({ _id: runId, tenantId });
  if (!run) throw AppError.notFound('Payroll run not found');
  if (run.status === 'PUBLISHED') throw AppError.conflict('This run is already published');
  const negative = await Payslip.countDocuments({
    tenantId,
    runId: run._id,
    warnings: 'NEGATIVE_NET',
  });
  if (negative)
    throw new AppError(
      422,
      'NEGATIVE_NET',
      `${negative} payslip(s) have a negative net pay. Fix the salary structures and regenerate before publishing.`,
    );
  const flipped = await PayrollRun.findOneAndUpdate(
    { _id: run._id, tenantId, status: 'DRAFT' },
    { $set: { status: 'PUBLISHED', publishedBy: actorId, publishedAt: now } },
    { new: true },
  ).lean();
  if (!flipped) throw AppError.conflict('This run is already published');
  await Payslip.updateMany(
    { tenantId, runId: run._id, status: 'DRAFT' },
    { $set: { status: 'PUBLISHED', publishedAt: now } },
  );
  return flipped;
}
