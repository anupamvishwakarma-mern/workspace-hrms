'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useAuth } from '@/components/auth';
import { Kpi, ViewHeader } from '../attendance/shared';
import { useDepartments } from '@/hooks/lookups';
import { HBars, Panel } from './charts';
import { greetingDate, useFirstName, useToday, useWorkforce } from './data';

/**
 * The dashboard for companies without Attendance or Leave switched on: people numbers and shortcuts
 * to the areas this company does have. The richer dashboards need both modules.
 */
export function CoreDashboard({ switcher }: { switcher: ReactNode }) {
  const { can, hasModule } = useAuth();
  const { tz, today, tenant } = useToday();
  const name = useFirstName();
  const month = today.slice(0, 7);
  const wf = useWorkforce(month);
  const depts = useDepartments();
  const w = wf.data;
  const notice = w.all.filter((e) => e.employmentStatus === 'NOTICE_PERIOD');
  const byDept = [...w.byDepartment.entries()]
    .map(([id, v]) => ({ name: depts.name(id) ?? 'No department', value: v }))
    .sort((x, y) => y.value - x.value);
  const links: { href: string; label: string; show: boolean }[] = [
    { href: '/employees', label: 'Employees', show: can('employee:read:all', 'employee:read:team') },
    { href: '/requests', label: 'Requests waiting on you', show: can('approval:use') },
    { href: '/payroll', label: 'Payroll', show: hasModule('PAYROLL') && can('payroll:manage') },
    { href: '/letters', label: 'Letters', show: hasModule('LETTERS') && can('letter:manage') },
    { href: '/handbook', label: 'Handbook', show: hasModule('HANDBOOK') && can('handbook:read', 'handbook:manage') },
    { href: '/leave', label: 'Leave', show: hasModule('LEAVE') && can('leave:review:all', 'leave:review:team', 'leave:manage') },
    { href: '/attendance', label: 'Attendance', show: hasModule('ATTENDANCE') && can('attendance:read:all', 'attendance:read:team') },
  ];
  return (
    <div className="space-y-6">
      <ViewHeader
        module="dashboard"
        view="hr"
        switcher={switcher}
        crumb={greetingDate(tz)}
        title={`Welcome back, ${name}`}
        sub={`${w.headcount} employees${tenant ? ` · ${tenant.name}` : ''}`}
      />
      <section aria-label="Key numbers" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Headcount" value={wf.isPending ? '…' : w.headcount} sub="Active and on notice" />
        <Kpi label="Joiners this month" value={w.joinedIn(month).length} />
        <Kpi label="Exits this month" value={w.leftIn(month).length} />
        <Kpi label="On notice period" value={notice.length} />
      </section>
      <section className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="Headcount by department">
          <HBars rows={byDept.slice(0, 8)} />
        </Panel>
        <Panel title="Go to">
          <ul className="space-y-2 text-sm">
            {links
              .filter((l) => l.show)
              .map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="font-semibold text-primary hover:underline">
                    {l.label}
                  </Link>
                </li>
              ))}
          </ul>
        </Panel>
      </section>
    </div>
  );
}
