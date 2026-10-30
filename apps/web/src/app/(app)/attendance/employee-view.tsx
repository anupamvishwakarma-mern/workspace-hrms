'use client';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/components/auth';
import { Button } from '@/components/ui/button';
import { Alert, Skeleton, TabBar } from '@/components/ui/display';
import { useList, useOne } from '@/hooks/api';
import { useTenant } from '@/hooks/lookups';
import type { Correction, DayRow, Employee, Shift } from '@/lib/types';
import { addDaysIso, formatDate, todayIso } from '@/lib/utils';
import { downloadCsv } from './csv';
import { DayDetail } from './day-detail';
import { LeaveBalanceCard, LeaveThisMonth, RosterCard, UpcomingHolidays } from './leave-roster';
import {
  CalendarCard,
  DailyLog,
  ExceptionsCard,
  MonthSummary,
  NetHoursCard,
  TodayCard,
} from './my-attendance';
import { addMonth, monthEnd, monthLabel, monthStart, monthStats } from './lib';
import { AlertsCard, PolicyCard, PunchSourcesCard, ReportsCards } from './reports-policy';
import { OwnReports } from './reports-own';
import { MyRequests, RequestForm } from './requests';
import { ViewHeader } from './shared';
import { TeamSection } from './team';

type Tab = 'overview' | 'calendar' | 'log' | 'requests' | 'leave' | 'roster' | 'team' | 'reports';

