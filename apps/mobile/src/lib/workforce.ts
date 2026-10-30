import { DateTime } from 'luxon';
import type { StaffRow } from '@/lib/schemas';

const shiftMonth = (m: string, n: number) =>
  DateTime.fromISO(`${m}-01`, { zone: 'utc' }).plus({ months: n }).toFormat('yyyy-LL');
const lastDay = (m: string) =>
  DateTime.fromISO(`${m}-01`, { zone: 'utc' }).endOf('month').toISODate()!;
const monthOf = (d?: string) => (d ? d.slice(0, 7) : undefined);

export const isEmployed = (e: StaffRow) =>
  ['ACTIVE', 'ON_LEAVE', 'NOTICE_PERIOD'].includes(e.employmentStatus);

export const headcountAt = (staff: StaffRow[], month: string) => {
  const end = lastDay(month);
  return staff.filter(
    (e) =>
      (!e.joiningDate || e.joiningDate.slice(0, 10) <= end) &&
      (!e.lastWorkingDate || e.lastWorkingDate.slice(0, 10) > end),
  ).length;
};

/** Headcount at the end of each of the last `n` months, oldest first. */
export const headcountTrend = (staff: StaffRow[], month: string, n = 6) =>
  Array.from({ length: n }, (_, i) => {
    const m = shiftMonth(month, i - (n - 1));
    return {
      month: m,
      label: DateTime.fromISO(`${m}-01`, { zone: 'utc' }).toFormat('LLL'),
      value: headcountAt(staff, m),
    };
  });

export const joinedIn = (staff: StaffRow[], month: string) =>
  staff.filter((e) => monthOf(e.joiningDate) === month);
export const leftIn = (staff: StaffRow[], month: string) =>
  staff.filter((e) => monthOf(e.lastWorkingDate) === month);

/** Leavers over the last 12 months divided by the average headcount. */
export function attrition12(staff: StaffRow[], month: string) {
  const span = Array.from({ length: 12 }, (_, i) => shiftMonth(month, i - 11));
  const leavers = span.reduce((s, m) => s + leftIn(staff, m).length, 0);
  const avg = span.reduce((s, m) => s + headcountAt(staff, m), 0) / 12;
  return {
    leavers,
    avgHeadcount: Math.round(avg),
    pct: avg > 0 ? Math.round((leavers / avg) * 1000) / 10 : null,
  };
}

/** Counts per key, biggest first. */
export const countBy = <T>(items: T[], key: (x: T) => string) => {
  const m = new Map<string, number>();
  for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1);
  return [...m.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
};
