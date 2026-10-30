'use client';
import { DateTime } from 'luxon';
import { useState, type ReactNode } from 'react';
import { useAuth } from '@/components/auth';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Alert, Badge, Skeleton, statusTone } from '@/components/ui/display';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { useList, useSave } from '@/hooks/api';
import { api } from '@/lib/api';
import type { Holiday, LeaveRequest, LeaveType } from '@/lib/types';
import { cn, compact, label } from '@/lib/utils';
import { dowOf } from './data';

export const LEAVE_REFRESH = [
  'leave-requests',
  'my-balances',
  'my-leave',
  'approvals',
  'leave-balances',
  'team-balances',
  'days',
  'dashboard',
];

export const MonthNav = ({
  month,
  onChange,
  max,
}: {
  month: string;
  onChange: (m: string) => void;
  max?: string;
}) => {
  const shift = (n: number) =>
    DateTime.fromISO(`${month}-01`, { zone: 'utc' }).plus({ months: n }).toFormat('yyyy-LL');
  return (
    <div className="flex items-center gap-1 text-sm">
      <Button
        size="sm"
        variant="ghost"
        aria-label="Previous month"
        onClick={() => onChange(shift(-1))}
      >
        ‹
      </Button>
      <span className="min-w-28 text-center font-semibold">
        {DateTime.fromISO(`${month}-01`, { zone: 'utc' }).toFormat('LLLL yyyy')}
      </span>
      <Button
        size="sm"
        variant="ghost"
        aria-label="Next month"
        disabled={!!max && month >= max}
        onClick={() => onChange(shift(1))}
      >
        ›
      </Button>
    </div>
  );
};

