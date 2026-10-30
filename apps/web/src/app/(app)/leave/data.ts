'use client';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useAuth } from '@/components/auth';
import { api } from '@/lib/api';
import type { Employee, LeaveRequest } from '@/lib/types';

/** Reads every page of a list (the API caps a page at 100). Stops after `maxPages`. */
export async function fetchAll<T>(
  path: string,
  query: Record<string, unknown>,
  maxPages = 10,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const r = await api.get<T[]>(path, { ...query, page, limit: 100 });
    all.push(...r.data);
    if (all.length >= (r.meta?.total ?? 0) || r.data.length === 0) break;
  }
  return all;
}

/** Leave requests inside the caller's review scope (their team, or everyone for HR and owners). */
export function useReviewRequests(name: string, query: Record<string, unknown>, enabled = true) {
  const tenant = useAuth().active?.tenantId ?? 'none';
  return useQuery({
    queryKey: ['leave-requests', tenant, name, query],
    enabled: enabled && tenant !== 'none',
    queryFn: () => fetchAll<LeaveRequest>('/leave/requests', { scope: 'review', ...query }),
  });
}

export function useAllEmployees(enabled = true, query: Record<string, unknown> = {}) {
  const tenant = useAuth().active?.tenantId ?? 'none';
  return useQuery({
    queryKey: ['employees-all', tenant, query],
    enabled: enabled && tenant !== 'none',
    queryFn: () => fetchAll<Employee>('/employees', { status: 'ACTIVE', ...query }, 5),
  });
}

export const eachDate = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (
    let d = DateTime.fromISO(from, { zone: 'utc' });
    d <= DateTime.fromISO(to, { zone: 'utc' }) && out.length < 400;
    d = d.plus({ days: 1 })
  )
    out.push(d.toISODate()!);
  return out;
};
export const dowOf = (d: string) => DateTime.fromISO(d, { zone: 'utc' }).weekday % 7;
export const addDay = (d: string, n: number) =>
  DateTime.fromISO(d, { zone: 'utc' }).plus({ days: n }).toISODate()!;
export const daysSince = (iso?: string) =>
  iso ? Math.floor((Date.now() - Date.parse(iso)) / 86_400_000) : 0;

/** date -> employee ids off that day. Approved and pending count; weekly offs are skipped. */
export function offMap(
  reqs: LeaveRequest[],
  workweek: number[],
  statuses = ['APPROVED', 'PENDING'],
) {
  const m = new Map<string, Set<string>>();
  for (const r of reqs) {
    if (!statuses.includes(r.status)) continue;
    for (const d of eachDate(r.startDate, r.endDate)) {
      if (!workweek.includes(dowOf(d))) continue;
      if (!m.has(d)) m.set(d, new Set());
      m.get(d)!.add(r.employeeId);
    }
  }
  return m;
}

export const fullName = (e?: { firstName: string; lastName: string }) =>
  e ? `${e.firstName} ${e.lastName}` : 'Employee';
export const initials = (e?: { firstName: string; lastName: string }) =>
  e ? `${e.firstName[0] ?? ''}${e.lastName[0] ?? ''}`.toUpperCase() : '?';
export const rangeText = (a: string, b: string) => {
  const f = (d: string) => DateTime.fromISO(d, { zone: 'utc' }).toFormat('d LLL');
  return a === b ? f(a) : `${f(a)} – ${f(b)}`;
};
export const WINDOW_DAYS = 2;