export function EmployeeView({ switcher }: { switcher: ReactNode }) {
  const { can, active } = useAuth();
  const tenant = useTenant();
  const tz = tenant.data?.data.timezone;
  const today = tz ? todayIso(tz) : undefined;
  const [month, setMonth] = useState<string>();
  const m = month ?? today?.slice(0, 7);
  const [tab, setTab] = useState<Tab>('overview');
  const [preset, setPreset] = useState<{ date?: string; nonce: number }>({ nonce: 0 });
  const [openId, setOpenId] = useState<string>();
  const [exportError, setExportError] = useState<string>();

  // What the signed-in role may see. The API enforces the same rules; this only hides what would be refused.
  const employeeId = active?.employeeId;
  const own = can('attendance:read:self') && !!employeeId;
  const isStaff = can('attendance:read:all', 'attendance:read:team');
  // HR and owners manage the team from their own views; managers and payroll get the team tab here.
  const teamHere = isStaff && !can('attendance:review:all');

  const from = m ? monthStart(m) : undefined;
  const to = m && today ? (monthEnd(m) < today ? monthEnd(m) : today) : undefined;
  const monthQ = useList<DayRow>(
    'my-days',
    '/attendance/me/history',
    { from, to, limit: 100 },
    own && !!from && !!to && (to ?? '') >= (from ?? ''),
  );
  const recentQ = useList<DayRow>(
    'my-days-recent',
    '/attendance/me/history',
    { from: today ? addDaysIso(today, -13) : undefined, to: today, limit: 30 },
    own && !!today,
  );
  const shifts = useList<Shift>('shifts', '/shifts', { limit: 100 }, can('shift:read'));
  const todayQ = useOne<{ shift?: { id: string } }>('me-today', '/attendance/me/today', own);
  const todayShiftId = todayQ.data?.data.shift?.id;
  const me = useOne<Employee>(
    'me-employee',
    `/employees/${employeeId}`,
    !!employeeId && can('employee:read:self', 'employee:read:all'),
  );
  const mgrId = me.data?.data.managerId;
  const mgr = useOne<Employee>(
    'manager-employee',
    `/employees/${mgrId}`,
    !!mgrId && can('employee:read:all', 'employee:read:team'),
  );
  const mgrName = mgr.data ? `${mgr.data.data.firstName} ${mgr.data.data.lastName}` : undefined;

  const reqQ = useList<Correction>(
    'my-requests',
    '/attendance/corrections',
    { employeeId, limit: 20 },
    !!employeeId,
  );
  const pending = (reqQ.data?.data ?? []).filter((r) => r.status === 'PENDING').length;
  const monthRows = useMemo(() => monthQ.data?.data ?? [], [monthQ.data]);
  const stats = useMemo(() => monthStats(monthRows), [monthRows]);
  const absentDates = monthRows.filter((r) => r.status === 'ABSENT').map((r) => r.workDate);

  const alerts: { tone: 'warn' | 'danger' | 'info'; title: string; text: string }[] = [];
  const unrequested = monthRows.filter(
    (r) => r.status === 'ABSENT' && r.correctionStatus !== 'PENDING',
  );
  for (const r of unrequested.slice(0, 3))
    alerts.push({
      tone: 'danger',
      title: 'Action needed',
      text: `${formatDate(r.workDate)} has no punches and is marked absent. Raise a regularization request if you worked.`,
    });
  if (stats.late > 0)
    alerts.push({
      tone: 'warn',
      title: 'Heads-up',
      text: `${stats.late} late mark${stats.late === 1 ? '' : 's'} this month.`,
    });
  if (stats.incomplete > 0)
    alerts.push({
      tone: 'warn',
      title: 'Missing punch',
      text: `${stats.incomplete} day${stats.incomplete === 1 ? ' is' : 's are'} missing a punch.`,
    });

  const goTo = (t: Tab) => setTab(t);
  const regularize = (date?: string) => {
    setPreset((p) => ({ date, nonce: p.nonce + 1 }));
    goTo('requests');
  };

  function exportData() {
    if (!m) return;
    setExportError(undefined);
    const head = [
      'Date',
      'Status',
      'First in',
      'Last out',
      'Worked min',
      'Break min',
      'Late min',
      'Overtime min',
    ];
    const lines = [...monthRows]
      .sort((a, b) => a.workDate.localeCompare(b.workDate))
      .map((r) => [
        r.workDate,
        r.status,
        r.firstCheckIn,
        r.lastCheckOut,
        r.workedMinutes,
        r.breakMinutes,
        r.lateMinutes,
        r.overtimeMinutes,
      ]);
    downloadCsv(`my-attendance-${m}.csv`, [head, ...lines]);
  }

  const allTabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'calendar', label: 'Calendar' },
    { key: 'log', label: 'Daily log' },
    { key: 'requests', label: 'Regularization' },
    { key: 'leave', label: 'Leave & holidays' },
    { key: 'roster', label: 'Shift & roster' },
    { key: 'team', label: 'Team view' },
    { key: 'reports', label: 'Reports & policy' },
  ];
  const tabs = allTabs.filter((t) => {
    if (t.key === 'overview' || t.key === 'calendar' || t.key === 'log' || t.key === 'requests')
      return own;
    if (t.key === 'leave') return own && can('leave:apply');
    if (t.key === 'roster') return own && can('shift:read');
    if (t.key === 'team') return teamHere;
    return own || teamHere;
  });
  const current: Tab | undefined = tabs.find((t) => t.key === tab)?.key ?? tabs[0]?.key;

  if (!tz || !today || !m || !from || !to) return <Skeleton className="h-96" />;
  const person = me.data?.data;
  const sub = person
    ? [
        `${person.firstName} ${person.lastName}`,
        person.designation,
        person.employeeCode,
        mgrName ? `Reports to ${mgrName}` : undefined,
      ]
        .filter(Boolean)
        .join(' · ')
    : 'Times are shown in the company timezone.';

  return (
    <div className="space-y-6">
      <ViewHeader
        view="employee"
        switcher={switcher}
        crumb="My workspace / Attendance"
        title="Attendance"
        sub={sub}
        actions={
          <>
            <div className="flex items-center rounded-lg border border-border bg-card shadow-sm">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Previous month"
                onClick={() => setMonth(addMonth(m, -1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-32 text-center text-sm font-semibold">{monthLabel(m)}</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Next month"
                disabled={m >= today.slice(0, 7)}
                onClick={() => setMonth(addMonth(m, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            {own ? (
              <Button variant="secondary" onClick={exportData}>
                <Download className="h-4 w-4" aria-hidden /> Export
              </Button>
            ) : null}
            {own ? <Button onClick={() => regularize()}>Regularize attendance</Button> : null}
          </>
        }
      />
      {exportError ? <Alert tone="danger">{exportError}</Alert> : null}
      {!own && !employeeId ? (
        <Alert tone="info">
          Your account has no employee profile, so personal attendance is not shown. Ask HR to link
          one.
        </Alert>
      ) : null}

      <TabBar
        label="Attendance sections"
        className="mb-0"
        tabs={tabs}
        value={tab}
        onChange={goTo}
      />

      {current === 'overview' ? (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
            <TodayCard tz={tz} />
            <MonthSummary month={m} stats={stats} loading={monthQ.isPending} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <NetHoursCard rows={recentQ.data?.data ?? []} />
            <div className="space-y-4">
              <ExceptionsCard stats={stats} pendingRequests={pending} />
              <AlertsCard items={alerts} />
            </div>
          </div>
        </div>
      ) : null}

      {current === 'calendar' ? (
        <CalendarCard month={m} rows={monthRows} today={today} loading={monthQ.isPending} />
      ) : null}

      {current === 'log' ? (
        <DailyLog
          recent={recentQ.data?.data ?? []}
          monthRows={monthRows}
          month={m}
          tz={tz}
          shifts={shifts.data?.data ?? []}
          canDetail={can('attendance:events:read')}
          onRegularize={(d) => regularize(d)}
          onDetail={setOpenId}
          loading={recentQ.isPending || monthQ.isPending}
        />
      ) : null}

      {current === 'requests' ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <RequestForm
            tz={tz}
            today={today}
            presetDate={preset.date}
            presetNonce={preset.nonce}
            approver={mgrName}
          />
          <MyRequests employeeId={employeeId} absentDates={absentDates} />
        </div>
      ) : null}

      {current === 'leave' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <LeaveBalanceCard />
          <div className="space-y-4">
            {can('holiday:read') ? <UpcomingHolidays today={today} /> : null}
            <LeaveThisMonth month={m} />
          </div>
        </div>
      ) : null}

      {current === 'roster' ? <RosterCard employeeId={employeeId} today={today} /> : null}

      {current === 'team' ? (
        <TeamSection today={today} tz={tz} selfId={employeeId} onDetail={setOpenId} />
      ) : null}

      {current === 'reports' ? (
        <div className="space-y-4">
          {own && employeeId ? (
            <OwnReports month={m} from={from} to={monthEnd(m)} employeeId={employeeId} />
          ) : null}
          {teamHere ? <ReportsCards from={from} to={monthEnd(m)} /> : null}
          <div className="grid gap-4 lg:grid-cols-2">
            <PolicyCard shiftId={todayShiftId} />
            <div className="space-y-4">
              {can('location:read') ? <PunchSourcesCard /> : null}
              {own ? <AlertsCard items={alerts} /> : null}
            </div>
          </div>
        </div>
      ) : null}

      {openId ? <DayDetail id={openId} tz={tz} onClose={() => setOpenId(undefined)} /> : null}
    </div>
  );
}
