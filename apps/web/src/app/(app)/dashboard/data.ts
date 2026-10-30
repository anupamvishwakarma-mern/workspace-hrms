'use client';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useAuth } from '@/components/auth';
import { useOne } from '@/hooks/api';
import { useTenant } from '@/hooks/lookups';
import type { Employee } from '@/lib/types';
import { todayIso } from '@/lib/utils';
import { fetchAll } from '../leave/data';

export const greetingDate = (tz: string) =>
  DateTime.now().setZone(tz).toFormat('cccc, d LLLL yyyy');

/** Today's date and zone, from the company settings. */
export function useToday() {
  const t = useTenant();
  const tz = t.data?.data.timezone ?? 'UTC';
  return {
    tz,
    today: todayIso(tz),
    tenant: t.data?.data,
    workweek: t.data?.data.workweek ?? [1, 2, 3, 4, 5],
  };
}

/** The signed-in person's first name, from their employee record when they have one. */
export function useFirstName() {
  const { active, email } = useAuth();
  const q = useOne<Employee>(
    'me-employee',
    `/employees/${active?.employeeId}`,
    !!active?.employeeId,
  );
  return q.data?.data.firstName ?? email?.split('@')[0] ?? 'there';
}

const monthOf = (d?: string) => (d ? d.slice(0, 7) : undefined);
const shiftMonth = (m: string, n: number) =>
  DateTime.fromISO(`${m}-01`, { zone: 'utc' }).plus({ months: n }).toFormat('yyyy-LL');
const lastDay = (m: string) =>
  DateTime.fromISO(`${m}-01`, { zone: 'utc' }).endOf('month').toISODate()!;

export interface Workforce {
  all: Employee[];
  employed: Employee[];
  headcount: number;
  headcountTrend: { label: string; month: string; value: number }[];
  joinedIn: (month: string) => Employee[];
  leftIn: (month: string) => Employee[];
  attrition12: { leavers: number; avgHeadcount: number; pct: number | null };
  leaversByDepartment: Map<string, number>;
  byDepartment: Map<string, number>;
}

/** Every employee (all statuses) with the headcount history worked out from joining and last-working dates. */
export function useWorkforce(month: string) {
  const tenant = useAuth().active?.tenantId ?? 'none';
  const q = useQuery({
    queryKey: ['employees-all', tenant, 'every-status'],
    enabled: tenant !== 'none',
    queryFn: () => fetchAll<Employee>('/employees', {}, 10),
    staleTime: 60_000,
  });
  const all = q.data ?? [];
  const employed = all.filter((e) =>
    ['ACTIVE', 'ON_LEAVE', 'NOTICE_PERIOD'].includes(e.employmentStatus),
  );
  const headcountAt = (m: string) => {
    const end = lastDay(m);
    return all.filter(
      (e) =>
        (!e.joiningDate || e.joiningDate.slice(0, 10) <= end) &&
        (!e.lastWorkingDate || e.lastWorkingDate.slice(0, 10) > end),
    ).length;
  };
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5));
  const joinedIn = (m: string) => all.filter((e) => monthOf(e.joiningDate) === m);
  const leftIn = (m: string) => all.filter((e) => monthOf(e.lastWorkingDate) === m);
  const span = Array.from({ length: 12 }, (_, i) => shiftMonth(month, i - 11));
  const leavers = span.reduce((s, m) => s + leftIn(m).length, 0);
  const avg = span.reduce((s, m) => s + headcountAt(m), 0) / 12;
  const leaversByDepartment = new Map<string, number>();
  for (const m of span)
    for (const e of leftIn(m))
      leaversByDepartment.set(
        e.departmentId ?? '',
        (leaversByDepartment.get(e.departmentId ?? '') ?? 0) + 1,
      );
  const byDepartment = new Map<string, number>();
  for (const e of employed)
    byDepartment.set(e.departmentId ?? '', (byDepartment.get(e.departmentId ?? '') ?? 0) + 1);
  const data: Workforce = {
    all,
    employed,
    headcount: employed.length,
    headcountTrend: months.map((m) => ({
      month: m,
      label: DateTime.fromISO(`${m}-01`, { zone: 'utc' }).toFormat('LLL'),
      value: headcountAt(m),
    })),
    joinedIn,
    leftIn,
    attrition12: {
      leavers,
      avgHeadcount: Math.round(avg),
      pct: avg > 0 ? Math.round((leavers / avg) * 1000) / 10 : null,
    },
    leaversByDepartment,
    byDepartment,
  };
  return { ...q, data };
}
