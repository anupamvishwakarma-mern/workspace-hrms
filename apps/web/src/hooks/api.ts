'use client';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useAuth } from '@/components/auth';
import { api, type Envelope } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import { useState } from 'react';

/** Query keys always include the company so a switch can never show another company's rows. */
export function useList<T>(
  name: string,
  path: string,
  query: Record<string, unknown> = {},
  enabled = true,
) {
  const tenant = useAuth().active?.tenantId ?? 'none';
  return useQuery<Envelope<T[]>>({
    queryKey: [name, tenant, path, query],
    queryFn: ({ signal }) => api.get<T[]>(path, query, signal),
    enabled: enabled && tenant !== 'none',
    placeholderData: keepPreviousData,
  });
}

export function useOne<T>(name: string, path: string, enabled = true) {
  const tenant = useAuth().active?.tenantId ?? 'none';
  return useQuery<Envelope<T>>({
    queryKey: [name, tenant, path],
    queryFn: ({ signal }) => api.get<T>(path, undefined, signal),
    enabled: enabled && tenant !== 'none',
  });
}

/** Mutation that invalidates the given query groups and exposes a user-safe error string. */
export function useSave<V, R = unknown>(
  fn: (v: V) => Promise<R>,
  invalidate: string[],
  onDone?: (r: R) => void,
) {
  const qc = useQueryClient();
  const [error, setError] = useState<string>();
  const m = useMutation({
    mutationFn: fn,
    onMutate: () => setError(undefined),
    onSuccess: async (r) => {
      await Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: [k] })));
      onDone?.(r);
    },
    onError: (e) => setError(userMessage(e)),
  });
  return { ...m, error, clearError: () => setError(undefined) };
}
