import { DateTime } from 'luxon';
import type { DayRow } from '@/lib/types';

export const monthStart = (m: string) => `${m}-01`;
export const monthEnd = (m: string) =>
  DateTime.fromISO(`${m}-01`, { zone: 'utc' }).endOf('month').toISODate()!;
export const addMonth = (m: string, n: number) =>
  DateTime.fromISO(`${m}-01`, { zone: 'utc' }).plus({ months: n }).toFormat('yyyy-LL');
export const monthLabel = (m: string) =>
  DateTime.fromISO(`${m}-01`, { zone: 'utc' }).toFormat('LLLL yyyy');
/** 0 = Sunday ... 6 = Saturday, matching the API's weeklyOffDays. */
export const dow = (d: string) => DateTime.fromISO(d, { zone: 'utc' }).weekday % 7;
export const shortDate = (d: string) =>
  DateTime.fromISO(d.slice(0, 10), { zone: 'utc' }).toFormat('d LLL');
export const weekdayDate = (d: string) =>
  DateTime.fromISO(d.slice(0, 10), { zone: 'utc' }).toFormat('ccc, d LLL');
export const longDate = (d: string) =>
  DateTime.fromISO(d, { zone: 'utc' }).toFormat('cccc, d LLLL yyyy');

export type CalKey =
  | 'PRESENT'
  | 'LATE'
  | 'HALF_DAY'
  | 'ON_LEAVE'
  | 'ABSENT'
  | 'HOLIDAY'
  | 'WEEKLY_OFF'
  | 'INCOMPLETE'
  | 'WORKING';

/** Display class of one attendance day. A present day with late minutes is shown as "Late". */
export function dayKey(d: Pick<DayRow, 'status' | 'lateMinutes' | 'isOpen'>): CalKey {
  if (d.isOpen) return 'WORKING';
  if (d.status === 'PRESENT' && d.lateMinutes > 0) return 'LATE';
  return d.status as CalKey;
}

export const CAL: Record<CalKey, { label: string; cell: string; chip: string }> = {
  PRESENT: {
    label: 'Present',
    cell: 'bg-success-bg text-success',
    chip: 'bg-success-bg text-success',
  },
  LATE: { label: 'Late', cell: 'bg-warn-bg text-warn', chip: 'bg-warn-bg text-warn' },
  HALF_DAY: { label: 'Half day', cell: 'bg-warn-bg/60 text-warn', chip: 'bg-warn-bg text-warn' },
  ON_LEAVE: { label: 'Leave', cell: 'bg-info-bg text-info', chip: 'bg-info-bg text-info' },
  ABSENT: { label: 'Absent', cell: 'bg-danger-bg text-danger', chip: 'bg-danger-bg text-danger' },
  HOLIDAY: { label: 'Holiday', cell: 'bg-subtle text-muted', chip: 'bg-subtle text-muted' },
  WEEKLY_OFF: { label: 'Week off', cell: 'bg-subtle text-muted', chip: 'bg-subtle text-muted' },
  INCOMPLETE: { label: 'Incomplete', cell: 'bg-warn-bg text-warn', chip: 'bg-warn-bg text-warn' },
  WORKING: {
    label: 'Working',
    cell: 'bg-accent text-primary ring-1 ring-primary',
    chip: 'bg-accent text-primary',
  },
};

export interface MonthStats {
  present: number;
  absent: number;
  late: number;
  leave: number;
  half: number;
  incomplete: number;
  earlyExit: number;
  overtimeMinutes: number;
  /** Days the employee was expected to work (everything except holidays and weekly offs). */
  workingDays: number;
  rate: number | null;
}
export function monthStats(rows: DayRow[]): MonthStats {
  const s: MonthStats = {
    present: 0,
    absent: 0,
    late: 0,
    leave: 0,
    half: 0,
    incomplete: 0,
    earlyExit: 0,
    overtimeMinutes: 0,
    workingDays: 0,
    rate: null,
  };
  for (const d of rows) {
    if (d.status === 'HOLIDAY' || d.status === 'WEEKLY_OFF') continue;
    s.workingDays++;
    if (d.status === 'PRESENT') s.present++;
    if (d.status === 'ABSENT') s.absent++;
    if (d.status === 'ON_LEAVE') s.leave++;
    if (d.status === 'HALF_DAY') s.half++;
    if (d.status === 'INCOMPLETE') s.incomplete++;
    if (d.lateMinutes > 0) s.late++;
    if (d.earlyDepartureMinutes > 0) s.earlyExit++;
    s.overtimeMinutes += d.overtimeMinutes ?? 0;
  }
  // Approved leave is excluded from the denominator, as on the design ("excluding approved leave").
  const denom = s.workingDays - s.leave;
  s.rate = denom > 0 ? Math.round(((s.present + s.half * 0.5) / denom) * 1000) / 10 : null;
  return s;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const SECTION_IDS = {
  overview: 'att-overview',
  calendar: 'att-calendar',
  log: 'att-log',
  requests: 'att-requests',
  leave: 'att-leave',
  roster: 'att-roster',
  team: 'att-team',
  reports: 'att-reports',
} as const;
