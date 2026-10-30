import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useAuth } from '@/auth/AuthProvider';
import { api } from '@/lib/client';
import {
  attendanceOverview,
  dashboardData,
  departmentRow,
  leaveOverview,
  pageMeta,
  reviewCorrection,
  reviewLeave,
  staffRow,
  type StaffRow,
} from '@/lib/schemas';

const useTenantKey = () => useAuth().active?.tenantId ?? 'none';

export const useAttOverview = (month: string, enabled = true) => {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ['att-overview', tenant, month],
    enabled,
    queryFn: async () =>
      (
        await api.call({
          path: '/reports/attendance/overview',
          query: { month },
          schema: attendanceOverview,
        })
      ).data,
  });
};

export const useLeaveOverview = (month: string, enabled = true) => {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ['leave-overview', tenant, month],
    enabled,
    queryFn: async () =>
      (
        await api.call({
          path: '/reports/leave/overview',
          query: { month },
          schema: leaveOverview,
        })
      ).data,
  });
};

/** Today's counts and the 14-day trend, scoped by the server (everyone for HR/owner, the team for managers). */
export const useDashboardData = (enabled = true) => {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ['dashboard-data', tenant],
    enabled,
    refetchInterval: 60_000,
    queryFn: async () =>
      (await api.call({ path: '/reports/dashboard', schema: dashboardData })).data,
  });
};

/** Leave requests inside the reviewer's scope. */
export const useReviewLeave = (
  query: { status?: string; from?: string; to?: string },
  enabled = true,
) => {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ['review-leave', tenant, query],
    enabled,
    queryFn: async () =>
      (
        await api.call({
          path: '/leave/requests',
          query: { scope: 'review', limit: 100, ...query },
          schema: z.array(reviewLeave),
        })
      ).data,
  });
};

export const useReviewCorrections = (status: string, enabled = true) => {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ['review-corrections', tenant, status],
    enabled,
    queryFn: async () =>
      (
        await api.call({
          path: '/attendance/corrections',
          query: { status, limit: 50 },
          schema: z.array(reviewCorrection),
        })
      ).data,
  });
};

const reviewException = z.object({
  id: z.string(),
  employee: z
    .object({ firstName: z.string(), lastName: z.string(), employeeCode: z.string() })
    .optional(),
  occurredAt: z.string(),
  eventType: z.string(),
  status: z.string(),
  employeeReason: z.string().nullish(),
  failure: z.string().nullish(),
});
export type ReviewException = z.infer<typeof reviewException>;
export const useReviewExceptions = (status: string, enabled = true) => {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ['review-exceptions', tenant, status],
    enabled,
    queryFn: async () =>
      (
        await api.call({
          path: '/attendance/exceptions',
          query: { status, limit: 50 },
          schema: z.array(reviewException),
        })
      ).data,
  });
};

export type DecisionKind = 'leave' | 'correction' | 'exception';
const PATH: Record<DecisionKind, string> = {
  leave: '/leave/requests',
  correction: '/attendance/corrections',
  exception: '/attendance/exceptions',
};
/** Approve (optional note) or reject (a note of 3+ characters is required by the server). */
export function useDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      kind: DecisionKind;
      id: string;
      action: 'approve' | 'reject';
      comment?: string;
    }) =>
      api.call({
        method: 'POST',
        path: `${PATH[v.kind]}/${v.id}/${v.action}`,
        body: v.comment?.trim() ? { comment: v.comment.trim() } : {},
      }),
    onSuccess: () => {
      for (const k of [
        'review-leave',
        'review-corrections',
        'review-exceptions',
        'dashboard-data',
        'leave-overview',
        'att-overview',
        'leave-requests',
        'team',
      ])
        void qc.invalidateQueries({ queryKey: [k] });
    },
  });
}

/** Everyone the caller may see (all statuses), up to 500 people. Used for headcount history and the People list. */
export const useStaff = (enabled = true) => {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ['staff', tenant],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const all: StaffRow[] = [];
      for (let page = 1; page <= 5; page++) {
        const r = await api.call({
          path: '/employees',
          query: { page, limit: 100 },
          schema: z.array(staffRow),
        });
        all.push(...r.data);
        const total = pageMeta.parse(r.meta).total;
        if (all.length >= total || r.data.length === 0) break;
      }
      return all;
    },
  });
};

export const useDepartmentNames = (enabled = true) => {
  const tenant = useTenantKey();
  const q = useQuery({
    queryKey: ['departments', tenant],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () =>
      (
        await api.call({
          path: '/departments',
          query: { limit: 100 },
          schema: z.array(departmentRow),
        })
      ).data,
  });
  return { ...q, name: (id?: string) => q.data?.find((d) => d.id === id)?.name ?? 'No department' };
};
