'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Alert, Badge, Skeleton } from '@/components/ui/display';
import { useData } from '@/hooks/api';
import { useDepartments } from '@/hooks/lookups';
import { userMessage } from '@/lib/errors';
import type { Dashboard, LeaveOverview, Overview } from '@/lib/types';
import { Kpi, ViewHeader, fmtPct } from '../attendance/shared';
import { monthLabel } from '../attendance/lib';
import { daysSince, useReviewRequests, WINDOW_DAYS } from '../leave/data';
import { HolidayList } from '../leave/parts';
import { ActionTile, DonutChart, HBars, Panel, StackedColumns, StatRow } from './charts';
import { greetingDate, useFirstName, useToday, useWorkforce } from './data';

export function HrDashboard({ switcher }: { switcher: ReactNode }) {
  const { tz, today, tenant } = useToday();
  const name = useFirstName();
  const month = today.slice(0, 7);
  const dash = useData<Dashboard>('dashboard', '/reports/dashboard');
  const att = useData<Overview>('att-overview', '/reports/attendance/overview', { month });
  const leave = useData<LeaveOverview>('leave-overview', '/reports/leave/overview', { month });
  const pendingLeave = useReviewRequests('hr-dash-pending', { status: 'PENDING' });
  const wf = useWorkforce(month);
  const depts = useDepartments();
  const w = wf.data;
  const d = dash.data?.data;
  const a = att.data?.data;
  const l = leave.data?.data;
  const joined = w.joinedIn(month);
  const left = w.leftIn(month);
  const notice = w.all.filter((e) => e.employmentStatus === 'NOTICE_PERIOD');
  const pendingN = pendingLeave.data?.length ?? 0;
  const lateLeave = (pendingLeave.data ?? []).filter(
    (r) => daysSince(r.createdAt) > WINDOW_DAYS,
  ).length;
  const byDept = [...w.byDepartment.entries()]
    .map(([id, v]) => ({ name: depts.name(id) ?? 'No department', value: v }))
    .sort((x, y) => y.value - x.value);

  return (
    <div className="space-y-6">
      <ViewHeader
        module="dashboard"
        view="hr"
        switcher={switcher}
        crumb={greetingDate(tz)}
        title={`Welcome back, ${name}`}
        sub={`HR · ${w.headcount} employees${tenant ? ` · ${tenant.name}` : ''}`}
      />
      {dash.isError ? <Alert tone="danger">{userMessage(dash.error)}</Alert> : null}

      <section
        aria-label="Key numbers"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
      >
        <Kpi
          label="Headcount"
          value={wf.isPending ? '…' : w.headcount}
          sub="Active and on notice"
        />
        <Kpi label="Joiners this month" value={joined.length} />
        <Kpi label="Exits this month" value={left.length} sub={`${notice.length} on notice`} />
        <Kpi
          label="Attrition, last 12 months"
          value={fmtPct(w.attrition12.pct)}
          sub={`${w.attrition12.leavers} leavers`}
        />
        <Kpi
          label="Attendance rate"
          value={fmtPct(a?.current.attendanceRate)}
          sub={monthLabel(month)}
        />
        <Kpi label="On leave today" value={l?.onLeaveToday.people ?? '…'} />
      </section>

      <section aria-label="Needs your action">
        <h2 className="text-base font-bold">Needs your action</h2>
        <p className="mb-3 text-xs text-muted">Sorted by what affects payroll first</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ActionTile
            href="/approvals"
            value={d?.pending?.exceptions ?? '—'}
            title="Location exceptions"
            sub="Punches outside the geofence"
            chip="Blocks payroll"
            tone="danger"
          />
          <ActionTile
            href="/approvals"
            value={d?.pending?.corrections ?? '—'}
            title="Attendance corrections"
            sub="Waiting for manager or HR"
            chip="Blocks payroll"
            tone="danger"
          />
          <ActionTile
            href="/leave"
            value={pendingLeave.isPending ? '—' : pendingN}
            title="Leave approvals"
            sub={
              lateLeave
                ? `${lateLeave} past the ${WINDOW_DAYS}-day window`
                : 'All within the window'
            }
            chip="Review"
            tone="warn"
          />
          <ActionTile
            href="/attendance"
            value={a?.attention.lateMarkLimit.count ?? '—'}
            title="Over the late-mark limit"
            sub={a ? `${a.attention.lateMarkLimit.limit}+ late marks this month` : undefined}
            chip="Review"
            tone="warn"
          />
          <ActionTile
            href="/attendance"
            value={a?.attention.absentStreak.count ?? '—'}
            title="Absent streaks"
            sub={a ? `${a.attention.absentStreak.days}+ days in a row` : undefined}
            chip="This week"
            tone="info"
          />
          <ActionTile
            href="/employees"
            value={notice.length}
            title="Exits in progress"
            sub="On notice period"
            chip="This month"
          />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Panel
          className="lg:col-span-2"
          title="Workforce today"
          aside={
            <Link href="/attendance" className="font-semibold text-primary hover:underline">
              Open live attendance
            </Link>
          }
        >
          {a ? (
            <div className="grid gap-5 md:grid-cols-2">
              <DonutChart
                center={a.live.present}
                centerSub="present"
                data={[
                  { name: 'Present', value: a.live.present, color: 'var(--chart-1)' },
                  { name: 'On leave', value: a.live.onLeave, color: 'var(--chart-5)' },
                  { name: 'Absent', value: a.live.absent, color: 'var(--chart-3)' },
                  { name: 'Not in yet', value: a.live.notIn, color: 'var(--chart-4)' },
                ]}
              />
              <div>
                <p className="mb-2 text-xs font-medium text-muted">Headcount by department</p>
                <HBars rows={byDept.slice(0, 6)} />
              </div>
            </div>
          ) : (
            <Skeleton className="h-44" />
          )}
        </Panel>
        <Panel
          title={`${monthLabel(month).split(' ')[0]} payroll readiness`}
          sub={
            a ? `${a.compliance.openLocationExceptions} location exceptions still open` : undefined
          }
        >
          {a ? (
            <>
              <StatRow
                label="Exceptions resolved"
                value={
                  <Badge tone={(d?.pending?.exceptions ?? 0) === 0 ? 'success' : 'danger'}>
                    {(d?.pending?.exceptions ?? 0) === 0
                      ? 'Done'
                      : `${d?.pending?.exceptions} open`}
                  </Badge>
                }
              />
              <StatRow
                label="Corrections approved"
                value={
                  <Badge tone={(d?.pending?.corrections ?? 0) === 0 ? 'success' : 'warn'}>
                    {(d?.pending?.corrections ?? 0) === 0
                      ? 'Done'
                      : `${d?.pending?.corrections} waiting`}
                  </Badge>
                }
              />
              <StatRow
                label="Leave approvals up to date"
                value={
                  <Badge tone={pendingN === 0 ? 'success' : 'warn'}>
                    {pendingN === 0 ? 'Done' : `${pendingN} waiting`}
                  </Badge>
                }
              />
              <StatRow
                label="Payroll for this month"
                value={
                  <Badge tone={a.compliance.currentMonthPayroll ? 'info' : 'neutral'}>
                    {a.compliance.currentMonthPayroll ?? 'Not started'}
                  </Badge>
                }
              />
              <Link
                href="/payroll"
                className="inline-block pt-2 text-sm font-semibold text-primary hover:underline"
              >
                Open payroll
              </Link>
            </>
          ) : (
            <Skeleton className="h-40" />
          )}
        </Panel>
      </section>

      <Panel
        title="Last 14 days"
        sub="Daily attendance across the company"
        aside={
          <Link href="/reports" className="font-semibold text-primary hover:underline">
            Open reports
          </Link>
        }
      >
        {d ? (
          <StackedColumns
            label="Present, half day and absent employees for each of the last 14 days"
            data={d.trend.map((r) => ({ ...r, label: r.date.slice(5) }))}
            series={[
              { key: 'present', name: 'Present', color: 'var(--chart-1)' },
              { key: 'halfDay', name: 'Half day', color: 'var(--chart-2)' },
              { key: 'absent', name: 'Absent', color: 'var(--chart-3)' },
            ]}
          />
        ) : (
          <Skeleton className="h-60" />
        )}
      </Panel>

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel title="Leave by type" sub="Last 6 months">
          {l ? (
            <DonutChart
              pie
              data={l.byType.map((t) => ({ name: t.name, value: t.days }))}
              empty="No leave taken in this period."
            />
          ) : (
            <Skeleton className="h-40" />
          )}
        </Panel>
        <Panel
          title="Joined this month"
          sub={`${joined.length} new ${joined.length === 1 ? 'joiner' : 'joiners'}`}
        >
          {joined.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">No one joined this month.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {joined.map((e) => (
                <li key={e.id} className="flex justify-between gap-3 py-2">
                  <span className="font-medium">
                    {e.firstName} {e.lastName}
                  </span>
                  <span className="text-muted">
                    {depts.name(e.departmentId) ?? 'No department'} · {e.joiningDate?.slice(8, 10)}/
                    {e.joiningDate?.slice(5, 7)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Exits in progress">
          {notice.length === 0 && left.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">No exits in progress.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {[...notice, ...left.filter((e) => e.employmentStatus !== 'NOTICE_PERIOD')].map(
                (e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                    <span>
                      <span className="font-medium">{e.employeeCode}</span>
                      <span className="block text-xs text-muted">
                        {depts.name(e.departmentId) ?? 'No department'}
                        {e.lastWorkingDate ? ` · Last day ${e.lastWorkingDate.slice(0, 10)}` : ''}
                      </span>
                    </span>
                    <Badge tone={e.employmentStatus === 'NOTICE_PERIOD' ? 'warn' : 'neutral'}>
                      {e.employmentStatus === 'NOTICE_PERIOD' ? 'On notice' : 'Left'}
                    </Badge>
                  </li>
                ),
              )}
            </ul>
          )}
        </Panel>
        <Panel title="Upcoming holidays">
          <HolidayList from={today} limit={5} />
        </Panel>
      </section>
    </div>
  );
}
