'use client';
import type { ReactNode } from 'react';
import { useAuth } from '@/components/auth';
import { Card } from '@/components/ui/display';
import { cn } from '@/lib/utils';

const RANK: [string, string, string][] = [
  ['COMPANY_OWNER', 'Owner', 'bg-accent text-primary'],
  ['HR_ADMIN', 'HR', 'bg-warn-bg text-warn'],
  ['PAYROLL_ADMIN', 'Payroll', 'bg-warn-bg text-warn'],
  ['MANAGER', 'Manager', 'bg-info-bg text-info'],
  ['EMPLOYEE', 'Employee', 'bg-info-bg text-info'],
];

/** The person's highest role, with what it lets them do on this page. */
export function RoleChip({ scope }: { scope?: string }) {
  const { active } = useAuth();
  const hit = RANK.find(([r]) => active?.roles.includes(r));
  if (!hit) return null;
  return (
    <span
      className={cn('inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold', hit[2])}
    >
      {hit[1]}
      {scope ? ` · ${scope}` : ''}
    </span>
  );
}

export interface Stat {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'neutral' | 'warn' | 'danger' | 'success';
}

/** A row of headline numbers. Keep to four to six. */
export function StatStrip({ stats }: { stats: Stat[] }) {
  const color = { neutral: '', warn: 'text-warn', danger: 'text-danger', success: 'text-success' };
  return (
    <section
      aria-label="Summary"
      className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]"
    >
      {stats.map((s) => (
        <Card key={s.label} className="p-4">
          <p className="text-xs font-medium text-muted">{s.label}</p>
          <p className={cn('mt-1 text-2xl font-bold tabular-nums', color[s.tone ?? 'neutral'])}>
            {s.value}
          </p>
          {s.sub ? <p className="mt-1 text-[11px] text-muted">{s.sub}</p> : null}
        </Card>
      ))}
    </section>
  );
}

/** Plain-language help that stays out of the way until opened. */
export function Guide({
  title = 'How this page works',
  points,
}: {
  title?: string;
  points: string[];
}) {
  return (
    <details className="group mb-5 rounded-xl border border-border bg-card px-4 py-3 text-sm">
      <summary className="cursor-pointer font-semibold text-primary">{title}</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
        {points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </details>
  );
}

/** Page heading: role chip, title, a one-line purpose, actions, then optional stats and help. */
export function PageTop({
  title,
  description,
  scope,
  actions,
  stats,
  guide,
}: {
  title: string;
  description?: string;
  scope?: string;
  actions?: ReactNode;
  stats?: Stat[];
  guide?: string[];
}) {
  return (
    <>
      <div className="animate-rise mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1.5">
          <RoleChip scope={scope} />
          <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">{title}</h1>
          {description ? <p className="max-w-2xl text-sm text-muted">{description}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">{actions}</div>
      </div>
      {stats ? <StatStrip stats={stats} /> : null}
      {guide ? <Guide points={guide} /> : null}
    </>
  );
}
