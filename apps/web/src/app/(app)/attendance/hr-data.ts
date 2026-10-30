'use client';
import { useAuth } from '@/components/auth';
import { useList } from '@/hooks/api';
import type { Correction, DayRow, ExceptionReq, LeaveRequest } from '@/lib/types';

type Who = { firstName: string; lastName: string; employeeCode: string };
export interface QueueItem {
  key: string;
  kind: 'correction' | 'leave' | 'location';
  id: string;
  employeeId: string;
  name: string;
  code: string;
  title: string;
  detail: string;
  date: string;
  createdAt?: string;
}

const typeOf = (reason: string) => /^\[(.+?)\]/.exec(reason)?.[1] ?? 'Attendance correction';
const plain = (reason: string) => reason.replace(/^\[.+?\]\s*/, '');
const nameOf = (e?: Who) => (e ? `${e.firstName} ${e.lastName}` : 'Employee');

/** Everything waiting for a decision, across corrections, location approvals and leave. Your own requests are left out. */
export function useApprovalQueue(selfId?: string) {
  const { can } = useAuth();
  const review = can('attendance:review:all', 'attendance:review:team');
  const corr = useList<Correction & { employee?: Who }>(
    'approvals',
    '/attendance/corrections',
    { status: 'PENDING', limit: 100 },
    review,
  );
  const exc = useList<ExceptionReq & { employee?: Who }>(
    'approvals',
    '/attendance/exceptions',
    { status: 'PENDING', limit: 100 },
    review,
  );
  const leave = useList<LeaveRequest>(
    'approvals',
    '/leave/requests',
    { scope: 'review', status: 'PENDING', limit: 100 },
    can('leave:review:all', 'leave:review:team'),
  );
  const items: QueueItem[] = [
    ...(corr.data?.data ?? []).map((r) => ({
      key: `c${r.id}`,
      kind: 'correction' as const,
      id: r.id,
      employeeId: r.employeeId,
      name: nameOf(r.employee),
      code: r.employee?.employeeCode ?? '',
      title: typeOf(r.reason),
      detail: plain(r.reason),
      date: r.workDate,
      createdAt: r.createdAt,
    })),
    ...(exc.data?.data ?? []).map((r) => ({
      key: `x${r.id}`,
      kind: 'location' as const,
      id: r.id,
      employeeId: r.employeeId,
      name: nameOf(r.employee),
      code: r.employee?.employeeCode ?? '',
      title: `Location approval · ${r.eventType.replace('_', ' ').toLowerCase()}`,
      detail: r.employeeReason ?? r.failure ?? '',
      date: r.occurredAt.slice(0, 10),
      createdAt: r.occurredAt,
    })),
    ...(leave.data?.data ?? []).map((r) => ({
      key: `l${r.id}`,
      kind: 'leave' as const,
      id: r.id,
      employeeId: r.employeeId,
      name: nameOf(r.employee),
      code: r.employee?.employeeCode ?? '',
      title: `${r.leaveType?.name ?? 'Leave'}${r.halfDay ? ' (half day)' : ''}`,
      detail: r.reason ?? '',
      date: r.startDate,
      createdAt: r.createdAt,
    })),
  ]
    .filter((i) => i.employeeId !== selfId)
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  return {
    items,
    isPending: corr.isPending || exc.isPending || leave.isPending,
    error: corr.error ?? exc.error ?? leave.error,
  };
}

export interface ExceptionItem {
  day: DayRow;
  issue: 'MISSING_PUNCH' | 'ABSENT';
}
/** Days that need a person to look at them: a missing punch or an absence with no explanation. */
export function useExceptionItems(from: string, to: string, enabled = true) {
  const a = useList<DayRow>(
    'exception-days',
    '/attendance/days',
    { from, to, status: 'INCOMPLETE', limit: 100 },
    enabled,
  );
  const b = useList<DayRow>(
    'exception-days',
    '/attendance/days',
    { from, to, status: 'ABSENT', limit: 100 },
    enabled,
  );
  const items: ExceptionItem[] = [
    ...(a.data?.data ?? []).map((day) => ({ day, issue: 'MISSING_PUNCH' as const })),
    ...(b.data?.data ?? []).map((day) => ({ day, issue: 'ABSENT' as const })),
  ].sort((x, y) => y.day.workDate.localeCompare(x.day.workDate));
  return {
    items,
    isPending: a.isPending || b.isPending,
    error: a.error ?? b.error,
    total: (a.data?.meta?.total ?? 0) + (b.data?.meta?.total ?? 0),
  };
}
