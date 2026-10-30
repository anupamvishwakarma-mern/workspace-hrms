'use client';
import { useList, useOne } from './api';
import type { Department, Designation, Tenant } from '@/lib/types';

export const useTenant = () => useOne<Tenant>('tenant', '/tenants/current');
export function useDepartments(enabled = true) {
  const q = useList<Department>('departments', '/departments', { limit: 100 }, enabled);
  return {
    ...q,
    items: q.data?.data ?? [],
    name: (id?: string) => q.data?.data.find((d) => d.id === id)?.name,
  };
}

/** Active designations for pickers (everyone may read them; only HR/owner manage them). */
export function useDesignations(enabled = true) {
  const q = useList<Designation>(
    'designations',
    '/designations',
    { limit: 100, status: 'ACTIVE' },
    enabled,
  );
  return { ...q, items: q.data?.data ?? [] };
}
