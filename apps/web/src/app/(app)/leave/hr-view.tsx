'use client';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useAuth } from '@/components/auth';
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
import { Field, Select } from '@/components/ui/form';
import { useTenant } from '@/hooks/lookups';
import { api } from '@/lib/api';
import type { LeaveBalance } from '@/lib/types';
import { todayIso } from '@/lib/utils';
import { downloadCsv } from '../attendance/csv';
import { monthEnd, monthStart } from '../attendance/lib';
import { Kpi, MONTH_OPTIONS, ViewHeader } from '../attendance/shared';
import { ApprovalsPanel } from './approvals';
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
import { CalendarGrid, HolidayList, Legend, MonthNav, StatusBadge } from './parts';
import { AdjustDialog, LedgerList, LedgerRuns } from './ledger-admin';
import { LeaveTypes } from './types-admin';

type Tab = 'overview' | 'approvals' | 'calendar' | 'types' | 'balances' | 'reports';

export function HrView({ switcher }: { switcher: ReactNode }) {
  const { can, active } = useAuth();
  const canManage = can('leave:manage');
  const tenant = useTenant();
  const tz = tenant.data?.data.timezone ?? 'UTC';
  const workweek = tenant.data?.data.workweek ?? [1, 2, 3, 4, 5];
  const today = todayIso(tz);
  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'approvals', label: 'Approvals' },
    { key: 'calendar', label: 'Company calendar' },
    ...(canManage ? [{ key: 'types' as const, label: 'Leave types' }] : []),
    { key: 'balances', label: 'Balances' },
    { key: 'reports', label: 'Audit & reports' },
  ];
  const [tab, setTab] = useState<Tab>('overview');
  const [month, setMonth] = useState<string>();
  const [empId, setEmpId] = useState('');
  const [adjusting, setAdjusting] = useState<LeaveBalance>();
  const year = Number(today.slice(0, 4));
  const [repMonth, setRepMonth] = useState(today.slice(0, 7));
  const m = month ?? today.slice(0, 7);

  const staff = useAllEmployees(true);
  const headcount = staff.data?.length ?? 0;
  const pendingQ = useReviewRequests('hr-pending', { status: 'PENDING' });
  const recentQ = useReviewRequests('hr-recent', { from: monthStart(m), to: monthEnd(m) });
  const repQ = useReviewRequests(
    'hr-report',
    { from: monthStart(repMonth), to: monthEnd(repMonth) },
    tab === 'reports',
  );
  const balQ = useQuery({
    queryKey: ['leave-balances', active?.tenantId, empId],
    enabled: !!empId,
    queryFn: async () =>
      (await api.get<LeaveBalance[]>('/leave/balances', { employeeId: empId })).data,
  });

  const pending = pendingQ.data ?? [];
  const recent = recentQ.data ?? [];
  const anyOff = offMap(recent, workweek);
  const approvedOff = offMap(recent, workweek, ['APPROVED']);
  const offToday = offMap(recent, workweek).get(today)?.size ?? 0;
  const late = pending.filter((r) => daysSince(r.createdAt) > WINDOW_DAYS);
  const approvedDays = recent
    .filter((r) => r.status === 'APPROVED')
    .reduce((s, r) => s + r.days, 0);
  const next7 = Array.from({ length: 7 }, (_, i) => addDay(today, i)).reduce(
    (s, d) => s + (anyOff.get(d)?.size ?? 0),
    0,
  );

  const exportCsv = () => {
    const rows = repQ.data ?? [];
    downloadCsv(`leave-${repMonth}.csv`, [
      [
        'Employee code',
        'Employee',
        'Leave type',
        'From',
        'To',
        'Days',
        'Half day',
        'Status',
        'Reason',
        'Review comment',
        'Requested on',
      ],
      ...rows.map((r) => [
        r.employee?.employeeCode,
        fullName(r.employee),
        r.leaveType?.name,
        r.startDate,
        r.endDate,
        r.days,
        r.halfDay ? 'Yes' : 'No',
        r.status,
        r.reason,
        r.reviewComment,
        r.createdAt.slice(0, 10),
      ]),
    ]);
  };

  return (
    <div className="space-y-5">
      <ViewHeader
        module="leave"
        view="hr"
        switcher={switcher}
        crumb="Leave · Leave management"
        title="Leave management"
        sub="Approvals, balances and leave types for the whole company."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Pending approvals"
          value={pendingQ.isPending ? '…' : pending.length}
          sub={
            late.length ? `${late.length} past ${WINDOW_DAYS} days` : 'Within the approval window'
          }
        />
        <Kpi
          label="Off today"
          value={offToday}
          sub={headcount ? `of ${headcount} active employees` : undefined}
        />
        <Kpi label="Off in next 7 days" value={next7} sub="Person-days, approved and pending" />
        <Kpi label="Approved this month" value={approvedDays} sub="Working days charged" />
      </div>
      <TabBar tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'overview' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="space-y-3 p-4">
            <CardTitle>Needs a decision</CardTitle>
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
            <CardTitle>Upcoming holidays</CardTitle>
            <HolidayList from={today} limit={6} />
          </Card>
        </div>
      ) : null}

      {tab === 'approvals' ? (
        <ApprovalsPanel
          reqs={pending}
          off={approvedOff}
          loading={pendingQ.isPending}
          canDecide={(r) => r.employeeId !== active?.employeeId || can('leave:review:all')}
        />
      ) : null}

      {tab === 'calendar' ? (
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <CardTitle>Company calendar</CardTitle>
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
              const pct = headcount ? n / headcount : 0;
              return {
                text: `${n} off`,
                sub: headcount ? `${Math.round(pct * 100)}%` : undefined,
                tone: pct >= 0.15 ? 'danger' : 'info',
              };
            }}
          />
          <Legend
            items={[
              ['15%+ of company off', 'danger'],
              ['Someone off', 'info'],
              ['Weekly off', 'off'],
            ]}
          />
        </Card>
      ) : null}

      {tab === 'types' && canManage ? <LeaveTypes /> : null}

      {tab === 'balances' && canManage ? <LedgerRuns today={today} /> : null}

      {tab === 'balances' ? (
        <Card className="space-y-3 p-4">
          <CardTitle>Employee balances</CardTitle>
          <div className="max-w-sm">
            <Field label="Employee">
              {(id) => (
                <Select id={id} value={empId} onChange={(e) => setEmpId(e.target.value)}>
                  <option value="">Select an employee…</option>
                  {(staff.data ?? []).map((e) => (
                    <option key={e.id} value={e.id}>
                      {fullName(e)} · {e.employeeCode}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          {!empId ? (
            <Empty>Pick an employee to see their balances.</Empty>
          ) : balQ.isPending ? (
            <Skeleton className="h-32" />
          ) : balQ.isError ? (
            <Alert tone="danger">Could not load balances.</Alert>
          ) : (
            <Table aria-label="Balances">
              <thead>
                <tr>
                  <Th>Leave type</Th>
                  <Th>Entitlement</Th>
                  <Th>Approved</Th>
                  <Th>Pending</Th>
                  <Th>Remaining</Th>
                  {canManage ? (
                    <Th>
                      <span className="sr-only">Actions</span>
                    </Th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {(balQ.data ?? []).map((b) => (
                  <tr key={b.leaveTypeId}>
                    <Td className="font-medium">{b.name}</Td>
                    <Td>
                      {b.allowanceDays ?? 'No cap'}
                      {b.entitlement && (b.entitlement.accrued || b.entitlement.carriedForward || b.entitlement.adjustments) ? (
                        <span className="block text-xs text-muted">
                          {[
                            b.entitlement.base ? `${b.entitlement.base} base` : null,
                            b.entitlement.accrued ? `${b.entitlement.accrued} accrued` : null,
                            b.entitlement.carriedForward ? `${b.entitlement.carriedForward} carried` : null,
                            b.entitlement.adjustments ? `${b.entitlement.adjustments > 0 ? '+' : ''}${b.entitlement.adjustments} adjusted` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      ) : null}
                    </Td>
                    <Td>{b.approvedDays}</Td>
                    <Td>{b.pendingDays}</Td>
                    <Td>{b.remainingDays ?? 'No cap'}</Td>
                    {canManage ? (
                      <Td>
                        <Button size="sm" variant="secondary" onClick={() => setAdjusting(b)}>
                          Adjust
                        </Button>
                      </Td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {empId && balQ.data ? (
            <>
              <h3 className="pt-2 text-sm font-semibold">Credits and adjustments, {year}</h3>
              <LedgerList
                employeeId={empId}
                year={year}
                typeName={(id) => (balQ.data ?? []).find((b) => b.leaveTypeId === id)?.name ?? 'Leave'}
              />
            </>
          ) : null}
          {adjusting && empId ? (
            <AdjustDialog employeeId={empId} balance={adjusting} year={year} onClose={() => setAdjusting(undefined)} />
          ) : null}
        </Card>
      ) : null}

      {tab === 'reports' ? (
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <CardTitle>Leave register</CardTitle>
            <div className="flex items-end gap-2">
              <Field label="Month">
                {(id) => (
                  <Select id={id} value={repMonth} onChange={(e) => setRepMonth(e.target.value)}>
                    {MONTH_OPTIONS(today.slice(0, 7)).map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Button variant="secondary" disabled={!repQ.data?.length} onClick={exportCsv}>
                <Download className="mr-1.5 size-4" aria-hidden />
                Export CSV
              </Button>
            </div>
          </div>
          {repQ.isPending ? (
            <Skeleton className="h-40" />
          ) : (repQ.data ?? []).length === 0 ? (
            <Empty>No leave requests in this month.</Empty>
          ) : (
            <Table aria-label="Leave register">
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>Type</Th>
                  <Th>Dates</Th>
                  <Th>Days</Th>
                  <Th>Status</Th>
                  <Th>Review comment</Th>
                </tr>
              </thead>
              <tbody>
                {(repQ.data ?? []).map((r) => (
                  <tr key={r.id}>
                    <Td className="font-medium">{fullName(r.employee)}</Td>
                    <Td>{r.leaveType?.name}</Td>
                    <Td>{rangeText(r.startDate, r.endDate)}</Td>
                    <Td>{r.days}</Td>
                    <Td>
                      <StatusBadge s={r.status} />
                    </Td>
                    <Td className="max-w-56 truncate">{r.reviewComment}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      ) : null}
    </div>
  );
}
