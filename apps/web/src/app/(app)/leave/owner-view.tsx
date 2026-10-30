'use client';
import { ExportButtons } from '@/components/export-buttons';
import { downloadTable, type ExportFormat } from '@/lib/export';
import { useState, type ReactNode } from 'react';
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
import { useData } from '@/hooks/api';
import { useTenant } from '@/hooks/lookups';
import { userMessage } from '@/lib/errors';
import type { LeaveOverview } from '@/lib/types';
import { todayIso } from '@/lib/utils';
import { monthLabel } from '../attendance/lib';
import { Delta, Kpi, Meter, MONTH_OPTIONS, ViewHeader, fmtPct } from '../attendance/shared';
import { rangeText } from './data';

type Tab = 'snapshot' | 'trends' | 'departments' | 'attention' | 'liability' | 'reports';
const TABS: { key: Tab; label: string }[] = [
  { key: 'snapshot', label: 'Snapshot' },
  { key: 'trends', label: 'Trends' },
  { key: 'departments', label: 'Departments' },
  { key: 'attention', label: 'Coverage & attention' },
  { key: 'liability', label: 'Liability & policy' },
  { key: 'reports', label: 'Reports' },
];

export function OwnerView({ switcher }: { switcher: ReactNode }) {
  const tenant = useTenant();
  const tz = tenant.data?.data.timezone;
  const [tab, setTab] = useState<Tab>('snapshot');
  const [month, setMonth] = useState<string>();
  const cur = tz ? todayIso(tz).slice(0, 7) : undefined;
  const m = month ?? cur;
  const q = useData<LeaveOverview>(
    'leave-overview',
    '/reports/leave/overview',
    m ? { month: m } : {},
    !!tz,
  );
  const o = q.data?.data;

  const exportData = (format: ExportFormat) => {
    if (!o) return;
    return downloadTable(`leave-overview-${o.month}`, [
      [
        'Department',
        'Headcount',
        'Days per person (6 months)',
        'Unplanned share %',
        'Average unused days',
        'People with high unused',
        'Peak off %',
      ],
      ...o.byDepartment.map((d) => [
        d.name,
        d.headcount,
        d.daysPerPerson,
        d.unplannedShare,
        d.avgUnused,
        d.highUnused,
        d.peakOff.pct,
      ]),
      [],
      ['Leave type', 'Days (6 months)', 'Share %'],
      ...o.byType.map((t) => [t.name, t.days, t.share]),
    ], format);
  };

  const maxTrend = Math.max(1, ...(o?.trend.map((t) => t.days) ?? [1]));
  return (
    <div className="space-y-5">
      <ViewHeader
        module="leave"
        view="owner"
        switcher={switcher}
        crumb="Leave · Leave overview"
        title="Leave overview"
        sub={o ? `${monthLabel(o.month)} · ${o.basis}` : 'Company-wide leave patterns, read-only.'}
        actions={
          m && cur ? (
            <Field label="Month">
              {(id) => (
                <Select id={id} value={m} onChange={(e) => setMonth(e.target.value)}>
                  {MONTH_OPTIONS(cur).map((x) => (
                    <option key={x} value={x}>
                      {monthLabel(x)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null
        }
      />
      {q.isError ? <Alert tone="danger">{userMessage(q.error)}</Alert> : null}
      <TabBar tabs={TABS} value={tab} onChange={setTab} />
      {q.isPending || !o ? (
        q.isError ? null : (
          <Skeleton className="h-72" />
        )
      ) : (
        <>
          {tab === 'snapshot' ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Kpi
                  label="Off today"
                  value={o.onLeaveToday.people}
                  sub={`of ${o.onLeaveToday.headcount} people`}
                />
                <Kpi label="Days taken this month" value={o.current.days}>
                  <Delta cur={o.current.days} prev={o.previous.days} unit="days" neutral percent />
                </Kpi>
                <Kpi
                  label="Unplanned share"
                  value={fmtPct(o.current.unplannedShare)}
                  sub="Leave applied with little notice"
                >
                  <Delta
                    cur={o.current.unplannedShare}
                    prev={o.previous.unplannedShare}
                    unit="pts"
                    lowerIsBetter
                  />
                </Kpi>
                <Kpi
                  label="Days per person (6 months)"
                  value={o.daysPerPerson6m}
                  sub={`${o.totalDays6m} days in total`}
                />
              </div>
              <Card className="space-y-2 p-4">
                <CardTitle>Next 7 days</CardTitle>
                {o.next7.map((d) => (
                  <Meter
                    key={d.date}
                    label={rangeText(d.date, d.date)}
                    value={d.people}
                    max={Math.max(1, o.onLeaveToday.headcount * 0.3)}
                    text={`${d.people}`}
                  />
                ))}
              </Card>
            </>
          ) : null}

          {tab === 'trends' ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="space-y-2 p-4">
                <CardTitle>Days taken per month</CardTitle>
                {o.trend.map((t) => (
                  <Meter
                    key={t.month}
                    label={monthLabel(t.month)}
                    value={t.days}
                    max={maxTrend}
                    text={`${t.days}`}
                  />
                ))}
              </Card>
              <Card className="space-y-2 p-4">
                <CardTitle>By leave type</CardTitle>
                {o.byType.length === 0 ? (
                  <Empty>No leave taken in this period.</Empty>
                ) : (
                  o.byType.map((t) => (
                    <Meter
                      key={t.name}
                      label={t.name}
                      value={t.share}
                      max={100}
                      text={`${t.share}%`}
                    />
                  ))
                )}
                <p className="pt-2 text-xs text-muted">
                  Planned {fmtPct(o.plannedShare)} · Unplanned {fmtPct(o.unplannedShare6m)}
                </p>
              </Card>
            </div>
          ) : null}

          {tab === 'departments' ? (
            o.byDepartment.length === 0 ? (
              <Empty>No departments to compare.</Empty>
            ) : (
              <Table aria-label="Departments">
                <thead>
                  <tr>
                    <Th>Department</Th>
                    <Th>People</Th>
                    <Th>Days / person</Th>
                    <Th>Unplanned</Th>
                    <Th>Avg unused</Th>
                    <Th>Peak off</Th>
                  </tr>
                </thead>
                <tbody>
                  {o.byDepartment.map((d) => (
                    <tr key={d.departmentId}>
                      <Td className="font-medium">{d.name}</Td>
                      <Td>{d.headcount}</Td>
                      <Td>{d.daysPerPerson}</Td>
                      <Td>{fmtPct(d.unplannedShare)}</Td>
                      <Td>{d.avgUnused}</Td>
                      <Td>
                        {d.peakOff.off}/{d.peakOff.headcount} ({d.peakOff.pct}%)
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )
          ) : null}

          {tab === 'attention' ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="space-y-2 p-4">
                <CardTitle>Coverage risks (next 5 weeks)</CardTitle>
                {o.coverage.length === 0 ? (
                  <p className="text-sm text-muted">No team is below the cover line.</p>
                ) : (
                  <ul className="divide-y divide-border text-sm">
                    {o.coverage.map((c) => (
                      <li
                        key={`${c.department}${c.weekStart}`}
                        className="flex justify-between py-2"
                      >
                        <span className="font-medium">{c.department}</span>
                        <span className="text-muted">
                          Week of {rangeText(c.weekStart, c.weekStart)} · {c.off}/{c.headcount} off
                          ({c.pct}%)
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card className="space-y-2 p-4">
                <CardTitle>Needs attention</CardTitle>
                <ul className="space-y-2 text-sm">
                  <li>
                    {o.attention.highUnused.count} people have {o.attention.highUnused.days}+ unused
                    days
                  </li>
                  <li>
                    {o.attention.noLeave.count} people took no leave in {o.attention.noLeave.months}{' '}
                    months
                  </li>
                  <li>
                    {o.attention.pastWindow.count} requests waiting over{' '}
                    {o.attention.pastWindow.days} days
                  </li>
                  <li>{o.attention.negativeBalances} negative balances</li>
                  <li>
                    {o.attention.crowdedTeams.names.length
                      ? `${o.attention.crowdedTeams.names.join(', ')} have ${o.attention.crowdedTeams.pct}%+ off at once`
                      : 'No team has too many off at once'}
                  </li>
                </ul>
              </Card>
            </div>
          ) : null}

          {tab === 'liability' ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="grid gap-3 sm:grid-cols-3 lg:col-span-2">
                <Kpi
                  label="Unused days"
                  value={o.liability.unusedDays}
                  sub="Across all people this year"
                />
                <Kpi
                  label="Paid and unused"
                  value={o.liability.paidUnusedDays}
                  sub="Days that carry a cost"
                />
                <Kpi label="Average per person" value={o.liability.avgUnusedPerPerson} />
              </div>
              <Card className="p-4 lg:col-span-2">
                <CardTitle>Leave policy</CardTitle>
                <Table aria-label="Policy" className="mt-3">
                  <thead>
                    <tr>
                      <Th>Type</Th>
                      <Th>Per year</Th>
                      <Th>Paid</Th>
                      <Th>Half day</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.policy.map((p) => (
                      <tr key={p.id}>
                        <Td className="font-medium">{p.name}</Td>
                        <Td>{p.annualAllowanceDays === 0 ? 'No cap' : p.annualAllowanceDays}</Td>
                        <Td>{p.paid ? 'Paid' : 'Unpaid'}</Td>
                        <Td>{p.allowHalfDay ? 'Yes' : 'No'}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
            </div>
          ) : null}

          {tab === 'reports' ? (
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <CardTitle>Department and leave-type summary</CardTitle>
                <p className="mt-1 text-sm text-muted">
                  Download the figures behind this page as CSV or Excel.
                </p>
              </div>
              <ExportButtons size="md" onExport={exportData} />
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
