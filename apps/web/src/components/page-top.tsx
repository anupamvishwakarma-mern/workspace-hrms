'use client';
import {
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock,
  Eye,
  FileText,
  ShieldCheck,
  Users,
  Wallet,
  Workflow,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useAuth } from '@/components/auth';
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

export type StatColor = 'teal' | 'green' | 'amber' | 'rose' | 'indigo' | 'sky' | 'slate';

export interface Stat {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'neutral' | 'warn' | 'danger' | 'success';
  /** Defaults from the label (people, money, time, documents…). */
  icon?: LucideIcon;
  /** Defaults from the tone, then cycles through the palette. */
  color?: StatColor;
  /** Makes the card a link and shows the chevron. */
  href?: string;
}

const COLOR_VAR: Record<StatColor, string> = {
  teal: 'var(--chart-1)',
  green: 'var(--success)',
  amber: 'var(--chart-2)',
  rose: 'var(--chart-3)',
  indigo: 'var(--chart-5)',
  sky: 'var(--chart-6)',
  slate: 'var(--chart-4)',
};
const CYCLE: StatColor[] = ['teal', 'indigo', 'sky', 'amber', 'rose', 'slate'];
const TONE_COLOR = { warn: 'amber', danger: 'rose', success: 'green' } as const;

const ICON_HINTS: [RegExp, LucideIcon][] = [
  [/pending|waiting|open|queue|review/i, Clock],
  [/notice|expir|due|overdue/i, Eye],
  [/leave|holiday|absent|off\b/i, CalendarDays],
  [/late|hour|time|shift|overtime/i, Clock],
  [/pay|salary|net|gross|cost|amount|deduction|earning|₹|money/i, Wallet],
  [/letter|template|document|policy|handbook|file|report|log|audit|event/i, FileText],
  [/depart|location|office|branch|site|org|structure/i, Building2],
  [/role|permission|access|admin|head|manager|approver|owner/i, ShieldCheck],
  [/approved|active|present|complete|done|issued|published|enabled|on time/i, CheckCircle2],
  [/reject|declin|denied|fail|inactive|revoked|blocked|exception/i, XCircle],
  [/workflow|step|rule|stage/i, Workflow],
  [/employ|people|team|staff|member|person|headcount|direct|reports|user/i, Users],
];

function iconFor(s: Stat, i: number): LucideIcon {
  if (s.icon) return s.icon;
  const hit = ICON_HINTS.find(([re]) => re.test(s.label));
  if (hit) return hit[1];
  return [Users, BarChart3, FileText, CalendarDays][i % 4]!;
}

/** A row of headline numbers: tinted card, icon in a soft circle, big coloured number, chevron when it links. */
export function StatStrip({ stats }: { stats: Stat[] }) {
  return (
    <section
      aria-label="Summary"
      className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]"
    >
      {stats.map((s, i) => {
        const key: StatColor =
          s.color ?? (s.tone && s.tone !== 'neutral' ? TONE_COLOR[s.tone] : CYCLE[i % CYCLE.length]!);
        const c = COLOR_VAR[key];
        const Icon = iconFor(s, i);
        const style = {
          background: `color-mix(in srgb, ${c} 9%, var(--card))`,
          borderColor: `color-mix(in srgb, ${c} 28%, var(--border))`,
        };
        const body = (
          <>
            <span
              aria-hidden
              className="grid size-11 shrink-0 place-items-center rounded-full"
              style={{ background: `color-mix(in srgb, ${c} 20%, transparent)`, color: c }}
            >
              <Icon className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-muted">{s.label}</span>
              <span
                className="block text-2xl font-bold leading-tight tabular-nums"
                style={{ color: c }}
              >
                {s.value}
              </span>
              {s.sub ? <span className="block truncate text-[11px] text-muted">{s.sub}</span> : null}
            </span>
            {s.href ? <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" /> : null}
          </>
        );
        const cls =
          'flex items-center gap-3 rounded-2xl border p-4 shadow-sm transition-shadow';
        return s.href ? (
          <Link
            key={s.label}
            href={s.href}
            className={cn(cls, 'hover:shadow-md focus-visible:outline-2 focus-visible:outline-primary')}
            style={style}
          >
            {body}
          </Link>
        ) : (
          <div key={s.label} className={cls} style={style}>
            {body}
          </div>
        );
      })}
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
