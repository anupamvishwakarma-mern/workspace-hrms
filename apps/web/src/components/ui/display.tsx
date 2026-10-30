import { AlertTriangle, CheckCircle2, Info, Inbox, XCircle, type LucideIcon } from 'lucide-react';
import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Card = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('rounded-2xl border border-border bg-card p-5 shadow-card', className)}
    {...p}
  />
);
export const CardTitle = ({ className, ...p }: HTMLAttributes<HTMLHeadingElement>) => (
  <h2 className={cn('text-sm font-semibold text-muted', className)} {...p} />
);

type Tone = 'success' | 'warn' | 'danger' | 'info' | 'neutral';
const tones: Record<Tone, string> = {
  success: 'bg-success-bg text-success',
  warn: 'bg-warn-bg text-warn',
  danger: 'bg-danger-bg text-danger',
  info: 'bg-info-bg text-info',
  neutral: 'bg-subtle text-muted',
};
const dots: Record<Tone, string> = {
  success: 'bg-success',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
  neutral: 'bg-muted',
};
export const Badge = ({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold',
      tones[tone],
    )}
  >
    <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', dots[tone])} />
    {children}
  </span>
);

export const statusTone = (s?: string): Tone =>
  (
    ({
      PRESENT: 'success',
      APPROVED: 'success',
      ACTIVE: 'success',
      HALF_DAY: 'warn',
      PENDING: 'warn',
      INCOMPLETE: 'warn',
      NOTICE_PERIOD: 'warn',
      ABSENT: 'danger',
      REJECTED: 'danger',
      TERMINATED: 'danger',
      RESIGNED: 'neutral',
      RETIRED: 'neutral',
      INACTIVE: 'neutral',
    }) as Record<string, Tone>
  )[s ?? ''] ?? 'neutral';

const alertIcon: Record<Exclude<Tone, 'neutral'>, LucideIcon> = {
  success: CheckCircle2,
  warn: AlertTriangle,
  danger: XCircle,
  info: Info,
};
export function Alert({
  tone = 'info',
  children,
}: {
  tone?: Exclude<Tone, 'neutral'>;
  children: ReactNode;
}) {
  const Icon = alertIcon[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm',
        tones[tone],
        'border-current/20',
      )}
    >
      <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export const Table = ({ className, ...p }: HTMLAttributes<HTMLTableElement>) => (
  <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-card">
    <table className={cn('w-full text-left text-sm', className)} {...p} />
  </div>
);
export const Th = ({ className, ...p }: ThHTMLAttributes<HTMLTableCellElement>) => (
  <th
    scope="col"
    className={cn(
      'whitespace-nowrap border-b border-border bg-subtle/70 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted first:rounded-tl-2xl last:rounded-tr-2xl',
      className,
    )}
    {...p}
  />
);
export const Td = ({ className, ...p }: TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn('border-b border-border/70 px-4 py-3 align-middle', className)} {...p} />
);

export const Skeleton = ({ className }: { className?: string }) => (
  <div aria-hidden className={cn('animate-pulse rounded-xl bg-subtle', className)} />
);

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="animate-rise mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-col items-center gap-2 px-3 py-12 text-center">
    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-subtle text-muted">
      <Inbox aria-hidden className="h-5 w-5" />
    </span>
    <p className="text-sm text-muted">{children}</p>
  </div>
);

/** Initials in a soft coloured circle; the colour is derived from the name so it is stable. */
export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '?';
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const dim = { sm: 'h-7 w-7 text-[10px]', md: 'h-9 w-9 text-xs', lg: 'h-11 w-11 text-sm' }[size];
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold',
        dim,
      )}
      style={{
        background: `hsl(${hue} 55% 92%)`,
        color: `hsl(${hue} 55% 28%)`,
      }}
    >
      {initials}
    </span>
  );
}

/** Segmented tab control. Keeps role="tablist"/"tab" and aria-selected for assistive tech and tests. */
export function TabBar<T extends string>({
  tabs,
  value,
  onChange,
  label = 'Sections',
  className = 'mb-4',
}: {
  tabs: readonly { key: T; label: string }[];
  value: T;
  onChange: (k: T) => void;
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        'inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-subtle p-1',
        className,
      )}
    >
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            'whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium transition',
            value === t.key ? 'bg-card text-primary shadow-sm' : 'text-muted hover:text-foreground',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
