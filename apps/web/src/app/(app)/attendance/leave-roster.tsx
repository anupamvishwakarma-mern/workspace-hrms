'use client';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import {
  Alert,
  Badge,
  Card,
  CardTitle,
  Empty,
  Skeleton,
  statusTone,
} from '@/components/ui/display';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { useAuth } from '@/components/auth';
import { useList, useSave } from '@/hooks/api';
import { api } from '@/lib/api';
import type {
  Holiday,
  LeaveBalance,
  LeaveRequest,
  LeaveType,
  Shift,
  ShiftAssignment,
} from '@/lib/types';
import { cn, compact, formatDate, label } from '@/lib/utils';
import { dow, monthEnd, monthStart } from './lib';

/* ------------------------------ leave balance ------------------------------ */

export function LeaveBalanceCard() {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const q = useList<LeaveBalance>('my-balances', '/leave/balances', {});
  return (
    <Card>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base text-foreground">Leave balance</CardTitle>
          <p className="text-xs text-muted">Current leave year</p>
        </div>
        {can('leave:apply') ? (
          <Button size="sm" onClick={() => setOpen(true)}>
            Apply for leave
          </Button>
        ) : null}
      </div>
      {q.isPending ? (
        <Skeleton className="h-32" />
      ) : (q.data?.data.length ?? 0) === 0 ? (
        <Empty>No leave types are set up yet.</Empty>
      ) : (
        <ul className="space-y-3">
          {q.data?.data.map((b) => {
            const used = b.approvedDays;
            const pct = b.allowanceDays ? Math.min(100, (used / b.allowanceDays) * 100) : 0;
            return (
              <li key={b.leaveTypeId}>
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{b.name}</span>
                  <span className="text-muted">
                    {b.remainingDays === null
                      ? 'Unlimited'
                      : `${b.remainingDays} left of ${b.allowanceDays}`}{' '}
                    · {used} used
                    {b.pendingDays ? ` · ${b.pendingDays} pending` : ''}
                  </span>
                </div>
                <div
                  className="mt-1 h-2 overflow-hidden rounded-full bg-subtle"
                  role="progressbar"
                  aria-label={`${b.name} used`}
                  aria-valuenow={Math.round(pct)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {open ? <ApplyLeave onClose={() => setOpen(false)} /> : null}
    </Card>
  );
}

function ApplyLeave({ onClose }: { onClose: () => void }) {
  const types = useList<LeaveType>('leave-types', '/leave-types', { limit: 100 });
  const [f, setF] = useState({
    leaveTypeId: '',
    startDate: '',
    endDate: '',
    halfDay: false,
    halfDaySession: 'FIRST',
    reason: '',
  });
  const save = useSave(
    () =>
      api.post('/leave/requests', {
        ...compact({
          leaveTypeId: f.leaveTypeId,
          startDate: f.startDate,
          endDate: f.endDate || f.startDate,
          reason: f.reason,
        }),
        halfDay: f.halfDay,
        ...(f.halfDay ? { halfDaySession: f.halfDaySession } : {}),
      }),
    ['my-balances', 'my-leave', 'leave-requests', 'approvals'],
    onClose,
  );
  const active = (types.data?.data ?? []).filter((t) => t.status === 'ACTIVE');
  const sel = active.find((t) => t.id === f.leaveTypeId);
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Apply for leave"
      description="Your manager or HR will review the request."
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <Field label="Leave type">
          {(id) => (
            <Select
              id={id}
              required
              value={f.leaveTypeId}
              onChange={(e) => setF({ ...f, leaveTypeId: e.target.value })}
            >
              <option value="">Select…</option>
              {active.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From">
            {(id) => (
              <Input
                id={id}
                type="date"
                required
                value={f.startDate}
                onChange={(e) =>
                  setF({ ...f, startDate: e.target.value, endDate: f.endDate || e.target.value })
                }
              />
            )}
          </Field>
          <Field label="To">
            {(id) => (
              <Input
                id={id}
                type="date"
                required
                min={f.startDate}
                value={f.endDate}
                onChange={(e) => setF({ ...f, endDate: e.target.value })}
              />
            )}
          </Field>
        </div>
        {sel?.allowHalfDay ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={f.halfDay}
                onChange={(e) =>
                  setF({
                    ...f,
                    halfDay: e.target.checked,
                    endDate: e.target.checked ? f.startDate : f.endDate,
                  })
                }
              />
              Half day
            </label>
            {f.halfDay ? (
              <Select
                aria-label="Half-day session"
                className="w-40"
                value={f.halfDaySession}
                onChange={(e) => setF({ ...f, halfDaySession: e.target.value })}
              >
                <option value="FIRST">First half</option>
                <option value="SECOND">Second half</option>
              </Select>
            ) : null}
          </div>
        ) : null}
        <Field label="Reason (optional)">
          {(id) => (
            <Textarea
              id={id}
              maxLength={1000}
              value={f.reason}
              onChange={(e) => setF({ ...f, reason: e.target.value })}
            />
          )}
        </Field>
        {save.error ? <Alert tone="danger">{save.error}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Submit
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* --------------------------- holidays + leave month ------------------------- */

export function UpcomingHolidays({ today }: { today: string }) {
  const q = useList<Holiday>('holidays-upcoming', '/holidays', { from: today, limit: 5 });
  return (
    <Card>
      <CardTitle className="mb-2 text-base text-foreground">Upcoming holidays</CardTitle>
      {q.isPending ? (
        <Skeleton className="h-24" />
      ) : (q.data?.data.length ?? 0) === 0 ? (
        <Empty>No upcoming holidays.</Empty>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {q.data?.data.map((h) => (
            <li key={h.id} className="flex justify-between gap-3 py-2">
              <span className="font-medium">{h.name}</span>
              <span className="text-muted">
                {DateTime.fromISO(h.date.slice(0, 10), { zone: 'utc' }).toFormat('ccc, d LLL yyyy')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function LeaveThisMonth({ month }: { month: string }) {
  const q = useList<LeaveRequest>('my-leave', '/leave/requests', {
    scope: 'mine',
    from: monthStart(month),
    to: monthEnd(month),
    limit: 20,
  });
  return (
    <Card>
      <CardTitle className="mb-2 text-base text-foreground">Leave this month</CardTitle>
      {q.isPending ? (
        <Skeleton className="h-16" />
      ) : (q.data?.data.length ?? 0) === 0 ? (
        <p className="text-sm text-muted">No leave this month.</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {q.data?.data.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium">{l.leaveType?.name ?? 'Leave'}</span>
                {l.halfDay ? ' (half day)' : ''}
              </span>
              <span className="flex items-center gap-2 text-muted">
                {formatDate(l.startDate)}
                {l.endDate !== l.startDate ? ` – ${formatDate(l.endDate)}` : ''}
                <Badge tone={statusTone(l.status)}>{label(l.status)}</Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ---------------------------------- roster --------------------------------- */

export function RosterCard({ employeeId, today }: { employeeId?: string; today: string }) {
  const start = DateTime.fromISO(today, { zone: 'utc' }).startOf('week').toISODate()!; // Monday
  const end = DateTime.fromISO(start, { zone: 'utc' }).plus({ days: 13 }).toISODate()!;
  const assigns = useList<ShiftAssignment>(
    'my-assignments',
    '/shift-assignments',
    { employeeId, limit: 100 },
    !!employeeId,
  );
  const shifts = useList<Shift>('shifts', '/shifts', { limit: 100 });
  const hols = useList<Holiday>('holidays-roster', '/holidays', {
    from: start,
    to: end,
    limit: 100,
  });
  const days = Array.from({ length: 14 }, (_, i) =>
    DateTime.fromISO(start, { zone: 'utc' }).plus({ days: i }).toISODate()!,
  );
  const cell = (d: string) => {
    const hol = hols.data?.data.find((h) => h.date.slice(0, 10) === d);
    const a = assigns.data?.data.find(
      (x) => x.effectiveFrom <= d && (!x.effectiveTo || d <= x.effectiveTo),
    );
    const s = shifts.data?.data.find((x) => x.id === a?.shiftId);
    if (hol) return { kind: 'off' as const, title: 'Holiday', sub: hol.name };
    if (!s) return { kind: 'none' as const, title: 'No shift', sub: '—' };
    if (s.weeklyOffDays.includes(dow(d)))
      return { kind: 'off' as const, title: 'Week off', sub: '—' };
    return { kind: 'on' as const, title: s.name, sub: `${s.startTime}–${s.endTime}` };
  };
  const loading = assigns.isPending || shifts.isPending;
  return (
    <Card>
      <CardTitle className="text-base text-foreground">Shift &amp; roster</CardTitle>
      <p className="mb-3 text-xs text-muted">
        {DateTime.fromISO(start, { zone: 'utc' }).toFormat('d LLL')} –{' '}
        {DateTime.fromISO(end, { zone: 'utc' }).toFormat('d LLL')} · Your assigned shifts and days
        off
      </p>
      {loading ? (
        <Skeleton className="h-32" />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {days.map((d) => {
            const c = cell(d);
            return (
              <div
                key={d}
                className={cn(
                  'rounded-lg border p-2 text-xs',
                  c.kind === 'on'
                    ? 'border-info/30 bg-info-bg text-info'
                    : 'border-border bg-subtle text-muted',
                  d === today && 'ring-2 ring-primary',
                )}
              >
                <p className="font-semibold">
                  {DateTime.fromISO(d, { zone: 'utc' }).toFormat('ccc · d LLL')}
                </p>
                <p className="mt-1 font-medium">{c.title}</p>
                <p>{c.sub}</p>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
