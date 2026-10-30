'use client';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Alert,
  Card,
  CardTitle,
  Empty,
  Skeleton,
  TabBar,
  Table,
  Td,
  Th,
} from '@/components/ui/display';
import { useList, useSave } from '@/hooks/api';
import { useTenant } from '@/hooks/lookups';
import { api } from '@/lib/api';
import type { Holiday, LeaveBalance, LeaveRequest, LeaveType } from '@/lib/types';
import { todayIso } from '@/lib/utils';
import { Kpi, Meter, ViewHeader } from '../attendance/shared';
import { eachDate, rangeText } from './data';
import {
  ApplyForm,
  CalendarGrid,
  HolidayList,
  LEAVE_REFRESH,
  Legend,
  MonthNav,
  StatusBadge,
  type CalCell,
} from './parts';

type Tab = 'balance' | 'apply' | 'calendar' | 'requests' | 'holidays' | 'policy';
const TABS: { key: Tab; label: string }[] = [
  { key: 'balance', label: 'Balance' },
  { key: 'apply', label: 'Apply' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'requests', label: 'My requests' },
  { key: 'holidays', label: 'Holidays' },
  { key: 'policy', label: 'Policy' },
];

export function EmployeeView({ switcher }: { switcher: ReactNode }) {
  const tenant = useTenant();
  const tz = tenant.data?.data.timezone ?? 'UTC';
  const today = todayIso(tz);
  const [tab, setTab] = useState<Tab>('balance');
  const [month, setMonth] = useState<string>();
  const m = month ?? today.slice(0, 7);
  const bal = useList<LeaveBalance>('my-balances', '/leave/balances', {});
  const mine = useList<LeaveRequest>('my-leave', '/leave/requests', { scope: 'mine', limit: 100 });
  const hol = useList<Holiday>('holidays-upcoming', '/holidays', { from: `${m}-01`, limit: 100 });
  const types = useList<LeaveType>('leave-types', '/leave-types', { limit: 100 });
  const cancel = useSave(
    (id: string) => api.post(`/leave/requests/${id}/cancel`, {}),
    LEAVE_REFRESH,
  );

  const balances = bal.data?.data ?? [];
  const reqs = mine.data?.data ?? [];
  const pending = reqs.filter((r) => r.status === 'PENDING');
  const upcoming = reqs
    .filter((r) => r.status === 'APPROVED' && r.endDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const capped = balances.filter((b) => b.remainingDays !== null);
  const remaining = capped.reduce((s, b) => s + (b.remainingDays ?? 0), 0);
  const used = balances.reduce((s, b) => s + b.approvedDays, 0);
  const pendingDays = balances.reduce((s, b) => s + b.pendingDays, 0);
  const balanceOf = (id: string) => balances.find((b) => b.leaveTypeId === id)?.remainingDays;

  const dayInfo = new Map<string, CalCell>();
  for (const r of reqs) {
    if (r.status !== 'APPROVED' && r.status !== 'PENDING') continue;
    for (const d of eachDate(r.startDate, r.endDate))
      dayInfo.set(d, {
        text: r.leaveType?.code ?? 'Leave',
        sub: r.status === 'PENDING' ? 'Pending' : 'Approved',
        tone: r.status === 'PENDING' ? 'warn' : 'info',
      });
  }
  for (const h of hol.data?.data ?? [])
    dayInfo.set(h.date.slice(0, 10), { text: h.name, tone: 'off' });

  return (
    <div className="space-y-5">
      <ViewHeader
        module="leave"
        view="employee"
        switcher={switcher}
        crumb="Leave · My leave"
        title="My leave"
        sub="Your balance, requests and the holiday calendar."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Days remaining"
          value={bal.isPending ? '…' : capped.length ? remaining : 'No cap'}
          sub="Across leave types with a yearly limit"
        />
        <Kpi label="Taken this year" value={used} sub="Approved days" />
        <Kpi
          label="Waiting for approval"
          value={pendingDays}
          sub={`${pending.length} request${pending.length === 1 ? '' : 's'}`}
        />
        <Kpi
          label="Next leave"
          value={upcoming[0] ? rangeText(upcoming[0].startDate, upcoming[0].endDate) : '—'}
          sub={upcoming[0]?.leaveType?.name ?? 'Nothing booked'}
        />
      </div>
      <TabBar tabs={TABS} value={tab} onChange={setTab} />

      {tab === 'balance' ? (
        bal.isPending ? (
          <Skeleton className="h-40" />
        ) : balances.length === 0 ? (
          <Empty>No leave types are set up yet.</Empty>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {balances.map((b) => (
              <Card key={b.leaveTypeId} className="space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <CardTitle>{b.name}</CardTitle>
                  <span className="text-xs text-muted">
                    {b.paid ? 'Paid' : 'Unpaid'} · {b.year}
                  </span>
                </div>
                <p className="text-2xl font-bold tabular-nums">
                  {b.remainingDays === null ? 'No cap' : `${b.remainingDays} days left`}
                </p>
                {b.allowanceDays ? (
                  <Meter
                    label="Used"
                    value={b.approvedDays + b.pendingDays}
                    max={b.allowanceDays}
                    text={`${b.approvedDays + b.pendingDays}/${b.allowanceDays}`}
                  />
                ) : null}
                <p className="text-xs text-muted">
                  {b.approvedDays} approved · {b.pendingDays} pending
                </p>
              </Card>
            ))}
          </div>
        )
      ) : null}

      {tab === 'apply' ? (
        <Card className="p-4">
          <CardTitle>Apply for leave</CardTitle>
          <div className="mt-3">
            <ApplyForm balanceOf={balanceOf} />
          </div>
        </Card>
      ) : null}

      {tab === 'calendar' ? (
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <CardTitle>Calendar</CardTitle>
            <MonthNav month={m} onChange={setMonth} />
          </div>
          <CalendarGrid month={m} today={today} cell={(d) => dayInfo.get(d) ?? {}} />
          <Legend
            items={[
              ['Approved', 'info'],
              ['Pending', 'warn'],
              ['Holiday', 'off'],
            ]}
          />
        </Card>
      ) : null}

      {tab === 'requests' ? (
        mine.isPending ? (
          <Skeleton className="h-40" />
        ) : reqs.length === 0 ? (
          <Empty>You have not requested any leave.</Empty>
        ) : (
          <div className="space-y-2">
            {cancel.error ? <Alert tone="danger">{cancel.error}</Alert> : null}
            <Table aria-label="My leave requests">
              <thead>
                <tr>
                  <Th>Type</Th>
                  <Th>Dates</Th>
                  <Th>Days</Th>
                  <Th>Status</Th>
                  <Th>Note</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {reqs.map((r) => (
                  <tr key={r.id}>
                    <Td className="font-medium">{r.leaveType?.name ?? 'Leave'}</Td>
                    <Td>{rangeText(r.startDate, r.endDate)}</Td>
                    <Td>{r.days}</Td>
                    <Td>
                      <StatusBadge s={r.status} />
                    </Td>
                    <Td className="max-w-56 truncate">{r.reviewComment ?? r.reason ?? ''}</Td>
                    <Td>
                      {r.status === 'PENDING' ||
                      (r.status === 'APPROVED' && r.startDate > today) ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={cancel.isPending && cancel.variables === r.id}
                          onClick={() => cancel.mutate(r.id)}
                        >
                          Cancel
                        </Button>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )
      ) : null}

      {tab === 'holidays' ? (
        <Card className="p-4">
          <CardTitle>Upcoming holidays</CardTitle>
          <div className="mt-2">
            <HolidayList from={today} limit={20} />
          </div>
        </Card>
      ) : null}

      {tab === 'policy' ? (
        <Card className="p-4">
          <CardTitle>Leave policy</CardTitle>
          <Table aria-label="Leave policy" className="mt-3">
            <thead>
              <tr>
                <Th>Leave type</Th>
                <Th>Per year</Th>
                <Th>Paid</Th>
                <Th>Half day</Th>
              </tr>
            </thead>
            <tbody>
              {(types.data?.data ?? [])
                .filter((t) => t.status === 'ACTIVE')
                .map((t) => (
                  <tr key={t.id}>
                    <Td className="font-medium">{t.name}</Td>
                    <Td>
                      {t.annualAllowanceDays === 0 ? 'No cap' : `${t.annualAllowanceDays} days`}
                    </Td>
                    <Td>{t.paid ? 'Paid' : 'Unpaid'}</Td>
                    <Td>{t.allowHalfDay ? 'Allowed' : 'No'}</Td>
                  </tr>
                ))}
            </tbody>
          </Table>
          <p className="mt-3 text-xs text-muted">
            Only working days are charged; weekly offs and holidays inside a request are free.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
