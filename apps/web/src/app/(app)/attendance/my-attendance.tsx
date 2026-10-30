'use client';
import { Coffee, LogIn, LogOut } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Alert,
  Badge,
  Card,
  CardTitle,
  Empty,
  Skeleton,
  Table,
  Td,
  Th,
} from '@/components/ui/display';
import { Field, Select } from '@/components/ui/form';
import { useList, useOne, useSave } from '@/hooks/api';
import { useAuth } from '@/components/auth';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import type { DayRow, Shift } from '@/lib/types';
import { cn, formatMinutes, formatTime } from '@/lib/utils';
import {
  CAL,
  dayKey,
  dow,
  longDate,
  monthLabel,
  monthStart,
  weekdayDate,
  type CalKey,
  type MonthStats,
} from './lib';

/* ------------------------------ today / punch ------------------------------ */

interface TodayData {
  workDate: string;
  state: 'OFF' | 'WORKING' | 'ON_BREAK' | string;
  openSince?: string;
  allowedActions: { action: string; eventType: string; enabled: boolean; reason?: string }[];
  shift?: { id: string; name: string; startTime: string; endTime: string };
  summary: {
    firstCheckIn?: string;
    lastCheckOut?: string;
    workedMinutes: number;
    scheduledMinutes: number;
    lateMinutes: number;
    isOpen: boolean;
  };
  photoRequired?: boolean;
  events: { id: string; eventType: string; workLocationName?: string }[];
}

const PUNCH_PATH: Record<string, string> = {
  CHECK_IN: 'check-in',
  CHECK_OUT: 'check-out',
  BREAK_START: 'break-start',
  BREAK_END: 'break-end',
};
const BUTTON_TEXT: Record<string, string> = {
  CHECK_IN: 'Punch in',
  CHECK_OUT: 'Punch out',
  BREAK_START: 'Start break',
  BREAK_END: 'End break',
};

/** One position reading; resolves null if the browser or the person declines. The server decides the time. */
function readLocation(): Promise<{
  latitude: number;
  longitude: number;
  accuracyMeters: number;
} | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          accuracyMeters: p.coords.accuracy,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );
  });
}

