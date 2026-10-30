'use client';
import { useState } from 'react';
import { useAuth } from '@/components/auth';
import { Alert, Skeleton } from '@/components/ui/display';
import { EmployeeView } from './employee-view';
import { HrView } from './hr-view';
import { OwnerView } from './owner-view';
import { ViewSwitcher, type ViewKey } from './shared';

const ORDER: ViewKey[] = ['employee', 'hr', 'owner'];
const KEY = 'wf.attendance.view';
const readPref = (): ViewKey | null => {
  try {
    const v = window.sessionStorage.getItem(KEY);
    return v === 'employee' || v === 'hr' || v === 'owner' ? v : null;
  } catch {
    return null;
  }
};

/**
 * One page, three views. Which ones a person gets follows their permissions, never a setting:
 * Owner (company-wide insights, read-only), HR (manage, approve and configure) and Employee (own attendance,
 * plus a team tab for managers). Someone allowed several can switch between them.
 */
export default function AttendancePage() {
  const { can, active, status } = useAuth();
  const [picked, setPicked] = useState<ViewKey | null>(null);
  if (status !== 'ready' || !active) return <Skeleton className="h-96" />;

  const allowed: Record<ViewKey, boolean> = {
    manager: false, // attendance has no separate manager view; managers use the Employee view's team tab
    employee: can('attendance:read:self') && !!active.employeeId,
    hr: can('attendance:review:all'),
    owner: active.roles.includes('COMPANY_OWNER') && can('attendance:read:all'),
  };
  const views = ORDER.filter((v) => allowed[v]);
  // Payroll admins and managers have no HR or owner view, but still see their team and reports.
  const fallback: ViewKey | null =
    views.length === 0 && can('attendance:read:all', 'attendance:read:team') ? 'employee' : null;
  const stored = picked ?? readPref();
  const view: ViewKey | undefined =
    stored && views.includes(stored)
      ? stored
      : ((views.includes('owner') ? 'owner' : views.includes('hr') ? 'hr' : views[0]) ??
        fallback ??
        undefined);

  if (!view)
    return (
      <Alert tone="info">
        Your account has no employee profile and no attendance access. Ask a company administrator
        to link one.
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
  ) : (
    <EmployeeView switcher={switcher} />
  );
}
