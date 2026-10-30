'use client';
import { Download, Share2 } from 'lucide-react';
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
import { useData, useList } from '@/hooks/api';
import { useTenant } from '@/hooks/lookups';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import type { Overview, WorkLocation } from '@/lib/types';
import { cn, formatMinutes, todayIso } from '@/lib/utils';
import { downloadBlob, monthEnd, monthLabel, monthStart } from './lib';
import {
  Delta,
  Kpi,
  Meter,
  MONTH_OPTIONS,
  ViewHeader,
  fmtHours,
  fmtPct,
  type ViewKey,
} from './shared';

type Tab = 'snapshot' | 'trends' | 'departments' | 'attention' | 'compliance';
const TABS: { key: Tab; label: string }[] = [
  { key: 'snapshot', label: 'Snapshot' },
  { key: 'trends', label: 'Trends' },
  { key: 'departments', label: 'Departments & locations' },
  { key: 'attention', label: 'Needs attention' },
  { key: 'compliance', label: 'Compliance & reports' },
];

export function OwnerView({ switcher }: { switcher: ReactNode }) {
  const { can } = useAuth();
  const tenant = useTenant();
  const tz = tenant.data?.data.timezone;
  const [tab, setTab] = useState<Tab>('snapshot');
  const [month, setMonth] = useState<string>();
  const [locationId, setLocationId] = useState('');
  const [note, setNote] = useState<string>();
  const m = month ?? (tz ? todayIso(tz).slice(0, 7) : undefined);
  const locs = useList<WorkLocation>(
    'work-locations',
    '/work-locations',
    { limit: 50 },
    can('location:read'),
  );
  const q = useData<Overview>(
    'overview',
    '/reports/attendance/overview',
    { month: m, locationId: locationId || undefined },
    !!m,
  );
  const o = q.data?.data;

  async function download() {
    if (!m) return;
    setNote(undefined);
    try {
      const { blob, filename } = await api.download('/reports/attendance/export', {
        from: monthStart(m),
        to: monthEnd(m),
        type: 'summary',
      });
      downloadBlob(blob, filename);
    } catch (e) {
      setNote(userMessage(e));
    }
  }
  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setNote('Link copied.');
    } catch {
      setNote('Copy the address from your browser to share this page.');
    }
  }

  return (
    <div className="space-y-5">
      <ViewHeader
        view={'owner' as ViewKey}
        switcher={switcher}
        crumb="Overview / Attendance"
        title="Attendance overview"
        sub={
          o
            ? `${o.headcount} employees · ${o.locations} location${o.locations === 1 ? '' : 's'} · view-only, HR handles corrections and approvals`
            : 'View-only, HR handles corrections and approvals'
        }
        actions={
          <>
            <Field label="Period">
              {(id) => (
                <Select id={id} value={m ?? ''} onChange={(e) => setMonth(e.target.value)}>
                  {m
                    ? MONTH_OPTIONS(tz ? todayIso(tz).slice(0, 7) : m).map((x) => (
                        <option key={x} value={x}>
                          {monthLabel(x)}
                        </option>
                      ))
                    : null}
                </Select>
              )}
            </Field>
            {can('location:read') ? (
              <Field label="Location">
                {(id) => (
                  <Select
                    id={id}
                    value={locationId}
                    onChange={(e) => setLocationId(e.target.value)}
                  >
                    <option value="">All locations</option>
                    {(locs.data?.data ?? [])
                      .filter((l) => l.status === 'ACTIVE')
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
            ) : null}
            <Button variant="secondary" onClick={() => void share()}>
              <Share2 className="h-4 w-4" aria-hidden /> Share
            </Button>
            <Button onClick={() => void download()}>
              <Download className="h-4 w-4" aria-hidden /> Download summary (CSV)
            </Button>
          </>
        }
      />
      {note ? <Alert tone="info">{note}</Alert> : null}
      <TabBar
        label="Overview sections"
        className="mb-0"
        tabs={TABS}
        value={tab}
        onChange={setTab}
      />
      {q.isError ? <Alert tone="danger">{userMessage(q.error)}</Alert> : null}
      {q.isPending || !o ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          {tab === 'snapshot' ? <Snapshot o={o} /> : null}
          {tab === 'trends' ? <Trends o={o} /> : null}
          {tab === 'departments' ? <Departments o={o} /> : null}
          {tab === 'attention' ? <Attention o={o} /> : null}
          {tab === 'compliance' ? (
            <Compliance o={o} from={monthStart(o.month)} to={monthEnd(o.month)} />
          ) : null}
          <p className="text-xs text-muted">{o.basis}</p>
        </>
      )}
    </div>
  );
}

/* --------------------------------- snapshot -------------------------------- */

const SEG = [
  { k: 'present', label: 'Present', cls: 'bg-success' },
  { k: 'onLeave', label: 'On leave', cls: 'bg-info' },
  { k: 'absent', label: 'Absent', cls: 'bg-danger' },
  { k: 'notIn', label: 'Not in yet', cls: 'bg-muted/50' },
] as const;

function Snapshot({ o }: { o: Overview }) {
  const l = o.live;
  const c = o.current;
  const p = o.previous;
  const total = SEG.reduce((s, x) => s + l[x.k], 0) || 1;
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Card className="row-span-2">
        <p className="text-xs text-muted">Today · {l.workDate}</p>
        <p className="mt-1 text-4xl font-bold tabular-nums">{fmtPct(l.rate)}</p>
        <p className="mt-1 text-xs text-muted">
          {l.present} of {l.expected} expected, excluding {l.onLeave} on leave
        </p>
        <div
          className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-subtle"
          role="img"
          aria-label="Today by status"
        >
          {SEG.map((x) => (
            <div key={x.k} className={x.cls} style={{ width: `${(l[x.k] / total) * 100}%` }} />
          ))}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          {SEG.map((x) => (
            <div key={x.k} className="flex items-center justify-between gap-2">
              <dt className="flex items-center gap-2 text-muted">
                <span aria-hidden className={cn('h-2 w-2 rounded-full', x.cls)} />
                {x.label}
              </dt>
              <dd className="font-semibold tabular-nums">{l[x.k]}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Kpi label="Attendance rate" value={fmtPct(c.attendanceRate)}>
        <Delta cur={c.attendanceRate} prev={p.attendanceRate} unit="pts" />
      </Kpi>
      <Kpi label="Absenteeism" value={fmtPct(c.absenteeism)}>
        <Delta cur={c.absenteeism} prev={p.absenteeism} unit="pts" lowerIsBetter />
      </Kpi>
      <Kpi label="Late arrivals" value={fmtPct(c.lateRate)}>
        <Delta cur={c.lateRate} prev={p.lateRate} unit="pts" lowerIsBetter />
      </Kpi>
      <Kpi label="Avg net hours per day" value={fmtHours(c.avgNetMinutes)}>
        <Delta cur={c.avgNetMinutes} prev={p.avgNetMinutes} unit="min" />
      </Kpi>
      <Kpi label="Overtime hours" value={`${Math.round(c.overtimeMinutes / 60)} h`}>
        <Delta cur={c.overtimeMinutes} prev={p.overtimeMinutes} unit="" percent neutral />
      </Kpi>
      <Kpi
        label="Overdue approvals"
        value={o.attention.overdueApprovals.count}
        sub={`Waiting over ${o.attention.overdueApprovals.days} days`}
      />
    </div>
  );
}

/* ---------------------------------- trends --------------------------------- */

function Trends({ o }: { o: Overview }) {
  const vals = o.trend.map((t) => t.attendanceRate).filter((v): v is number => v !== null);
  const min = vals.length ? Math.max(0, Math.floor(Math.min(...vals) - 3)) : 0;
  const span = 100 - min || 1;
  const wd = o.weekday;
  const maxWd = Math.max(1, ...wd.map((w) => w.absenteeism ?? 0));
  const worst = [...wd]
    .sort((a, b) => (b.absenteeism ?? 0) - (a.absenteeism ?? 0))
    .slice(0, 2)
    .map((w) => w.day);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <div className="mb-3 flex items-baseline justify-between">
          <CardTitle className="text-base text-foreground">Attendance rate · 6 months</CardTitle>
          <span className="text-xs text-muted">Axis starts at {min}%</span>
        </div>
        {vals.length === 0 ? (
          <Empty>No attendance recorded yet.</Empty>
        ) : (
          <div className="flex h-48 items-end gap-3 border-b border-border">
            {o.trend.map((t) => (
              <div
                key={t.month}
                className="flex h-full flex-1 flex-col items-center justify-end gap-1"
              >
                <span className="text-[11px] font-medium tabular-nums">
                  {fmtPct(t.attendanceRate)}
                </span>
                <div
                  className="w-full max-w-12 rounded-t-md bg-primary"
                  style={{
                    height: `${t.attendanceRate === null ? 0 : Math.max(2, ((t.attendanceRate - min) / span) * 85)}%`,
                  }}
                  role="img"
                  aria-label={`${monthLabel(t.month)}: ${fmtPct(t.attendanceRate)}`}
                />
              </div>
            ))}
          </div>
        )}
        <div className="mt-1 flex gap-3 text-center text-[11px] text-muted">
          {o.trend.map((t) => (
            <span key={t.month} className="flex-1">
              {monthLabel(t.month).slice(0, 3)}
            </span>
          ))}
        </div>
      </Card>
      <Card>
        <CardTitle className="text-base text-foreground">Absenteeism by weekday</CardTitle>
        <p className="mb-3 text-xs text-muted">
          Share of scheduled days missed without approved leave
        </p>
        {wd.length === 0 ? (
          <Empty>No scheduled days this month.</Empty>
        ) : (
          <div className="space-y-2.5">
            {wd.map((w) => (
              <Meter
                key={w.day}
                label={w.day}
                value={w.absenteeism ?? 0}
                max={maxWd}
                text={fmtPct(w.absenteeism)}
                className="[&>span:first-child]:w-10"
              />
            ))}
            {(wd.find((w) => w.day === worst[0])?.absenteeism ?? 0) > 0 ? (
              <p className="pt-1 text-xs text-muted">
                {worst.join(' and ')} carry the most absences.
              </p>
            ) : null}
          </div>
        )}
      </Card>
    </div>
  );
}

/* -------------------------- departments & locations ------------------------- */

function Departments({ o }: { o: Overview }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardTitle className="text-base text-foreground">Department comparison</CardTitle>
        <p className="mb-3 text-xs text-muted">{monthLabel(o.month)} · sorted by attendance rate</p>
        {o.byDepartment.length === 0 ? (
          <Empty>No departments with employees.</Empty>
        ) : (
          <Table aria-label="Department comparison">
            <thead>
              <tr>
                <Th>Department</Th>
                <Th>Headcount</Th>
                <Th>Attendance rate</Th>
                <Th>Absenteeism</Th>
                <Th>Late arrivals</Th>
                <Th>Avg net hours</Th>
                <Th>Overtime</Th>
              </tr>
            </thead>
            <tbody>
              {o.byDepartment.map((d) => (
                <tr key={d.departmentId}>
                  <Td className="font-medium">{d.name}</Td>
                  <Td>{d.headcount}</Td>
                  <Td className="min-w-48">
                    <Meter
                      label=""
                      value={d.attendanceRate ?? 0}
                      max={100}
                      text={fmtPct(d.attendanceRate)}
                      className="[&>span:first-child]:hidden [&>span:last-child]:w-14"
                    />
                  </Td>
                  <Td>{fmtPct(d.absenteeism)}</Td>
                  <Td>{fmtPct(d.lateRate)}</Td>
                  <Td>{fmtHours(d.avgNetMinutes)}</Td>
                  <Td>{formatMinutes(d.overtimeMinutes)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Card>
        <CardTitle className="mb-3 text-base text-foreground">Location comparison</CardTitle>
        {o.byLocation.length === 0 ? (
          <Empty>No employees are assigned to a work location.</Empty>
        ) : (
          <Table aria-label="Location comparison">
            <thead>
              <tr>
                <Th>Location</Th>
                <Th>Headcount</Th>
                <Th>Attendance rate</Th>
              </tr>
            </thead>
            <tbody>
              {o.byLocation.map((l) => (
                <tr key={l.locationId || 'none'}>
                  <Td className="font-medium">{l.name}</Td>
                  <Td>{l.headcount}</Td>
                  <Td className="min-w-48">
                    <Meter
                      label=""
                      value={l.attendanceRate ?? 0}
                      max={100}
                      text={fmtPct(l.attendanceRate)}
                      className="[&>span:first-child]:hidden [&>span:last-child]:w-14"
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="mt-2 text-xs text-muted">
          An employee with several locations is counted at the first one.
        </p>
      </Card>
    </div>
  );
}

/* ------------------------------- needs attention ---------------------------- */

function Attention({ o }: { o: Overview }) {
  const a = o.attention;
  const items = [
    {
      n: a.lateMarkLimit.count,
      title: `Employees with ${a.lateMarkLimit.limit}+ late marks`,
      text: 'Check the late-mark policy before payroll',
    },
    {
      n: a.absentStreak.count,
      title: `Absent ${a.absentStreak.days}+ days in a row`,
      text: 'HR should contact each employee',
    },
    {
      n: a.highOvertime.count,
      title: `Employees above ${a.highOvertime.hours} h overtime`,
      text: 'Check workload and approvals',
    },
    {
      n: a.overdueApprovals.count,
      title: `Approvals waiting over ${a.overdueApprovals.days} days`,
      text: 'Corrections, location and leave requests',
    },
    {
      n: a.teamsBelowFloor.names.length,
      title: `Teams below ${a.teamsBelowFloor.floor}% attendance`,
      text: a.teamsBelowFloor.names.join(', ') || 'None',
    },
  ];
  return (
    <section>
      <h2 className="text-base font-semibold">Needs attention</h2>
      <p className="mb-3 text-xs text-muted">
        Items HR is working through that may affect payroll or team health. Switch to the HR view to
        act on them.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {items.map((i) => (
          <Card key={i.title} className="p-4">
            <p className={cn('text-3xl font-bold tabular-nums', i.n > 0 ? '' : 'text-muted')}>
              {i.n}
            </p>
            <p className="mt-2 text-sm font-semibold">{i.title}</p>
            <p className="text-xs text-muted">{i.text}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}

/* --------------------------------- compliance ------------------------------- */

function Compliance({ o, from, to }: { o: Overview; from: string; to: string }) {
  const c = o.compliance;
  const [busy, setBusy] = useState<string>();
  const [err, setErr] = useState<string>();
  async function run(type: 'summary' | 'daily') {
    setBusy(type);
    setErr(undefined);
    try {
      const { blob, filename } = await api.download('/reports/attendance/export', {
        from,
        to,
        type,
      });
      downloadBlob(blob, filename);
    } catch (e) {
      setErr(userMessage(e));
    } finally {
      setBusy(undefined);
    }
  }
  const payroll = (v: string | null) =>
    v === 'PUBLISHED'
      ? { t: 'Published', c: 'bg-success-bg text-success' }
      : v === 'DRAFT'
        ? { t: 'Draft', c: 'bg-warn-bg text-warn' }
        : { t: 'No run yet', c: 'bg-subtle text-muted' };
  const rows: [string, { t: string; c: string }][] = [
    [`${monthLabel(o.previousMonth)} payroll`, payroll(c.previousMonthPayroll)],
    [`${monthLabel(o.month)} payroll`, payroll(c.currentMonthPayroll)],
    [
      'Geo-fence required for punches',
      c.geofenceRequired
        ? { t: 'On', c: 'bg-success-bg text-success' }
        : { t: 'Off', c: 'bg-warn-bg text-warn' },
    ],
    ['Active work locations', { t: String(c.activeLocations), c: 'bg-subtle text-muted' }],
    [
      'Manual edits approved this month',
      { t: `${c.manualEditsApproved} · all logged`, c: 'bg-success-bg text-success' },
    ],
    [
      'Location approvals waiting',
      c.openLocationExceptions
        ? { t: String(c.openLocationExceptions), c: 'bg-warn-bg text-warn' }
        : { t: 'None', c: 'bg-success-bg text-success' },
    ],
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardTitle className="mb-2 text-base text-foreground">Compliance and controls</CardTitle>
        <ul className="divide-y divide-border text-sm">
          {rows.map(([k, v]) => (
            <li key={k} className="flex items-center justify-between gap-3 py-2.5">
              <span>{k}</span>
              <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', v.c)}>
                {v.t}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardTitle className="text-base text-foreground">Reports</CardTitle>
        <p className="mb-3 text-xs text-muted">
          Download for {monthLabel(o.month)}. Every export is recorded in the audit log.
        </p>
        <ul className="divide-y divide-border text-sm">
          {[
            {
              type: 'summary' as const,
              title: 'Attendance summary',
              text: 'Rates, lateness and overtime for every employee',
            },
            {
              type: 'daily' as const,
              title: 'Day-wise attendance',
              text: 'Status and punch times for every employee and day',
            },
          ].map((r) => (
            <li key={r.type} className="flex items-center justify-between gap-3 py-3">
              <span>
                <span className="block font-semibold">{r.title}</span>
                <span className="text-xs text-muted">{r.text}</span>
              </span>
              <Button
                variant="secondary"
                size="sm"
                loading={busy === r.type}
                onClick={() => void run(r.type)}
              >
                CSV
              </Button>
            </li>
          ))}
        </ul>
        {err ? (
          <div className="mt-3">
            <Alert tone="danger">{err}</Alert>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