export function TodayCard({ tz }: { tz: string }) {
  const { can } = useAuth();
  const q = useOne<TodayData>('me-today', '/attendance/me/today');
  const shifts = useList<Shift>('shifts', '/shifts', { limit: 100 }, can('shift:read'));
  const [notice, setNotice] = useState<string>();
  const punch = useSave(
    async (eventType: string) => {
      const loc = await readLocation();
      return api.post<{ status?: string }>(`/attendance/${PUNCH_PATH[eventType]}`, {
        idempotencyKey: `wf-${crypto.randomUUID()}`,
        ...(loc ? { location: loc } : {}),
      });
    },
    ['me-today', 'my-days', 'my-days-recent', 'team-days', 'team-today'],
    (r) =>
      setNotice(
        r.data?.status === 'PENDING_REVIEW'
          ? 'Your punch is outside the allowed location and was sent to your manager for approval.'
          : undefined,
      ),
  );
  const d = q.data?.data;
  const grace = shifts.data?.data.find((s) => s.id === d?.shift?.id)?.graceMinutes;
  const canPunch = can('attendance:punch');
  const primary = d?.allowedActions.find(
    (a) => a.eventType === 'CHECK_IN' || a.eventType === 'CHECK_OUT',
  );
  const secondary = d?.allowedActions.find(
    (a) => a.eventType === 'BREAK_START' || a.eventType === 'BREAK_END',
  );
  const where = [...(d?.events ?? [])].reverse().find((e) => e.workLocationName)?.workLocationName;
  const badge =
    d?.state === 'WORKING' ? (
      <Badge tone="success">Working</Badge>
    ) : d?.state === 'ON_BREAK' ? (
      <Badge tone="warn">On break</Badge>
    ) : d?.summary.lastCheckOut ? (
      <Badge tone="info">Checked out</Badge>
    ) : (
      <Badge>Not punched in</Badge>
    );

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <p className="text-xs font-medium text-muted">Today</p>
        <h2 className="text-lg font-bold">{d ? longDate(d.workDate) : '—'}</h2>
      </div>
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : q.isError ? (
        <Alert tone="danger">{userMessage(q.error)}</Alert>
      ) : d ? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {badge}
            {d.summary.firstCheckIn ? (
              <span className="font-semibold">
                Punched in {formatTime(d.summary.firstCheckIn, tz)}
              </span>
            ) : null}
          </div>
          <dl className="space-y-1.5 text-sm">
            <Row k="Shift">
              {d.shift
                ? `${d.shift.name} · ${d.shift.startTime} – ${d.shift.endTime}`
                : 'No shift today'}
            </Row>
            {grace !== undefined ? <Row k="Grace period">{grace} min</Row> : null}
            {where ? <Row k="Location">{where}</Row> : null}
            <Row k="Target net hours">{formatMinutes(d.summary.scheduledMinutes)}</Row>
            <Row k="Worked so far">{formatMinutes(d.summary.workedMinutes)}</Row>
          </dl>
          {canPunch ? (
            <>
              {d.photoRequired ? (
                <Alert tone="info">
                  Your company requires a photo with each punch. Use the mobile app to punch.
                </Alert>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {primary ? (
                    <Button
                      variant="primary"
                      disabled={!primary.enabled}
                      title={primary.reason}
                      loading={punch.isPending && punch.variables === primary.eventType}
                      onClick={() => punch.mutate(primary.eventType)}
                    >
                      {primary.eventType === 'CHECK_IN' ? (
                        <LogIn className="h-4 w-4" aria-hidden />
                      ) : (
                        <LogOut className="h-4 w-4" aria-hidden />
                      )}
                      {BUTTON_TEXT[primary.eventType]}
                    </Button>
                  ) : null}
                  {secondary ? (
                    <Button
                      variant="secondary"
                      disabled={!secondary.enabled}
                      title={secondary.reason}
                      loading={punch.isPending && punch.variables === secondary.eventType}
                      onClick={() => punch.mutate(secondary.eventType)}
                    >
                      <Coffee className="h-4 w-4" aria-hidden />
                      {BUTTON_TEXT[secondary.eventType]}
                    </Button>
                  ) : null}
                </div>
              )}
              {punch.error ? <Alert tone="danger">{punch.error}</Alert> : null}
              {notice ? <Alert tone="info">{notice}</Alert> : null}
              <p className="text-xs text-muted">
                Server time is used for every punch. Your location is checked against your company
                geofence when one is set.
              </p>
            </>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="flex justify-between gap-3">
    <dt className="text-muted">{k}</dt>
    <dd className="text-right font-medium">{children}</dd>
  </div>
);

/* ------------------------------ month summary ------------------------------ */

export function MonthSummary({
  month,
  stats,
  loading,
}: {
  month: string;
  stats: MonthStats;
  loading: boolean;
}) {
  const tiles: { k: string; v: string; sub?: string }[] = [
    { k: 'Present days', v: String(stats.present), sub: `of ${stats.workingDays} working days` },
    { k: 'Absent', v: String(stats.absent) },
    { k: 'Late marks', v: String(stats.late) },
    { k: 'On leave', v: String(stats.leave) },
    { k: 'Half day', v: String(stats.half) },
    { k: 'Incomplete', v: String(stats.incomplete), sub: 'Missing a punch' },
    { k: 'Overtime', v: formatMinutes(stats.overtimeMinutes) },
    {
      k: 'Attendance rate',
      v: stats.rate === null ? '—' : `${stats.rate}%`,
      sub: 'Excluding approved leave',
    },
  ];
  return (
    <section aria-label="Month summary">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{monthLabel(month)} summary</h2>
        <span className="text-xs text-muted">Recorded days only</span>
      </div>
      {loading ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map((t) => (
            <Card key={t.k} className="p-4">
              <p className="text-xs font-medium text-muted">{t.k}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{t.v}</p>
              {t.sub ? <p className="mt-0.5 text-[11px] text-muted">{t.sub}</p> : null}
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

/* --------------------------------- calendar -------------------------------- */

export function CalendarCard({
  month,
  rows,
  today,
  loading,
}: {
  month: string;
  rows: DayRow[];
  today: string;
  loading: boolean;
}) {
  const byDate = useMemo(() => new Map(rows.map((r) => [r.workDate, r])), [rows]);
  const first = monthStart(month);
  const lead = (dow(first) + 6) % 7; // Monday-first grid
  const days = Number(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate());
  const cells: (string | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
  ];
  return (
    <Card>
      <div className="mb-3 flex items-baseline justify-between">
        <CardTitle className="text-base text-foreground">Monthly calendar</CardTitle>
        <span className="text-xs text-muted">{monthLabel(month)}</span>
      </div>
      {loading ? (
        <Skeleton className="h-72" />
      ) : (
        <div
          className="grid grid-cols-7 gap-1.5 text-xs"
          role="grid"
          aria-label="Attendance calendar"
        >
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => (
            <div key={w} className="px-1 pb-1 font-medium text-muted" role="columnheader">
              {w}
            </div>
          ))}
          {cells.map((d, i) => {
            if (!d) return <div key={`b${i}`} />;
            const row = byDate.get(d);
            const k: CalKey | undefined = row ? dayKey(row) : undefined;
            const future = d > today;
            return (
              <div
                key={d}
                role="gridcell"
                className={cn(
                  'flex min-h-14 flex-col justify-between rounded-lg border border-transparent p-1.5',
                  k ? CAL[k].cell : 'bg-card text-muted',
                  !k && 'border-border',
                  d === today && 'ring-2 ring-primary',
                )}
              >
                <span className="font-semibold">{Number(d.slice(8))}</span>
                <span className="truncate text-[10px] font-medium">
                  {k ? CAL[k].label : future ? '' : '—'}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Legend">
        {(
          ['PRESENT', 'LATE', 'HALF_DAY', 'ON_LEAVE', 'ABSENT', 'HOLIDAY', 'WEEKLY_OFF'] as CalKey[]
        ).map((k) => (
          <li
            key={k}
            className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-medium', CAL[k].chip)}
          >
            {CAL[k].label}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ------------------------- net hours + exceptions -------------------------- */

export function NetHoursCard({ rows }: { rows: DayRow[] }) {
  const days = rows
    .filter((r) => r.status !== 'HOLIDAY' && r.status !== 'WEEKLY_OFF' && r.status !== 'ON_LEAVE')
    .sort((a, b) => a.workDate.localeCompare(b.workDate))
    .slice(-7);
  const target = Math.max(0, ...days.map((d) => d.scheduledMinutes ?? 0)) || 480;
  const max = Math.max(target, ...days.map((d) => d.workedMinutes), 1);
  const avgBase = days.filter((d) => d.workedMinutes > 0);
  const avg = avgBase.length
    ? avgBase.reduce((s, d) => s + d.workedMinutes, 0) / avgBase.length
    : 0;
  return (
    <Card>
      <div className="mb-3 flex items-baseline justify-between">
        <CardTitle className="text-base text-foreground">Net hours · last 7 working days</CardTitle>
        <span className="text-xs text-muted">Average {formatMinutes(avg)}</span>
      </div>
      {days.length === 0 ? (
        <Empty>No working days recorded yet.</Empty>
      ) : (
        <div>
          <div className="relative flex h-40 items-end gap-2 border-b border-border">
            <div
              aria-hidden
              className="absolute inset-x-0 border-t border-dashed border-muted/70"
              style={{ bottom: `${(target / max) * 100}%` }}
            />
            {days.map((d) => (
              <div
                key={d.workDate}
                className="relative flex h-full flex-1 items-end justify-center"
              >
                <div
                  className="w-full max-w-10 rounded-t-md bg-primary"
                  style={{
                    height: `${(d.workedMinutes / max) * 100}%`,
                    minHeight: d.workedMinutes ? 4 : 0,
                  }}
                  role="img"
                  aria-label={`${weekdayDate(d.workDate)}: ${formatMinutes(d.workedMinutes)}`}
                />
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-2 text-center text-[10px] text-muted">
            {days.map((d) => (
              <div key={d.workDate} className="flex-1">
                <p className="font-medium tabular-nums text-foreground">
                  {formatMinutes(d.workedMinutes)}
                </p>
                <p>{weekdayDate(d.workDate).slice(5)}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted">Dashed line: target {formatMinutes(target)}</p>
        </div>
      )}
    </Card>
  );
}

export function ExceptionsCard({
  stats,
  pendingRequests,
}: {
  stats: MonthStats;
  pendingRequests: number;
}) {
  const items = [
    ['Late marks', stats.late],
    ['Early exits', stats.earlyExit],
    ['Missing punches', stats.incomplete],
    ['Pending regularizations', pendingRequests],
  ] as const;
  return (
    <Card>
      <CardTitle className="mb-2 text-base text-foreground">Exceptions this month</CardTitle>
      <dl className="divide-y divide-border text-sm">
        {items.map(([k, v]) => (
          <div key={k} className="flex justify-between py-2">
            <dt className="text-muted">{k}</dt>
            <dd className="font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/* -------------------------------- daily log -------------------------------- */

const REGULARIZABLE = new Set<string>(['ABSENT', 'INCOMPLETE', 'LATE', 'HALF_DAY']);

export function DailyLog({
  recent,
  monthRows,
  month,
  tz,
  shifts,
  canDetail,
  onRegularize,
  onDetail,
  loading,
}: {
  recent: DayRow[];
  monthRows: DayRow[];
  month: string;
  tz: string;
  shifts: Shift[];
  canDetail: boolean;
  onRegularize: (date: string) => void;
  onDetail: (id: string) => void;
  loading: boolean;
}) {
  const [period, setPeriod] = useState<'recent' | 'month'>('recent');
  const [status, setStatus] = useState('');
  const [showAll, setShowAll] = useState(false);
  const source = period === 'recent' ? recent : monthRows;
  const all = [...source].sort((a, b) => b.workDate.localeCompare(a.workDate));
  const filtered = all.filter((r) => !status || dayKey(r) === status || r.status === status);
  const shown = showAll ? filtered : filtered.slice(0, 8);
  const shiftName = (id?: string) => shifts.find((s) => s.id === id)?.name ?? '—';
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <CardTitle className="text-base text-foreground">Daily attendance log</CardTitle>
          <p className="text-xs text-muted">
            Punch records from biometric, mobile and web sources. Times are in the company timezone.
          </p>
        </div>
        <div className="flex gap-2">
          <Field label="Period">
            {(id) => (
              <Select
                id={id}
                value={period}
                onChange={(e) => {
                  setPeriod(e.target.value as 'recent' | 'month');
                  setShowAll(false);
                }}
              >
                <option value="recent">Recent days</option>
                <option value="month">{monthLabel(month)}</option>
              </Select>
            )}
          </Field>
          <Field label="Status">
            {(id) => (
              <Select
                id={id}
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setShowAll(false);
                }}
              >
                <option value="">All statuses</option>
                {(Object.keys(CAL) as CalKey[])
                  .filter((k) => k !== 'WORKING')
                  .map((k) => (
                    <option key={k} value={k}>
                      {CAL[k].label}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        </div>
      </div>
      {loading ? (
        <Skeleton className="h-48" />
      ) : (
        <>
          <Table aria-label="My daily attendance">
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Shift</Th>
                <Th>Punch-in</Th>
                <Th>Punch-out</Th>
                <Th>Break</Th>
                <Th>Net hours</Th>
                <Th>Overtime</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Action</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const k = dayKey(r);
                const off =
                  r.status === 'HOLIDAY' || r.status === 'WEEKLY_OFF' || r.status === 'ON_LEAVE';
                return (
                  <tr key={r.id}>
                    <Td className="whitespace-nowrap">{weekdayDate(r.workDate)}</Td>
                    <Td>{off ? '—' : shiftName(r.shiftId)}</Td>
                    <Td className="tabular-nums">{formatTime(r.firstCheckIn, tz)}</Td>
                    <Td className="tabular-nums">
                      {r.isOpen ? 'In progress' : formatTime(r.lastCheckOut, tz)}
                    </Td>
                    <Td>{r.breakMinutes ? `${r.breakMinutes}m` : '—'}</Td>
                    <Td>{r.workedMinutes ? formatMinutes(r.workedMinutes) : '—'}</Td>
                    <Td>{r.overtimeMinutes ? formatMinutes(r.overtimeMinutes) : '—'}</Td>
                    <Td>
                      <span
                        className={cn(
                          'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
                          CAL[k].chip,
                        )}
                      >
                        {CAL[k].label}
                        {k === 'LATE' ? ` · ${r.lateMinutes} min` : ''}
                      </span>
                      {r.correctionStatus === 'PENDING' ? (
                        <span className="ml-1">
                          <Badge tone="warn">Correction pending</Badge>
                        </span>
                      ) : null}
                    </Td>
                    <Td className="whitespace-nowrap text-right">
                      {canDetail ? (
                        <Button size="sm" variant="ghost" onClick={() => onDetail(r.id)}>
                          Details
                        </Button>
                      ) : null}
                      {REGULARIZABLE.has(k) && r.correctionStatus !== 'PENDING' ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => onRegularize(r.workDate)}
                        >
                          Regularize
                        </Button>
                      ) : null}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          {filtered.length === 0 ? <Empty>No attendance matches these filters.</Empty> : null}
          <div className="mt-3 flex items-center justify-between text-xs text-muted">
            <span>
              Showing {shown.length} of {filtered.length} days
            </span>
            {filtered.length > 8 ? (
              <Button size="sm" variant="secondary" onClick={() => setShowAll((s) => !s)}>
                {showAll ? 'Show fewer' : 'View full month'}
              </Button>
            ) : null}
          </div>
        </>
      )}
    </Card>
  );
}
