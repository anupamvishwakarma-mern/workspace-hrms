'use client';
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
import { useData, useList } from '@/hooks/api';
import { useDepartments, useTenant } from '@/hooks/lookups';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import type { LiveSnapshot, WorkLocation } from '@/lib/types';
import { todayIso } from '@/lib/utils';
import { DayDetail } from './day-detail';
import { ApprovalQueue, ExceptionsList, ManualEntryModal } from './hr-queue';
import { useApprovalQueue } from './hr-data';
import { AuditTrail, PayrollReadiness } from './hr-payroll';
import { EmployeeRegister } from './hr-register';
import { BulkAssign, HolidayCalendar, PolicySettings, ShiftMaster, SitesCard } from './hr-setup';
import { downloadBlob, monthEnd, monthLabel, monthStart } from './lib';
import { ReportsCards } from './reports-policy';
import { Kpi, ViewHeader, fmtPct } from './shared';

type Tab =
  'live' | 'exceptions' | 'approvals' | 'register' | 'shifts' | 'policy' | 'sites' | 'payroll';

export function HrView({ switcher }: { switcher: ReactNode }) {
  const { can, active } = useAuth();
  const tenant = useTenant();
  const tz = tenant.data?.data.timezone;
  const today = tz ? todayIso(tz) : undefined;
  const selfId = active?.employeeId;
  const [tab, setTab] = useState<Tab>('live');
  const [manual, setManual] = useState<{
    open: boolean;
    preset?: { employeeId: string; name: string; date: string };
  }>({ open: false });
  const [openId, setOpenId] = useState<string>();
  const [note, setNote] = useState<string>();
  const queue = useApprovalQueue(selfId);

  const review = can('attendance:review:all', 'attendance:review:team');
  const tabs: { key: Tab; label: string }[] = [
    { key: 'live', label: 'Live today' },
    ...(review
      ? [
          { key: 'exceptions' as Tab, label: 'Exceptions' },
          {
            key: 'approvals' as Tab,
            label: `Approvals${queue.items.length ? ` (${queue.items.length})` : ''}`,
          },
        ]
      : []),
    { key: 'register', label: 'Employee register' },
    ...(can('shift:manage')
      ? [
          { key: 'shifts' as Tab, label: 'Shifts' },
          { key: 'policy' as Tab, label: 'Policy' },
        ]
      : []),
    { key: 'sites', label: 'Sites & holidays' },
    { key: 'payroll', label: 'Payroll & reports' },
  ];
  const current = tabs.find((t) => t.key === tab)?.key ?? 'live';
  if (!tz || !today) return <Skeleton className="h-96" />;
  const month = today.slice(0, 7);
  const cycleFrom = monthStart(month);

  async function exportRoll() {
    setNote(undefined);
    try {
      const { blob, filename } = await api.download('/reports/attendance/export', {
        from: cycleFrom,
        to: monthEnd(month),
        type: 'summary',
      });
      downloadBlob(blob, filename);
    } catch (e) {
      setNote(userMessage(e));
    }
  }

  return (
    <div className="space-y-5">
      <ViewHeader
        view="hr"
        switcher={switcher}
        crumb="HR console / Attendance"
        title="Attendance management"
        sub="Every employee you manage. Updates as punches arrive from mobile and web."
        actions={
          <>
            {review ? (
              <Button variant="secondary" onClick={() => setManual({ open: true })}>
                Add manual entry
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => void exportRoll()}>
              <Download className="h-4 w-4" aria-hidden /> Export master roll
            </Button>
            {review ? (
              <Button onClick={() => setTab('exceptions')}>Review exceptions</Button>
            ) : null}
          </>
        }
      />
      {note ? <Alert tone="danger">{note}</Alert> : null}
      <TabBar
        label="Attendance management sections"
        className="mb-0"
        tabs={tabs}
        value={current}
        onChange={setTab}
      />

      {current === 'live' ? <Live today={today} /> : null}
      {current === 'exceptions' ? (
        <ExceptionsList
          from={cycleFrom}
          to={today}
          onFix={(v) => setManual({ open: true, preset: v })}
        />
      ) : null}
      {current === 'approvals' ? <ApprovalQueue selfId={selfId} /> : null}
      {current === 'register' ? (
        <EmployeeRegister currentMonth={month} today={today} tz={tz} onDetail={setOpenId} />
      ) : null}
      {current === 'shifts' ? (
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <ShiftMaster today={today} />
          <BulkAssign today={today} />
        </div>
      ) : null}
      {current === 'policy' ? <PolicySettings /> : null}
      {current === 'sites' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {can('location:read') ? <SitesCard /> : null}
          <HolidayCalendar today={today} />
        </div>
      ) : null}
      {current === 'payroll' ? (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <PayrollReadiness
              from={cycleFrom}
              to={today}
              selfId={selfId}
              monthName={monthLabel(month)}
            />
            {can('audit:read') ? <AuditTrail /> : null}
          </div>
          <ReportsCards from={cycleFrom} to={monthEnd(month)} />
        </div>
      ) : null}

      {manual.open ? (
        <ManualEntryModal
          tz={tz}
          today={today}
          preset={manual.preset}
          onClose={() => setManual({ open: false })}
        />
      ) : null}
      {openId ? <DayDetail id={openId} tz={tz} onClose={() => setOpenId(undefined)} /> : null}
    </div>
  );
}

