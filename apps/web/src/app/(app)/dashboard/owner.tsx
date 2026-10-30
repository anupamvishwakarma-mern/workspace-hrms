'use client';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Alert, Badge, Skeleton } from '@/components/ui/display';
import { Field, Select } from '@/components/ui/form';
import { useData } from '@/hooks/api';
import { useDepartments } from '@/hooks/lookups';
import { userMessage } from '@/lib/errors';
import type { LeaveOverview, Overview } from '@/lib/types';
import { MONTH_OPTIONS, Delta, Kpi, ViewHeader, fmtPct } from '../attendance/shared';
import { monthLabel } from '../attendance/lib';
import { Columns, DonutChart, HBars, Panel, StatRow } from './charts';
import { greetingDate, useFirstName, useToday, useWorkforce } from './data';

export function OwnerDashboard({ switcher }: { switcher: ReactNode }) {
  const { tz, today, tenant } = useToday();
  const name = useFirstName();
  const cur = today.slice(0, 7);
  const [month, setMonth] = useState(cur);
  const att = useData<Overview>('att-overview', '/reports/attendance/overview', { month });
  const leave = useData<LeaveOverview>('leave-overview', '/reports/leave/overview', { month });
  const wf = useWorkforce(month);
  const depts = useDepartments();
  const w = wf.data;
  const a = att.data?.data;
  const l = leave.data?.data;
  const joined = w.joinedIn(month);
  const left = w.leftIn(month);
  const deptName = (id: string) => depts.name(id) ?? 'No department';

  const byDept = [...w.byDepartment.entries()]
    .map(([id, v]) => ({ name: deptName(id), value: v }))
    .sort((x, y) => y.value - x.value);
  const leavers = [...w.leaversByDepartment.entries()]
    .map(([id, v]) => ({ name: deptName(id), value: v }))
    .sort((x, y) => y.value - x.value);
  const people = [
    ...joined.map((e) => ({ e, kind: 'Joiner' as const, date: e.joiningDate!.slice(0, 10) })),
    ...left.map((e) => ({ e, kind: 'Leaver' as const, date: e.lastWorkingDate!.slice(0, 10) })),
  ].sort((x, y) => x.date.localeCompare(y.date));

  return (
    <div className="space-y-6">
      <ViewHeader
        module="dashboard"
        view="owner"
        switcher={switcher}
        crumb={greetingDate(tz)}
        title={`Welcome back, ${name}`}
        sub={`Owner · ${w.headcount} employees${tenant ? ` · ${tenant.name}` : ''}`}
        actions={
          <Field label="Period">
            {(id) => (
              <Select id={id} value={month} onChange={(e) => setMonth(e.target.value)}>
                {MONTH_OPTIONS(cur).map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        }
      />
      {att.isError ? <Alert tone="danger">{userMessage(att.error)}</Alert> : null}

      <section
        aria-label="Key numbers"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
      >
        <Kpi
          label="Headcount"
          value={wf.isPending ? '…' : w.headcount}
          sub={`${joined.length} joined · ${left.length} left this month`}
        />
        <Kpi label="Attendance rate" value={fmtPct(a?.current.attendanceRate)}>
          {a ? (
            <Delta cur={a.current.attendanceRate} prev={a.previous.attendanceRate} unit="pts" />
          ) : null}
        </Kpi>
        <Kpi
          label="Attrition, last 12 months"
          value={fmtPct(w.attrition12.pct)}
          sub={`${w.attrition12.leavers} leavers · average headcount ${w.attrition12.avgHeadcount}`}
        />
        <Kpi
          label={`Leave days in ${monthLabel(month).split(' ')[0]}`}
          value={l?.current.days ?? '…'}
        >
          {l ? (
            <Delta cur={l.current.days} prev={l.previous.days} unit="days" neutral percent />
          ) : null}
        </Kpi>
        <Kpi
          label="On leave today"
          value={l ? `${l.onLeaveToday.people}` : '…'}
          sub={l ? `of ${l.onLeaveToday.headcount} people` : undefined}
        />
        <Kpi
          label="Unused leave"
          value={l ? `${l.liability.unusedDays} days` : '…'}
          sub={l ? `${l.liability.avgUnusedPerPerson} per person` : undefined}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Panel
          className="lg:col-span-2"
          title="Headcount · 6 months"
          sub={`${joined.length} joined and ${left.length} left in ${monthLabel(month).split(' ')[0]}`}
        >
          {wf.isPending ? (
            <Skeleton className="h-52" />
          ) : (
            <Columns
              label="Headcount at the end of each of the last six months"
              data={w.headcountTrend}
              min={Math.max(0, Math.floor(Math.min(...w.headcountTrend.map((t) => t.value)) * 0.9))}
            />
          )}
          <p className="text-xs text-muted">
            The axis does not start at zero, so small changes show.
          </p>
        </Panel>
        <Panel title="Where people are today" sub="Everyone expected at work">
          {a ? (
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
          ) : (
            <Skeleton className="h-40" />
          )}
        </Panel>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel title="By department" sub="Share of headcount">
          <DonutChart pie data={byDept} center={w.headcount} centerSub="people" />
        </Panel>
        <Panel title="By location">
          {a ? (
            <HBars
              rows={a.byLocation.map((x) => ({ name: x.name, value: x.headcount }))}
              empty="No work locations set up."
            />
          ) : (
            <Skeleton className="h-32" />
          )}
        </Panel>
      </section>

      <section aria-label="People health">
        <h2 className="text-base font-bold">People health</h2>
        <p className="mb-3 text-xs text-muted">Open an overview for the full picture</p>
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel
            title="Attendance overview"
            aside={
              <Link href="/attendance" className="font-semibold text-primary hover:underline">
                Open
              </Link>
            }
          >
            <StatRow label="Attendance rate" value={fmtPct(a?.current.attendanceRate)} />
            <StatRow label="Absenteeism" value={fmtPct(a?.current.absenteeism)} />
            <StatRow label="Late arrivals" value={fmtPct(a?.current.lateRate)} />
          </Panel>
          <Panel
            title="Leave overview"
            aside={
              <Link href="/leave" className="font-semibold text-primary hover:underline">
                Open
              </Link>
            }
          >
            <StatRow
              label="On leave today"
              value={l ? `${l.onLeaveToday.people} of ${l.onLeaveToday.headcount}` : '—'}
            />
            <StatRow label="Unplanned leave share" value={fmtPct(l?.current.unplannedShare)} />
            <StatRow label="Teams with a crowded week ahead" value={l?.coverage.length ?? '—'} />
          </Panel>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel title="Leave by type" sub="Last 6 months">
          {l ? (
            <DonutChart
              data={l.byType.map((t) => ({ name: t.name, value: t.days }))}
              center={l.totalDays6m}
              centerSub="days"
              empty="No leave taken in this period."
            />
          ) : (
            <Skeleton className="h-40" />
          )}
        </Panel>
        <Panel
          title="Leavers, last 12 months"
          sub={`${w.attrition12.leavers} in total · ${fmtPct(w.attrition12.pct)} attrition (leavers divided by average headcount ${w.attrition12.avgHeadcount})`}
        >
          <HBars
            rows={leavers}
            color="var(--chart-3)"
            empty="No one has left in the last 12 months."
          />
        </Panel>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel title="Payroll and compliance" sub={monthLabel(month)}>
          {a ? (
            <>
              <StatRow
                label="Previous month payroll"
                value={
                  <Badge tone={a.compliance.previousMonthPayroll ? 'success' : 'neutral'}>
                    {a.compliance.previousMonthPayroll ?? 'No run'}
                  </Badge>
                }
              />
              <StatRow
                label="This month payroll"
                value={
                  <Badge tone={a.compliance.currentMonthPayroll ? 'info' : 'neutral'}>
                    {a.compliance.currentMonthPayroll ?? 'Not started'}
                  </Badge>
                }
              />
              <StatRow
                label="Open location exceptions"
                value={a.compliance.openLocationExceptions}
              />
              <StatRow label="Manual edits approved" value={a.compliance.manualEditsApproved} />
              <StatRow
                label="Geofence required"
                value={a.compliance.geofenceRequired ? 'Yes' : 'No'}
              />
            </>
          ) : (
            <Skeleton className="h-32" />
          )}
        </Panel>
        <Panel title="Joiners and leavers this month" sub="Dates are joining and last working day">
          {people.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">No joiners or leavers this month.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {people.map(({ e, kind, date }) => (
                <li key={`${kind}${e.id}`} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    <span className="font-medium">
                      {e.firstName} {e.lastName}
                    </span>
                    <span className="block text-xs text-muted">
                      {depts.name(e.departmentId) ?? 'No department'} ·{' '}
                      {kind === 'Joiner' ? 'Joined' : 'Last day'} {date.slice(8)}{' '}
                      {monthLabel(date.slice(0, 7)).slice(0, 3)}
                    </span>
                  </span>
                  <Badge tone={kind === 'Joiner' ? 'success' : 'neutral'}>{kind}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>
    </div>
  );
}
