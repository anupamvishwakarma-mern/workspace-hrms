'use client';
import { useState } from 'react';
import { useAuth } from '@/components/auth';
import { Alert, Skeleton } from '@/components/ui/display';
import { ViewSwitcher, type ViewKey } from '../attendance/shared';
import { EmployeeDashboard } from './employee';
import { HrDashboard } from './hr';
import { ManagerDashboard } from './manager';
import { OwnerDashboard } from './owner';

const ORDER: ViewKey[] = ['employee', 'manager', 'hr', 'owner'];
const KEY = 'wf.dashboard.view';
const readPref = (): ViewKey | null => {
  try {
    const v = window.sessionStorage.getItem(KEY);
    return v === 'employee' || v === 'manager' || v === 'hr' || v === 'owner' ? v : null;
  } catch {
    return null;
  }
};

/**
 * One dashboard, four views, chosen by permissions: Owner (company insights), HR (what needs action),
 * Manager (their team) and Employee (own day). People allowed several can switch between them.
 */
export default function DashboardPage() {
  const { can, active, status } = useAuth();
  const [picked, setPicked] = useState<ViewKey | null>(null);
  if (status !== 'ready' || !active) return <Skeleton className="h-96" />;

  const allowed: Record<ViewKey, boolean> = {
    employee: can('attendance:read:self', 'leave:apply') && !!active.employeeId,
    manager: can('attendance:read:team') && !can('attendance:read:all'),
    hr: can('attendance:review:all') || can('leave:review:all'),
    owner: active.roles.includes('COMPANY_OWNER') && can('attendance:read:all'),
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
        Your account has no dashboard yet. Ask a company administrator to link an employee profile.
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
    <OwnerDashboard switcher={switcher} />
  ) : view === 'hr' ? (
    <HrDashboard switcher={switcher} />
  ) : view === 'manager' ? (
    <ManagerDashboard switcher={switcher} />
  ) : (
    <EmployeeDashboard switcher={switcher} />
  );
}