/* ------------------------------- live attendance ------------------------------- */

function Live({ today }: { today: string }) {
  const { can } = useAuth();
  const depts = useDepartments();
  const locs = useList<WorkLocation>(
    'work-locations',
    '/work-locations',
    { limit: 50 },
    can('location:read'),
  );
  const [departmentId, setDepartmentId] = useState('');
  const [locationId, setLocationId] = useState('');
  const q = useData<LiveSnapshot>('live', '/reports/attendance/live', {
    departmentId: departmentId || undefined,
    locationId: locationId || undefined,
  });
  const l = q.data?.data;
  const pct = (n: number) =>
    l && l.headcount ? `${Math.round((n / l.headcount) * 1000) / 10}% of headcount` : '';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Live attendance · {today}</h2>
          <p className="text-xs text-muted">All employees in scope</p>
        </div>
        <div className="flex gap-2">
          <Field label="Department">
            {(id) => (
              <Select
                id={id}
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
              >
                <option value="">All departments</option>
                {depts.items.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {can('location:read') ? (
            <Field label="Location">
              {(id) => (
                <Select id={id} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  <option value="">All locations</option>
                  {(locs.data?.data ?? [])
                    .filter((x) => x.status === 'ACTIVE')
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
          ) : null}
        </div>
      </div>
      {q.isError ? <Alert tone="danger">{userMessage(q.error)}</Alert> : null}
      {q.isPending || !l ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Headcount" value={l.headcount} sub={`${l.expected} expected today`} />
            <Kpi label="Present" value={l.present} sub={pct(l.present)} />
            <Kpi label="On leave" value={l.onLeave} sub={pct(l.onLeave)} />
            <Kpi label="Absent" value={l.absent} sub="No leave or punch" />
            <Kpi label="Not in yet" value={l.notIn} sub="Shift started" />
            <Kpi label="Late today" value={l.lateToday} sub="Past grace period" />
          </div>
          <Card>
            <CardTitle className="mb-3 text-base text-foreground">By department</CardTitle>
            {l.byDepartment.length === 0 ? (
              <Empty>No departments with employees.</Empty>
            ) : (
              <Table aria-label="Attendance by department">
                <thead>
                  <tr>
                    <Th>Department</Th>
                    <Th>Headcount</Th>
                    <Th>Present</Th>
                    <Th>Leave</Th>
                    <Th>Absent</Th>
                    <Th>Not in yet</Th>
                    <Th>Distribution</Th>
                  </tr>
                </thead>
                <tbody>
                  {l.byDepartment.map((d) => {
                    const segs = [
                      [d.present, 'bg-success'],
                      [d.onLeave, 'bg-info'],
                      [d.absent, 'bg-danger'],
                      [d.notIn, 'bg-muted/50'],
                      [d.off + d.unscheduled, 'bg-subtle'],
                    ] as const;
                    return (
                      <tr key={d.departmentId}>
                        <Td className="font-medium">{d.name}</Td>
                        <Td>{d.headcount}</Td>
                        <Td>{d.present}</Td>
                        <Td>{d.onLeave}</Td>
                        <Td>{d.absent}</Td>
                        <Td>{d.notIn}</Td>
                        <Td className="min-w-40">
                          <div
                            className="flex h-2.5 overflow-hidden rounded-full bg-subtle"
                            role="img"
                            aria-label={`${d.name}: ${d.present} present of ${d.headcount}`}
                          >
                            {segs.map(([n, c], i) => (
                              <div
                                key={i}
                                className={c}
                                style={{ width: `${d.headcount ? (n / d.headcount) * 100 : 0}%` }}
                              />
                            ))}
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
            <ul className="mt-3 flex flex-wrap gap-3 text-xs text-muted" aria-label="Legend">
              {[
                ['Present', 'bg-success'],
                ['Leave', 'bg-info'],
                ['Absent', 'bg-danger'],
                ['Not in yet', 'bg-muted/50'],
                ['Off or no shift', 'bg-subtle'],
              ].map(([k, c]) => (
                <li key={k} className="flex items-center gap-1.5">
                  <span aria-hidden className={`h-2 w-2 rounded-full ${c}`} />
                  {k}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">
              Overall attendance today: {fmtPct(l.rate)} of those expected.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
