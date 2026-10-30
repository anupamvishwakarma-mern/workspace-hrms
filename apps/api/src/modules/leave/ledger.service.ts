import type { Types } from 'mongoose';
import { Employee } from '../../database/models/employee.model';
import { LeaveLedger } from '../../database/models/leaveLedger.model';
import { LeaveRequest } from '../../database/models/leaveRequest.model';
import { LeaveType } from '../../database/models/leaveType.model';

export interface TypeLike {
  _id: Types.ObjectId;
  annualAllowanceDays: number;
  accrualMode?: string | null;
}
/** A type is limited when it accrues monthly or has a yearly allowance; otherwise usage is only tracked. */
export const isCapped = (t: Pick<TypeLike, 'annualAllowanceDays' | 'accrualMode'>) =>
  t.accrualMode === 'MONTHLY' || t.annualAllowanceDays > 0;

const round05 = (n: number) => Math.round(n * 2) / 2;
const ENDED = ['TERMINATED', 'INVITED'];

export interface Breakdown {
  base: number;
  accrued: number;
  carriedForward: number;
  adjustments: number;
  total: number;
}

export function summarise(t: TypeLike, rows: { kind: string; days: number }[]): Breakdown {
  const sum = (k: string) => rows.filter((r) => r.kind === k).reduce((a, r) => a + r.days, 0);
  const base = t.accrualMode === 'MONTHLY' ? 0 : t.annualAllowanceDays;
  const accrued = sum('ACCRUAL');
  const carriedForward = sum('CARRY_FORWARD');
  const adjustments = sum('ADJUSTMENT');
  return { base, accrued, carriedForward, adjustments, total: base + accrued + carriedForward + adjustments };
}

export async function breakdownFor(
  tenantId: Types.ObjectId,
  employeeId: Types.ObjectId,
  t: TypeLike,
  year: number,
): Promise<Breakdown> {
  const rows = await LeaveLedger.find({ tenantId, employeeId, leaveTypeId: t._id, year })
    .select('kind days')
    .lean();
  return summarise(t, rows);
}

/** Entitlement for everyone at once (reports): key `employeeId|leaveTypeId`. */
export async function entitlementMap(
  tenantId: Types.ObjectId,
  types: TypeLike[],
  year: number,
): Promise<(employeeId: unknown, typeId: unknown) => number> {
  const rows = await LeaveLedger.find({ tenantId, year }).select('employeeId leaveTypeId days').lean();
  const credits = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.employeeId}|${r.leaveTypeId}`;
    credits.set(k, (credits.get(k) ?? 0) + r.days);
  }
  const byType = new Map(types.map((t) => [String(t._id), t]));
  return (e, ty) => {
    const t = byType.get(String(ty));
    const base = !t || t.accrualMode === 'MONTHLY' ? 0 : t.annualAllowanceDays;
    return base + (credits.get(`${e}|${ty}`) ?? 0);
  };
}

/** Cumulative schedule so twelve monthly credits add up to exactly the yearly allowance. */
export function monthlyCredit(allowance: number, month: number): number {
  return round05((allowance * month) / 12) - round05((allowance * (month - 1)) / 12);
}

/**
 * Credit one month of leave to every eligible employee, for every MONTHLY leave type. Safe to run
 * repeatedly: an employee already credited for that month is skipped. People are credited from
 * the month they joined (that whole month counts); earlier months are not back-filled.
 */
export async function runMonthlyAccrual(
  tenantId: Types.ObjectId,
  month: string, // YYYY-MM
  actorUserId?: Types.ObjectId,
) {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const types = await LeaveType.find({ tenantId, status: 'ACTIVE', accrualMode: 'MONTHLY' }).lean();
  const emps = await Employee.find({ tenantId, employmentStatus: { $nin: ENDED } })
    .select('joiningDate')
    .lean();
  let created = 0;
  for (const t of types) {
    const credit = monthlyCredit(t.annualAllowanceDays, m);
    if (credit <= 0) continue;
    for (const e of emps) {
      if (e.joiningDate && e.joiningDate.toISOString().slice(0, 7) > month) continue;
      const key = `ACCRUAL|${e._id}|${t._id}|${month}`;
      const r = await LeaveLedger.updateOne(
        { tenantId, key },
        {
          $setOnInsert: {
            employeeId: e._id,
            leaveTypeId: t._id,
            year,
            kind: 'ACCRUAL',
            days: credit,
            period: month,
            createdBy: actorUserId,
            key,
          },
        },
        { upsert: true },
      );
      if (r.upsertedCount) created += 1;
    }
  }
  return { month, types: types.length, entriesCreated: created };
}

/**
 * Year-end: move unused days (up to each type's carry-forward limit) into the next year.
 * Pending and approved requests both count as used, so a later approval cannot overdraw the carry.
 */
export async function runCarryForward(
  tenantId: Types.ObjectId,
  fromYear: number,
  actorUserId?: Types.ObjectId,
) {
  const types = await LeaveType.find({ tenantId, status: 'ACTIVE', carryForwardMaxDays: { $gt: 0 } }).lean();
  const emps = await Employee.find({ tenantId, employmentStatus: { $nin: ENDED } }).select('_id').lean();
  let created = 0;
  let totalDays = 0;
  for (const t of types) {
    for (const e of emps) {
      const [bd, reqs] = await Promise.all([
        breakdownFor(tenantId, e._id, t, fromYear),
        LeaveRequest.find({
          tenantId,
          employeeId: e._id,
          leaveTypeId: t._id,
          status: { $in: ['PENDING', 'APPROVED'] },
          startDate: { $gte: `${fromYear}-01-01`, $lte: `${fromYear}-12-31` },
        })
          .select('days')
          .lean(),
      ]);
      const used = reqs.reduce((a, r) => a + r.days, 0);
      const carry = Math.min(Math.max(bd.total - used, 0), t.carryForwardMaxDays);
      if (carry <= 0) continue;
      const key = `CARRY_FORWARD|${e._id}|${t._id}|${fromYear}`;
      const r = await LeaveLedger.updateOne(
        { tenantId, key },
        {
          $setOnInsert: {
            employeeId: e._id,
            leaveTypeId: t._id,
            year: fromYear + 1,
            kind: 'CARRY_FORWARD',
            days: carry,
            period: String(fromYear),
            createdBy: actorUserId,
            key,
          },
        },
        { upsert: true },
      );
      if (r.upsertedCount) {
        created += 1;
        totalDays += carry;
      }
    }
  }
  return { fromYear, types: types.length, entriesCreated: created, daysCarried: totalDays };
}
