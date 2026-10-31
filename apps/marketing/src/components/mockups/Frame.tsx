import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { brand } from '@/config/brand';

/** Browser-style window used by every interface preview. Content is sample data, never real customers. */
export function WindowFrame({
  title,
  children,
  className,
  caption = true,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  caption?: boolean;
}) {
  return (
    <figure className={cn('w-full', className)}>
      <div
        role="img"
        aria-label={`Illustrative ${title} interface preview`}
        className="overflow-hidden rounded-2xl border border-border bg-background shadow-hero"
      >
        <div className="flex items-center gap-2 border-b border-border bg-surface px-4 py-2.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-danger/70" />
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-warn/70" />
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-success/70" />
          <span className="ml-3 truncate rounded-md bg-background px-3 py-0.5 text-xs text-muted">
            {brand.name.toLowerCase()}.app / {title.toLowerCase().replace(/\s+/g, '-')}
          </span>
        </div>
        <div aria-hidden className="p-4 sm:p-5">
          {children}
        </div>
      </div>
      {caption ? (
        <figcaption className="mt-2 text-center text-xs text-muted">
          Illustrative interface with sample data
        </figcaption>
      ) : null}
    </figure>
  );
}

export function Stat({
  label,
  value,
  tone = 'primary',
  sub,
}: {
  label: string;
  value: string;
  tone?: 'primary' | 'ok' | 'danger' | 'warn';
  sub?: string;
}) {
  const c = { primary: 'text-link', ok: 'text-ok', danger: 'text-danger', warn: 'text-warn' }[tone];
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <p className="text-[11px] font-medium text-muted">{label}</p>
      <p className={cn('mt-1 text-xl font-bold tabular-nums', c)}>{value}</p>
      {sub ? <p className="text-[10px] text-muted">{sub}</p> : null}
    </div>
  );
}

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'ok' | 'danger' | 'warn' | 'primary';
}) {
  const c = {
    neutral: 'bg-surface-2 text-muted',
    ok: 'bg-success-bg text-success',
    danger: 'bg-danger-bg text-danger',
    warn: 'bg-warn-bg text-warn',
    primary: 'bg-primary-soft text-link',
  }[tone];
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', c)}>{children}</span>
  );
}

const AVATAR_BG = ['bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-5', 'bg-chart-6'];

export function Avatar({ name }: { name: string }) {
  const pick = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_BG.length;
  return (
    <span
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-slate-900 ${AVATAR_BG[pick]}`}
    >
      {name
        .split(' ')
        .map((s) => s[0])
        .join('')
        .slice(0, 2)}
    </span>
  );
}
