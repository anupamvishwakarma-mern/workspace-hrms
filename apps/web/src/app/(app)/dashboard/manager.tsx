'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useAuth } from '@/components/auth';
import { Alert, Avatar, Badge, Skeleton, Table, Td, Th } from '@/components/ui/display';
import { Button } from '@/components/ui/button';
import { useData } from '@/hooks/api';
import { userMessage } from '@/lib/errors';
import type { Dashboard, TeamMember, TeamToday } from '@/lib/types';
import { ViewHeader } from '../attendance/shared';
import {
  addDay,
  daysSince,
  fullName,
  offMap,
  rangeText,
  useReviewRequests,
  WINDOW_DAYS,
} from '../leave/data';
import { StatusBadge } from '../leave/parts';
import { ActionTile, DonutChart, Panel, StackedColumns, StatRow } from './charts';
import { greetingDate, useFirstName, useToday } from './data';

const STATUS: Record<
  TeamMember['status'],
  { text: string; color: string; tone: 'success' | 'info' | 'neutral' | 'warn' }
> = {
  WORKING: { text: 'Present', color: 'var(--chart-1)', tone: 'success' },
  ON_BREAK: { text: 'On break', color: 'var(--chart-2)', tone: 'warn' },
  CHECKED_OUT: { text: 'Checked out', color: 'var(--chart-6)', tone: 'info' },
  ON_LEAVE: { text: 'On leave', color: 'var(--chart-5)', tone: 'info' },
  NOT_IN: { text: 'Not in yet', color: 'var(--chart-4)', tone: 'neutral' },
};
const COVER = 0.3;

