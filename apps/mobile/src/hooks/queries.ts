import { focusManager, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { z } from 'zod';
import { useAuth } from '@/auth/AuthProvider';
import { api } from '@/lib/client';
import { correctionRecord, dayRecord, exceptionRecord, pageMeta, todayData } from '@/lib/schemas';

/** Refetch when the app returns to the foreground (React Native has no window focus event). */
export function useAppStateFocus() {
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => focusManager.setFocused(s === 'active'));
    return () => sub.remove();
  }, []);
}

/** Cache keys include the company so switching companies can never show another company's data. */
const useTenantKey = () => useAuth().active?.tenantId ?? 'none';

export function useToday() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ['today', tenant],
    queryFn: async () => (await api.call({ path: '/attendance/me/today', schema: todayData })).data,
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
}

const PAGE = 20;
export function useHistory() {
  const tenant = useTenantKey();
  return useInfiniteQuery({
    queryKey: ['history', tenant],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const r = await api.call({
        path: '/attendance/me/history',
        query: { page: pageParam, limit: PAGE },
        schema: z.array(dayRecord),
      });
      return { items: r.data, meta: pageMeta.parse(r.meta) };
    },
    getNextPageParam: (last) =>
      last.meta.page * last.meta.limit < last.meta.total ? last.meta.page + 1 : undefined,
  });
}

export function useMyCorrections() {
  const { active } = useAuth();
  return useQuery({
    queryKey: ['corrections', active?.tenantId ?? 'none'],
    enabled: !!active?.employeeId,
    queryFn: async () =>
      (
        await api.call({
          path: '/attendance/corrections',
          // Managers/HR can list more than their own; the app only shows the person's own requests.
          query: { employeeId: active!.employeeId, limit: 50 },
          schema: z.array(correctionRecord),
        })
      ).data,
  });
}

export function useMyExceptions() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ['exceptions', tenant],
    queryFn: async () =>
      (
        await api.call({
          path: '/attendance/me/exceptions',
          query: { limit: 50 },
          schema: z.array(exceptionRecord),
        })
      ).data,
  });
}

/* ---- HR pages ---- */
import {
  employeeSelf,
  handbookSection,
  holiday,
  leaveBalance,
  leaveRequest,
  letterItem,
  payslipFull,
  payslipSummary,
  salaryStructure,
  teamToday,
} from '@/lib/schemas';

export function useDays(month: string, from: string, to: string) {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ['history', tenant, month],
    queryFn: async () =>
      (
        await api.call({
          path: '/attendance/me/history',
          query: { from, to, limit: 50 },
          schema: z.array(dayRecord),
        })
      ).data,
  });
}

export function useHolidays(from: string, to: string) {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ['holidays', tenant, from, to],
    queryFn: async () =>
      (
        await api.call({
          path: '/holidays',
          query: { from, to, limit: 100 },
          schema: z.array(holiday),
        })
      ).data,
  });
}

export function useLeaveBalances(year: number) {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ['leave-balances', tenant, year],
    queryFn: async () =>
      (await api.call({ path: '/leave/balances', query: { year }, schema: z.array(leaveBalance) }))
        .data,
  });
}
export function useMyLeaveRequests() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ['leave-requests', tenant],
    queryFn: async () =>
      (
        await api.call({
          path: '/leave/requests',
          query: { scope: 'mine', limit: 50 },
          schema: z.array(leaveRequest),
        })
      ).data,
  });
}

export function useMyLetters() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ['letters', tenant],
    queryFn: async () =>
      (await api.call({ path: '/letters/my', schema: z.array(letterItem) })).data,
  });
}
export function useLetter(id: string) {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ['letter', tenant, id],
    queryFn: async () => (await api.call({ path: `/letters/${id}`, schema: letterItem })).data,
  });
}

export function useMySalary() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ['salary', tenant],
    queryFn: async () =>
      (await api.call({ path: '/payroll/my/structure', schema: salaryStructure })).data,
  });
}
export function useMyPayslips() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ['payslips', tenant],
    queryFn: async () =>
      (
        await api.call({
          path: '/payroll/my/payslips',
          query: { limit: 36 },
          schema: z.array(payslipSummary),
        })
      ).data,
  });
}
export function usePayslip(id: string) {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ['payslip', tenant, id],
    queryFn: async () =>
      (await api.call({ path: `/payroll/payslips/${id}`, schema: payslipFull })).data,
  });
}

export function useHandbook() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ['handbook', tenant],
    queryFn: async () =>
      (await api.call({ path: '/handbook', schema: z.array(handbookSection) })).data,
  });
}

export function useTeamToday(enabled: boolean) {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ['team', tenant],
    enabled,
    refetchInterval: 60_000,
    queryFn: async () => (await api.call({ path: '/team/today', schema: teamToday })).data,
  });
}

export function useMyEmployee() {
  const { active } = useAuth();
  return useQuery({
    queryKey: ['employee-self', active?.tenantId ?? 'none'],
    enabled: !!active?.employeeId,
    queryFn: async () =>
      (await api.call({ path: `/employees/${active!.employeeId}`, schema: employeeSelf })).data,
  });
}
