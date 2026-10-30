'use client';
import { useQueries } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useAuth } from '@/components/auth';
import {
  Alert,
  Avatar,
  Card,
  CardTitle,
  Empty,
  Skeleton,
  TabBar,
  Table,
  Td,
  Th,
} from '@/components/ui/display';
import { useTenant } from '@/hooks/lookups';
import { api } from '@/lib/api';
import type { LeaveBalance } from '@/lib/types';
import { addDaysIso, todayIso } from '@/lib/utils';
import { Kpi, ViewHeader } from '../attendance/shared';
import { ApprovalsPanel, overlapOf } from './approvals';
import {
  addDay,
  daysSince,
  fullName,
  offMap,
  rangeText,
  useAllEmployees,
  useReviewRequests,
  WINDOW_DAYS,
} from './data';
import { CalendarGrid, Legend, MonthNav, StatusBadge } from './parts';

type Tab = 'overview' | 'approvals' | 'calendar' | 'balances' | 'watch' | 'history';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'calendar', label: 'Team calendar' },
  { key: 'balances', label: 'Balances' },
  { key: 'watch', label: 'Watch-outs' },
  { key: 'history', label: 'History' },
];
const CROWDED = 0.3;

export function ManagerView({ switcher }: { switcher: ReactNode }) {
  const { active } = useAuth();
  const tenant = useTenant();
  const tz = tenant.data?.data.timezone ?? 'UTC';
  const workweek = tenant.data?.data.workweek ?? [1, 2, 3, 4, 5];
  const today = todayIso(tz);
  const [tab, setTab] = useState<Tab>('overview');
  const [month, setMonth] = useState<string>();
  const m = month ?? today.slice(0, 7);

  const team = useAllEmployees(true);
  const pendingQ = useReviewRequests('mgr-pending', { status: 'PENDING' });
  const recentQ = useReviewRequests('mgr-recent', { from: addDaysIso(today, -90) });
  const members = (team.data ?? []).filter((e) => e.id !== active?.employeeId);
  const size = members.length;
  const inTeam = (id: string) => members.some((e) => e.id === id);
  const pending = (pendingQ.data ?? []).filter((r) => r.employeeId !== active?.employeeId);
  const recent = (recentQ.data ?? []).filter((r) => inTeam(r.employeeId) || size === 0);
  const approvedOff = offMap(recent, workweek, ['APPROVED']);
  const anyOff = offMap(recent, workweek);
  const offToday = anyOff.get(today)?.size ?? 0;
  const next7 = Array.from({ length: 7 }, (_, i) => addDay(today, i + 1)).reduce(
    (s, d) => s + (anyOff.get(d)?.size ?? 0),
    0,
  );
  const upcoming = recent
    .filter((r) => r.status === 'APPROVED' && r.endDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const crowded = [...anyOff.entries()]
    .filter(([d, s]) => d >= today && size > 0 && s.size / size >= CROWDED)
    .sort(([a], [b]) => a.localeCompare(b));
  const late = pending.filter((r) => daysSince(r.createdAt) > WINDOW_DAYS);
  const monthDays = recent
    .filter((r) => r.status === 'APPROVED' && r.startDate.slice(0, 7) === m)
    .reduce((s, r) => s + r.days, 0);

  const first = tab === 'balances' ? members.slice(0, 40) : [];
  const balances = useQueries({
    queries: first.map((e) => ({
      queryKey: ['team-balances', active?.tenantId, e.id],
      queryFn: async () =>
        (await api.get<LeaveBalance[]>('/leave/balances', { employeeId: e.id })).data,
    })),
  });
  const typeNames = [...new Set(balances.flatMap((b) => (b.data ?? []).map((x) => x.name)))];

  return (
    <div className="space-y-5">
      <ViewHeader
        module="leave"
        view="manager"
        switcher={switcher}
        crumb="Leave · Team leave"
        title="Team leave"
        sub="Approve requests and plan around who is away."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Waiting for you"
          value={pendingQ.isPending ? '…' : pending.length}
          sub={
            late.length ? `${late.length} past ${WINDOW_DAYS} days` : 'Within the approval window'
          }
        />
        <Kpi
          label="Off today"
          value={offToday}
          sub={size ? `of ${size} in your team` : 'Team size unknown'}
        />
        <Kpi label="Off in next 7 days" value={next7} sub="Person-days, approved and pending" />
        <Kpi label="Approved this month" value={monthDays} sub="Days taken by your team" />
      </div>
      <TabBar tabs={TABS} value={tab} onChange={setTab} />

      {tab === 'overview' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="space-y-3 p-4">
            <CardTitle>Needs your decision</CardTitle>
            <ApprovalsPanel
              reqs={pending.slice(0, 4)}
              off={approvedOff}
              loading={pendingQ.isPending}
            />
            {pending.length > 4 ? (
              <button
                className="text-sm font-semibold text-primary"
                onClick={() => setTab('approvals')}
              >
                See all {pending.length}
              </button>
            ) : null}
          </Card>
          <Card className="space-y-2 p-4">
            <CardTitle>Coming up</CardTitle>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted">No approved leave ahead.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {upcoming.slice(0, 8).map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="font-medium">{fullName(r.employee)}</span>
                    <span className="text-muted">
                      {r.leaveType?.name} · {rangeText(r.startDate, r.endDate)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      ) : null}

      {tab === 'approvals' ? (
        <ApprovalsPanel reqs={pending} off={approvedOff} loading={pendingQ.isPending} />
      ) : null}

      {tab === 'calendar' ? (
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <CardTitle>Team calendar</CardTitle>
            <MonthNav month={m} onChange={setMonth} />
          </div>
          <CalendarGrid
            month={m}
            today={today}
            cell={(d) => {
              if (!workweek.includes(new Date(`${d}T00:00:00Z`).getUTCDay()))
                return { tone: 'off', text: 'Off' };
              const n = anyOff.get(d)?.size ?? 0;
              if (n === 0) return {};
              const heavy = size > 0 && n / size >= CROWDED;
              return {
                text: `${n} off`,
                sub: size ? `${Math.round((n / size) * 100)}%` : undefined,
                tone: heavy ? 'danger' : 'info',
              };
            }}
          />
          <Legend
            items={[
              [`${Math.round(CROWDED * 100)}%+ of team off`, 'danger'],
              ['Someone off', 'info'],
              ['Weekly off', 'off'],
            ]}
          />
        </Card>
      ) : null}

      {tab === 'balances' ? (
        team.isPending ? (
          <Skeleton className="h-40" />
        ) : members.length === 0 ? (
          <Empty>No one reports to you yet.</Empty>
        ) : (
          <Table aria-label="Team balances">
            <thead>
              <tr>
                <Th>Employee</Th>
                {typeNames.map((n) => (
                  <Th key={n}>{n}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {first.map((e, i) => {
                const rows = balances[i]?.data;
                return (
                  <tr key={e.id}>
                    <Td>
                      <span className="flex items-center gap-2">
                        <Avatar name={fullName(e)} size="sm" />
                        {fullName(e)}
                      </span>
                    </Td>
                    {typeNames.map((n) => {
                      const b = rows?.find((x) => x.name === n);
                      return (
                        <Td key={n}>
                          {!rows
                            ? '…'
                            : !b
                              ? '—'
                              : b.remainingDays === null
                                ? 'No cap'
                                : `${b.remainingDays} left`}
                        </Td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )
      ) : null}

      {tab === 'watch' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="space-y-2 p-4">
            <CardTitle>Crowded days ahead</CardTitle>
            {crowded.length === 0 ? (
              <p className="text-sm text-muted">
                No day has {Math.round(CROWDED * 100)}% or more of your team off.
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {crowded.slice(0, 10).map(([d, s]) => (
                  <li key={d} className="flex justify-between">
                    <span className="font-medium">{rangeText(d, d)}</span>
                    <span className="text-muted">
                      {s.size} of {size} off
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="space-y-2 p-4">
            <CardTitle>Waiting too long</CardTitle>
            {late.length === 0 ? (
              <p className="text-sm text-muted">
                Every request is inside the {WINDOW_DAYS}-day window.
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {late.map((r) => (
                  <li key={r.id} className="flex justify-between">
                    <span className="font-medium">{fullName(r.employee)}</span>
                    <span className="text-muted">
                      {daysSince(r.createdAt)} days · {overlapOf(r, approvedOff)} others off
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      ) : null}

      {tab === 'history' ? (
        recentQ.isPending ? (
          <Skeleton className="h-40" />
        ) : (
          <>
            {recent.length === 0 ? (
              <Alert tone="info">No leave in the last 90 days.</Alert>
            ) : (
              <Table aria-label="Leave history">
                <thead>
                  <tr>
                    <Th>Employee</Th>
                    <Th>Type</Th>
                    <Th>Dates</Th>
                    <Th>Days</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {recent
                    .filter((r) => r.status !== 'PENDING')
                    .map((r) => (
                      <tr key={r.id}>
                        <Td className="font-medium">{fullName(r.employee)}</Td>
                        <Td>{r.leaveType?.name}</Td>
                        <Td>{rangeText(r.startDate, r.endDate)}</Td>
                        <Td>{r.days}</Td>
                        <Td>
                          <StatusBadge s={r.status} />
                        </Td>
                      </tr>
                    ))}
                </tbody>
              </Table>
            )}
          </>
        )
      ) : null}
    </div>
  );
}
