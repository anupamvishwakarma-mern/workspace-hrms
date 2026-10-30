'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useAuth } from '@/components/auth';
import { Card } from '@/components/ui/display';
import { cn } from '@/lib/utils';

export type ViewKey = 'employee' | 'manager' | 'hr' | 'owner';
export const VIEW_LABEL: Record<ViewKey, string> = {
  employee: 'Employee',
  manager: 'Manager',
  hr: 'HR',
  owner: 'Owner',
};

const PILL: Record<ViewKey, { text: string; cls: string }> = {
  employee: { text: 'Employee · self-service', cls: 'bg-info-bg text-info' },
  manager: { text: 'Manager · approve and plan', cls: 'bg-info-bg text-info' },
  hr: { text: 'HR · manage and approve', cls: 'bg-warn-bg text-warn' },
  owner: { text: 'Owner · view and insights', cls: 'bg-accent text-primary' },
};
export const RolePill = ({ view }: { view: ViewKey }) => (
  <span
    className={cn(
      'inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
      PILL[view].cls,
    )}
  >
    {PILL[view].text}
  </span>
);

/** Switch between the views your role allows. Hidden when there is only one. */
export function ViewSwitcher({
  views,
  value,
  onChange,
}: {
  views: ViewKey[];
  value: ViewKey;
  onChange: (v: ViewKey) => void;
}) {
  if (views.length < 2) return null;
  return (
    <div
      role="group"
      aria-label="Switch view"
      className="inline-flex rounded-lg border border-border bg-card p-0.5 shadow-sm"
    >
      {views.map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            'rounded-md px-3.5 py-1.5 text-sm font-semibold transition',
            value === v ? 'bg-foreground text-card' : 'text-muted hover:text-foreground',
          )}
        >
          {VIEW_LABEL[v]}
        </button>
      ))}
    </div>
  );
}

/** Dashboard | Attendance | Leave toggle, shown only to people who can open more than one. */
export function ModuleTabs({ current }: { current: 'dashboard' | 'attendance' | 'leave' }) {
  const { can } = useAuth();
  const att = can('attendance:read:self', 'attendance:read:all', 'attendance:read:team');
  const leave = can('leave:apply', 'leave:read:all', 'leave:review:team');
  const items = [
    ['dashboard', '/dashboard', 'Dashboard', true],
    ['attendance', '/attendance', 'Attendance', att],
    ['leave', '/leave', 'Leave', leave],
  ] as const;
  const shown = items.filter((i) => i[3]);
  if (shown.length < 2) return null;
  return (
    <nav
      aria-label="Module"
      className="inline-flex rounded-lg border border-border bg-card p-0.5 shadow-sm"
    >
      {shown.map(([k, href, text]) => (
        <Link
          key={k}
          href={href}
          aria-current={current === k ? 'page' : undefined}
          className={cn(
            'rounded-md px-3.5 py-1.5 text-sm font-semibold transition',
            current === k ? 'bg-foreground text-card' : 'text-muted hover:text-foreground',
          )}
        >
          {text}
        </Link>
      ))}
    </nav>
  );
}

/** Page header shared by the role views. */
export function ViewHeader({
  view,
  switcher,
  crumb,
  title,
  sub,
  actions,
  module = 'attendance',
}: {
  module?: 'dashboard' | 'attendance' | 'leave';
  view: ViewKey;
  switcher: ReactNode;
  crumb: string;
  title: string;
  sub?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="animate-rise space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <ModuleTabs current={module} />
          <RolePill view={view} />
        </div>
        {switcher}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-muted">{crumb}</p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">{title}</h1>
          {sub ? <p className="mt-1 text-sm text-muted">{sub}</p> : null}
        </div>
        <div className="flex flex-wrap items-end gap-2">{actions}</div>
      </div>
    </div>
  );
}

export function Kpi({
  label,
  value,
  sub,
  children,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {children}
      {sub ? <p className="mt-1 text-[11px] text-muted">{sub}</p> : null}
    </Card>
  );
}

/** Change against the previous month. `lowerIsBetter` flips what counts as an improvement. */
export function Delta({
  cur,
  prev,
  unit,
  lowerIsBetter = false,
  neutral = false,
  percent = false,
}: {
  cur: number | null;
  prev: number | null;
  unit: string;
  lowerIsBetter?: boolean;
  neutral?: boolean;
  percent?: boolean;
}) {
  if (cur === null || prev === null)
    return <span className="text-[11px] text-muted">No earlier month to compare</span>;
  const diff = percent ? (prev === 0 ? 0 : ((cur - prev) / prev) * 100) : cur - prev;
  const rounded = Math.round(Math.abs(diff) * 10) / 10;
  if (rounded === 0) return <span className="text-[11px] text-muted">No change vs last month</span>;
  const up = diff > 0;
  const good = lowerIsBetter ? !up : up;
  const tone = neutral
    ? 'bg-warn-bg text-warn'
    : good
      ? 'bg-success-bg text-success'
      : 'bg-danger-bg text-danger';
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
      <span className={cn('rounded-full px-2 py-0.5 font-semibold', tone)}>
        {up ? '▲' : '▼'} {rounded}
        {percent ? '%' : ` ${unit}`} ·{' '}
        {neutral ? (up ? 'Higher' : 'Lower') : good ? 'Better' : 'Worse'}
      </span>
      vs last month
    </span>
  );
}

/** A labelled horizontal meter. `value` and `max` share a unit; the label on the right is free text. */
export function Meter({
  label,
  value,
  max,
  text,
  className,
}: {
  label: string;
  value: number;
  max: number;
  text: string;
  className?: string;
}) {
  const w = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={cn('flex items-center gap-3 text-sm', className)}>
      <span className="w-24 shrink-0 font-medium">{label}</span>
      <div
        className="h-2.5 flex-1 overflow-hidden rounded-full bg-subtle"
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(w)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${w}%` }} />
      </div>
      <span className="w-14 shrink-0 text-right tabular-nums">{text}</span>
    </div>
  );
}

export const fmtPct = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `${n}%`;
export const fmtHours = (min: number | null | undefined) =>
  min === null || min === undefined
    ? '—'
    : `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m`;

export const MONTH_OPTIONS = (current: string, n = 12) => {
  const [y, m] = current.split('-').map(Number) as [number, number];
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return d.toISOString().slice(0, 7);
  });
};