export function ManagerDashboard({ switcher }: { switcher: ReactNode }) {
  const { active } = useAuth();
  const { tz, today, workweek } = useToday();
  const name = useFirstName();
  const team = useData<TeamToday>('team-today', '/team/today');
  const dash = useData<Dashboard>('dashboard', '/reports/dashboard');
  const pendingQ = useReviewRequests('mgr-dash-pending', { status: 'PENDING' });
  const aheadQ = useReviewRequests('mgr-dash-ahead', { from: today, to: addDay(today, 60) });
  const members = team.data?.data.members ?? [];
  const size = members.length;
  const pending = (pendingQ.data ?? []).filter((r) => r.employeeId !== active?.employeeId);
  const oldest = Math.max(0, ...pending.map((r) => daysSince(r.createdAt)));
  const ahead = (aheadQ.data ?? [])
    .filter((r) => r.status === 'APPROVED' || r.status === 'PENDING')
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const off = offMap(ahead, workweek);
  const crowded =
    size > 0
      ? [...off.entries()]
          .filter(([d, s]) => s.size / size >= COVER)
          .sort(([a], [b]) => a.localeCompare(b))[0]
      : undefined;
  const d = dash.data?.data;
  const counts = Object.keys(STATUS).map((k) => ({
    name: STATUS[k as TeamMember['status']].text,
    value: members.filter((m) => m.status === k).length,
    color: STATUS[k as TeamMember['status']].color,
  }));
  const rate = d
    ? (() => {
        const t = d.trend.reduce(
          (s, r) => ({
            p: s.p + r.present + r.halfDay * 0.5,
            n: s.n + r.present + r.halfDay + r.absent,
            l: s.l + r.late,
          }),
          { p: 0, n: 0, l: 0 },
        );
        return t.n
          ? {
              attendance: Math.round((t.p / t.n) * 1000) / 10,
              absent: Math.round((d.trend.reduce((s, r) => s + r.absent, 0) / t.n) * 1000) / 10,
              late: Math.round((t.l / t.n) * 1000) / 10,
            }
          : null;
      })()
    : null;

  return (
    <div className="space-y-6">
      <ViewHeader
        module="dashboard"
        view="manager"
        switcher={switcher}
        crumb={greetingDate(tz)}
        title={`Welcome back, ${name}`}
        sub={`Manager · ${size} direct ${size === 1 ? 'report' : 'reports'}`}
        actions={
          <>
            <Link href="/leave">
              <Button variant="secondary">Team calendar</Button>
            </Link>
            <Link href="/leave">
              <Button>
                Review {pending.length} request{pending.length === 1 ? '' : 's'}
              </Button>
            </Link>
          </>
        }
      />
      {team.isError ? <Alert tone="danger">{userMessage(team.error)}</Alert> : null}

      <section aria-label="Needs your action">
        <h2 className="text-base font-bold">Needs your action</h2>
        <p className="mb-3 text-xs text-muted">
          Approve within {WINDOW_DAYS} working days, then requests escalate to HR
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ActionTile
            href="/leave"
            value={pendingQ.isPending ? '—' : pending.length}
            title="Leave requests"
            sub={
              pending.length
                ? `Oldest waiting ${oldest} ${oldest === 1 ? 'day' : 'days'}`
                : 'Nothing waiting'
            }
            tone={oldest > WINDOW_DAYS ? 'warn' : 'neutral'}
            chip={oldest > WINDOW_DAYS ? 'Past window' : undefined}
          />
          <ActionTile
            href="/approvals"
            value={d?.pending?.corrections ?? '—'}
            title="Attendance corrections"
            sub="Missed punches to review"
          />
          <ActionTile
            href="/approvals"
            value={d?.pending?.exceptions ?? '—'}
            title="Location approvals"
            sub="Punches outside the geofence"
          />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Panel
          className="lg:col-span-2"
          title="Team today"
          sub={
            team.data
              ? `${counts
                  .filter((c) => c.value)
                  .map((c) => `${c.value} ${c.name.toLowerCase()}`)
                  .join(', ')}`
              : undefined
          }
          aside={
            <Link href="/attendance" className="font-semibold text-primary hover:underline">
              Open attendance
            </Link>
          }
        >
          {team.isPending ? (
            <Skeleton className="h-52" />
          ) : members.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">No one reports to you yet.</p>
          ) : (
            <Table aria-label="Team today">
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>Role</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <Td>
                      <span className="flex items-center gap-2">
                        <Avatar name={m.name} size="sm" />
                        <span className="font-medium">{m.name}</span>
                      </span>
                    </Td>
                    <Td>{m.designation ?? '—'}</Td>
                    <Td>
                      <Badge tone={STATUS[m.status].tone}>{STATUS[m.status].text}</Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
        <Panel title="Team mix today">
          <DonutChart
            center={size}
            centerSub="people"
            data={counts.filter((c) => c.value > 0)}
            empty="No team members yet."
          />
        </Panel>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="Last 14 days" sub="Your team's attendance">
          {d ? (
            <StackedColumns
              label="Present, half day and absent team members for each of the last 14 days"
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
        <Panel title="Team this month" sub="Last 14 days">
          <StatRow label="Attendance rate" value={rate ? `${rate.attendance}%` : '—'} />
          <StatRow label="Absenteeism" value={rate ? `${rate.absent}%` : '—'} />
          <StatRow label="Late arrivals" value={rate ? `${rate.late}%` : '—'} />
        </Panel>
      </section>

      <Panel
        title="Upcoming team leave"
        aside={
          <Link href="/leave" className="font-semibold text-primary hover:underline">
            Open calendar
          </Link>
        }
      >
        {crowded ? (
          <Alert tone="danger">
            {rangeText(crowded[0], crowded[0])} is below minimum cover. {crowded[1].size} of {size}{' '}
            people are off.
          </Alert>
        ) : null}
        {aheadQ.isPending ? (
          <Skeleton className="h-32" />
        ) : ahead.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">
            No leave booked in the next 60 days.
          </p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {ahead.slice(0, 8).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  <span className="font-medium">{fullName(r.employee)}</span>
                  <span className="block text-xs text-muted">
                    {rangeText(r.startDate, r.endDate)} · {r.leaveType?.name}
                  </span>
                </span>
                <StatusBadge s={r.status} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