export interface CalCell {
  text?: string;
  sub?: string;
  tone?: 'none' | 'info' | 'warn' | 'danger' | 'off' | 'success';
}
const TONE: Record<NonNullable<CalCell['tone']>, string> = {
  none: 'bg-card border-border',
  info: 'bg-info-bg text-info border-transparent',
  warn: 'bg-warn-bg text-warn border-transparent',
  danger: 'bg-danger-bg text-danger border-transparent',
  success: 'bg-success-bg text-success border-transparent',
  off: 'bg-subtle text-muted border-transparent',
};
/** Monday-first month grid. `cell` decides what each date shows. */
export function CalendarGrid({
  month,
  today,
  cell,
}: {
  month: string;
  today: string;
  cell: (date: string) => CalCell;
}) {
  const first = `${month}-01`;
  const lead = (dowOf(first) + 6) % 7;
  const n = DateTime.fromISO(first, { zone: 'utc' }).daysInMonth!;
  const cells = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
  ];
  return (
    <div className="grid grid-cols-7 gap-1.5 text-xs" role="grid" aria-label="Calendar">
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => (
        <div key={w} className="px-1 pb-1 font-medium text-muted" role="columnheader">
          {w}
        </div>
      ))}
      {cells.map((d, i) => {
        if (!d) return <div key={`b${i}`} />;
        const c = cell(d);
        return (
          <div
            key={d}
            role="gridcell"
            className={cn(
              'flex min-h-16 flex-col justify-between rounded-lg border p-1.5',
              TONE[c.tone ?? 'none'],
              d === today && 'ring-2 ring-primary',
            )}
          >
            <span className="font-semibold">{Number(d.slice(8))}</span>
            <span>
              {c.text ? (
                <span className="block truncate text-[10px] font-semibold">{c.text}</span>
              ) : null}
              {c.sub ? <span className="block truncate text-[10px]">{c.sub}</span> : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function Legend({ items }: { items: [string, CalCell['tone']][] }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Legend">
      {items.map(([k, t]) => (
        <li
          key={k}
          className={cn(
            'rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
            TONE[t ?? 'none'],
          )}
        >
          {k}
        </li>
      ))}
    </ul>
  );
}

export function HolidayList({ from, limit = 5 }: { from: string; limit?: number }) {
  const q = useList<Holiday>('holidays-upcoming', '/holidays', { from, limit });
  if (q.isPending) return <Skeleton className="h-24" />;
  if ((q.data?.data.length ?? 0) === 0)
    return <p className="text-sm text-muted">No upcoming holidays.</p>;
  return (
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
  );
}

export const StatusBadge = ({ s }: { s: string }) => <Badge tone={statusTone(s)}>{label(s)}</Badge>;

/* ------------------------------ apply for leave ------------------------------ */

export function ApplyForm({
  onDone,
  balanceOf,
  intro,
}: {
  onDone?: () => void;
  /** Remaining days for a leave type id, to show beside the form. */
  balanceOf?: (typeId: string) => number | null | undefined;
  intro?: ReactNode;
}) {
  const types = useList<LeaveType>('leave-types', '/leave-types', { limit: 100 });
  const [f, setF] = useState({
    leaveTypeId: '',
    duration: 'FULL',
    session: 'FIRST',
    startDate: '',
    endDate: '',
    reason: '',
  });
  const [sent, setSent] = useState(false);
  const active = (types.data?.data ?? []).filter((t) => t.status === 'ACTIVE');
  const sel = active.find((t) => t.id === f.leaveTypeId);
  const half = f.duration === 'HALF';
  const save = useSave(
    () =>
      api.post('/leave/requests', {
        ...compact({
          leaveTypeId: f.leaveTypeId,
          startDate: f.startDate,
          endDate: half ? f.startDate : f.endDate || f.startDate,
          reason: f.reason.trim(),
        }),
        halfDay: half,
        ...(half ? { halfDaySession: f.session } : {}),
      }),
    LEAVE_REFRESH,
    () => {
      setSent(true);
      setF({ ...f, startDate: '', endDate: '', reason: '' });
      onDone?.();
    },
  );
  const end = half ? f.startDate : f.endDate || f.startDate;
  const calDays =
    f.startDate && end >= f.startDate
      ? Math.round((Date.parse(end) - Date.parse(f.startDate)) / 86_400_000) + 1
      : null;
  const bal = sel ? balanceOf?.(sel.id) : undefined;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setSent(false);
        save.mutate(undefined);
      }}
    >
      {intro}
      <div className="grid gap-3 sm:grid-cols-3">
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
        <Field label="Duration">
          {(id) => (
            <Select
              id={id}
              value={f.duration}
              onChange={(e) => setF({ ...f, duration: e.target.value })}
            >
              <option value="FULL">Full day(s)</option>
              {sel?.allowHalfDay !== false ? <option value="HALF">Half day</option> : null}
            </Select>
          )}
        </Field>
        <Field label="From">
          {(id) => (
            <Input
              id={id}
              type="date"
              required
              value={f.startDate}
              onChange={(e) => setF({ ...f, startDate: e.target.value })}
            />
          )}
        </Field>
        {!half ? (
          <Field label="To">
            {(id) => (
              <Input
                id={id}
                type="date"
                min={f.startDate}
                value={f.endDate}
                onChange={(e) => setF({ ...f, endDate: e.target.value })}
              />
            )}
          </Field>
        ) : (
          <Field label="Session">
            {(id) => (
              <Select
                id={id}
                value={f.session}
                onChange={(e) => setF({ ...f, session: e.target.value })}
              >
                <option value="FIRST">First half</option>
                <option value="SECOND">Second half</option>
              </Select>
            )}
          </Field>
        )}
      </div>
      <dl className="grid gap-2 rounded-lg bg-subtle p-3 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-muted">Calendar days</dt>
          <dd className="font-semibold">
            {half ? '0.5 day' : (calDays ?? 'Shown after dates are picked')}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Charged</dt>
          <dd className="font-semibold">
            Working days only. Weekly offs and holidays are not charged.
          </dd>
        </div>
        <div>
          <dt className="text-muted">Balance now</dt>
          <dd className="font-semibold">
            {!sel
              ? 'Pick a leave type'
              : bal === null
                ? 'No cap'
                : bal === undefined
                  ? '—'
                  : `${bal} days`}
          </dd>
        </div>
      </dl>
      <Field label="Reason">
        {(id) => (
          <Textarea
            id={id}
            maxLength={1000}
            placeholder="Share a short reason for your manager"
            value={f.reason}
            onChange={(e) => setF({ ...f, reason: e.target.value })}
          />
        )}
      </Field>
      {save.error ? <Alert tone="danger">{save.error}</Alert> : null}
      {sent ? (
        <Alert tone="success">Request submitted. Your approver has been notified.</Alert>
      ) : null}
      <Button type="submit" loading={save.isPending}>
        Submit request
      </Button>
    </form>
  );
}

export function ApplyModal({
  onClose,
  balanceOf,
}: {
  onClose: () => void;
  balanceOf?: (id: string) => number | null | undefined;
}) {
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Apply for leave"
      description="Your approver is notified automatically."
    >
      <ApplyForm balanceOf={balanceOf} onDone={onClose} />
    </Modal>
  );
}

/* ------------------------------ approve / reject ------------------------------ */

/** Approve with an optional note, or reject (a comment of 3+ characters is required). */
export function useDecision() {
  const approve = useSave(
    (v: { r: LeaveRequest; comment?: string }) =>
      api.post(`/leave/requests/${v.r.id}/approve`, compact({ comment: v.comment?.trim() })),
    LEAVE_REFRESH,
  );
  const reject = useSave(
    (v: { r: LeaveRequest; comment: string }) =>
      api.post(`/leave/requests/${v.r.id}/reject`, { comment: v.comment.trim() }),
    LEAVE_REFRESH,
  );
  return { approve, reject };
}

export function RejectModal({
  r,
  name,
  onClose,
  reject,
}: {
  r: LeaveRequest;
  name: string;
  onClose: () => void;
  reject: ReturnType<typeof useDecision>['reject'];
}) {
  const [comment, setComment] = useState('');
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Reject ${name}'s leave`}
      description="Tell them why. They will see this comment."
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          reject.mutate({ r, comment }, { onSuccess: onClose });
        }}
      >
        <Field label="Comment">
          {(id) => (
            <Textarea
              id={id}
              required
              minLength={3}
              maxLength={1000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          )}
        </Field>
        {reject.error ? <Alert tone="danger">{reject.error}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={reject.isPending}>
            Reject
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function useModuleAuth() {
  const { can, active } = useAuth();
  return { can, selfId: active?.employeeId, roles: active?.roles ?? [] };
}
