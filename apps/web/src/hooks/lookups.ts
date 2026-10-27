'use client';
import { useList, useOne } from './api';
import type { Department, Tenant } from '@/lib/types';

export const useTenant = () => useOne<Tenant>('tenant', '/tenants/current');
export function useDepartments(enabled = true) {
  const q = useList<Department>('departments', '/departments', { limit: 100 }, enabled);
  return {
    ...q,
    items: q.data?.data ?? [],
    name: (id?: string) => q.data?.data.find((d) => d.id === id)?.name,
  };
}
