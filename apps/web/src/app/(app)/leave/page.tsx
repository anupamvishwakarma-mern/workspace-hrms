'use client';
import { useState } from 'react';
import { useAuth } from '@/components/auth';
import { Alert, Skeleton } from '@/components/ui/display';
import { ViewSwitcher, type ViewKey } from '../attendance/shared';
import { EmployeeView } from './employee-view';
import { HrView } from './hr-view';
import { ManagerView } from './manager-view';
import { OwnerView } from './owner-view';

const ORDER: ViewKey[] = ['employee', 'manager', 'hr', 'owner'];
const KEY = 'wf.leave.view';
const readPref = (): ViewKey | null => {
  try {
    const v = window.sessionStorage.getItem(KEY);
    return v === 'employee' || v === 'manager' || v === 'hr' || v === 'owner' ? v : null;
  } catch {
    return null;
  }
};

/**
 * One page, four views, chosen by permissions: Owner (company insights, read-only), HR (approve, balances,
 * leave types), Manager (their team) and Employee (own leave). People allowed several can switch between them.
 */
export default function LeavePage() {
  const { can, active, status } = useAuth();
  const [picked, setPicked] = useState<ViewKey | null>(null);
  if (status !== 'ready' || !active) return <Skeleton className="h-96" />;

  const allowed: Record<ViewKey, boolean> = {
    employee: can('leave:apply') && !!active.employeeId,
    manager: can('leave:review:team') && !can('leave:review:all'),
    hr: can('leave:review:all'),
    owner: active.roles.includes('COMPANY_OWNER') && can('leave:read:all'),
  };
  const views = ORDER.filter((v) => allowed[v]);
  const stored = picked ?? readPref();
  const view: ViewKey | undefined =
    stored && views.includes(stored)
      ? stored
      : (['owner', 'hr', 'manager', 'employee'] as const).find((v) => views.includes(v));

  if (!view)
    return (
      <Alert tone="info">
        Your account has no employee profile and no leave access. Ask a company administrator to
        link one.
      </Alert>
    );

  const choose = (v: ViewKey) => {
    setPicked(v);
    try {
      window.sessionStorage.setItem(KEY, v);
    } catch {
      /* the choice still applies for this visit */
    }
  };
  const switcher = <ViewSwitcher views={views} value={view} onChange={choose} />;
  return view === 'owner' ? (
    <OwnerView switcher={switcher} />
  ) : view === 'hr' ? (
    <HrView switcher={switcher} />
  ) : view === 'manager' ? (
    <ManagerView switcher={switcher} />
  ) : (
    <EmployeeView switcher={switcher} />
  );
}
