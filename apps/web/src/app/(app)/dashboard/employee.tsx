'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useAuth } from '@/components/auth';
import { Alert, Skeleton } from '@/components/ui/display';
import { Button } from '@/components/ui/button';
import { useList } from '@/hooks/api';
import { formatMoney } from '@/lib/money';
import type { DayRow, LeaveBalance, LeaveRequest, PayslipRow } from '@/lib/types';
import { formatMinutes } from '@/lib/utils';
import { monthLabel, monthStart, monthStats } from '../attendance/lib';
import { TodayCard } from '../attendance/my-attendance';
import { Kpi, ViewHeader } from '../attendance/shared';
import { rangeText } from '../leave/data';
import { HolidayList } from '../leave/parts';
import { Columns, DonutChart, HBars, Panel } from './charts';
import { greetingDate, useFirstName, useToday } from './data';

const QUICK: [string, string, string][] = [
  ['Apply for leave', 'Casual, sick, earned', '/leave'],
  ['Regularize attendance', 'Fix a missed punch', '/attendance'],
  ['My attendance', 'Calendar and history', '/attendance'],
  ['View payslip', 'Published payslips', '/payroll'],
];

export function EmployeeDashboard({ switcher }: { switcher: ReactNode }) {
  const { can } = useAuth();
  const { tz, today } = useToday();
  const name = useFirstName();
  const month = today.slice(0, 7);
  const ownAtt = can('attendance:read:self');
  const hist = useList<DayRow>(
    'me-history',
    '/attendance/me/history',
    { from: monthStart(month), to: today, limit: 100 },
    ownAtt,
  );
  const bal = useList<LeaveBalance>('my-balances', '/leave/balances', {}, can('leave:apply'));
  const mine = useList<LeaveRequest>(
    'my-leave',
    '/leave/requests',
    { scope: 'mine', limit: 100 },
    can('leave:apply'),
  );
  const pay = useList<PayslipRow>(
    'my-payslips',
    '/payroll/my/payslips',
    { limit: 3 },
    can('payroll:read:self'),
  );

  const rows = hist.data?.data ?? [];
  const s = monthStats(rows);
  const balances = bal.data?.data ?? [];
  const pending = (mine.data?.data ?? []).filter((r) => r.status === 'PENDING');
  const upcoming = (mine.data?.data ?? [])
    .filter((r) => r.status === 'APPROVED' && r.endDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const worked = rows.filter((r) => r.workedMinutes > 0).slice(-7);
  const targetMin = rows.find((r) => r.scheduledMinutes)?.scheduledMinutes ?? 480;
  const takenDays = balances.reduce((n, b) => n + b.approvedDays, 0);
  const mix = [
    { name: 'Present', value: s.present, color: 'var(--chart-1)' },
    { name: 'Half day', value: s.half, color: 'var(--chart-2)' },
    { name: 'On leave', value: s.leave, color: 'var(--chart-5)' },
    { name: 'Absent', value: s.absent, color: 'var(--chart-3)' },
  ].filter((x) => x.value > 0);

  return (
    <div className="space-y-6">
      <ViewHeader
        module="dashboard"
        view="employee"
        switcher={switcher}
        crumb={greetingDate(tz)}
        title={`Welcome back, ${name}`}
        sub="Employee · self-service"
        actions={
          <>
            <Link href="/attendance">
              <Button variant="secondary">Regularize attendance</Button>
            </Link>
            <Link href="/leave">
              <Button>Apply for leave</Button>
            </Link>
          </>
        }
      />

      <section className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-2">
          {ownAtt ? (
            <TodayCard tz={tz} />
          ) : (
            <Alert tone="info">Attendance is not set up for your account.</Alert>
          )}
        </div>
        <Panel
          className="lg:col-span-3"
          title={`${monthLabel(month).split(' ')[0]} at a glance`}
          aside={
            <Link href="/attendance" className="font-semibold text-primary hover:underline">
              Open attendance
            </Link>
          }
        >
          <div className="grid gap-2 sm:grid-cols-4">
            <Kpi label="Present days" value={s.present} sub={`of ${s.workingDays} working days`} />
            <Kpi label="Late marks" value={s.late} />
            <Kpi label="Leave taken" value={takenDays} sub="Approved days this year" />
            <Kpi label="Overtime" value={formatMinutes(s.overtimeMinutes)} />
          </div>
          <p className="text-xs text-muted">
            Net hours, last {worked.length || 7} working days · dashed line is the{' '}
            {formatMinutes(targetMin)} target
          </p>
          {hist.isPending ? (
            <Skeleton className="h-44" />
          ) : (
            <Columns
              label="Net hours worked on each of the last working days"
              height={170}
              data={worked.map((r) => ({
                label: r.workDate.slice(5),
                value: Math.round((r.workedMinutes / 60) * 10) / 10,
              }))}
              target={targetMin / 60}
              targetLabel={`${targetMin / 60}h`}
              format={(n) => `${n}h`}
            />
          )}
        </Panel>
      </section>

      <section aria-label="Quick actions">
        <h2 className="mb-3 text-base font-bold">Quick actions</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK.map(([t, sub, href]) => (
            <Link
              key={t}
              href={href}
              className="block rounded-xl border border-border bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <p className="text-sm font-semibold">{t}</p>
              <p className="text-xs text-muted">{sub}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Leave balance"
          aside={
            <Link href="/leave" className="font-semibold text-primary hover:underline">
              Open leave
            </Link>
          }
        >
          {bal.isPending ? (
            <Skeleton className="h-32" />
          ) : (
            <HBars
              empty="No leave types are set up yet."
              rows={balances.map((b) => ({
                name: b.name,
                value: b.allowanceDays ? (b.remainingDays ?? 0) : b.approvedDays,
                text: b.allowanceDays ? `${b.remainingDays ?? 0} of ${b.allowanceDays}` : 'No cap',
              }))}
            />
          )}
          {pending[0] ? (
            <Alert tone="warn">
              {pending.length} request{pending.length === 1 ? '' : 's'} pending:{' '}
              {pending[0].leaveType?.name}, {rangeText(pending[0].startDate, pending[0].endDate)} (
              {pending[0].days} {pending[0].days === 1 ? 'day' : 'days'}).
            </Alert>
          ) : null}
        </Panel>
        <Panel
          title={`${monthLabel(month).split(' ')[0]} attendance mix`}
          sub="Working days so far"
        >
          <DonutChart
            data={mix}
            center={s.rate === null ? '—' : `${s.rate}%`}
            centerSub="attendance"
            empty="No attendance recorded yet this month."
          />
        </Panel>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel title="Coming up">
          {upcoming.length > 0 ? (
            <ul className="divide-y divide-border text-sm">
              {upcoming.slice(0, 3).map((r) => (
                <li key={r.id} className="flex justify-between gap-3 py-2">
                  <span className="font-medium">{r.leaveType?.name}</span>
                  <span className="text-muted">{rangeText(r.startDate, r.endDate)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No approved leave booked.</p>
          )}
          <p className="pt-1 text-xs font-medium text-muted">Holidays</p>
          <HolidayList from={today} limit={4} />
        </Panel>
        <Panel
          title="Pay and documents"
          sub="Published payslips"
          aside={
            <Link href="/payroll" className="font-semibold text-primary hover:underline">
              Open
            </Link>
          }
        >
          {!can('payroll:read:self') ? (
            <p className="text-sm text-muted">Payslips are not available to your account.</p>
          ) : pay.isPending ? (
            <Skeleton className="h-24" />
          ) : (pay.data?.data.length ?? 0) === 0 ? (
            <p className="text-sm text-muted">No payslip has been published yet.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {pay.data?.data.map((p) => (
                <li key={p.id} className="flex justify-between gap-3 py-2">
                  <span className="font-medium">{monthLabel(p.month)}</span>
                  <span className="tabular-nums text-muted">
                    Net {formatMoney(p.netMinor, p.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>
    </div>
  );
}
