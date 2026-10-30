'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardTitle } from '@/components/ui/display';
import { cn } from '@/lib/utils';

export const PALETTE = [
  'var(--chart-1)',
  'var(--chart-5)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-6)',
  'var(--chart-4)',
];
const tip = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  boxShadow: 'var(--shadow-md)',
  color: 'var(--foreground)',
  fontSize: 12,
};
const tick = { fill: 'var(--muted)', fontSize: 12 };

export interface Slice {
  name: string;
  value: number;
  color?: string;
}

/** A titled card, the building block of every dashboard. */
export function Panel({
  title,
  sub,
  aside,
  className,
  children,
}: {
  title: string;
  sub?: ReactNode;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn('space-y-3 p-4', className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>{title}</CardTitle>
          {sub ? <p className="mt-0.5 text-xs text-muted">{sub}</p> : null}
        </div>
        {aside ? <div className="text-xs text-muted">{aside}</div> : null}
      </div>
      {children}
    </Card>
  );
}

/**
 * Donut (or a full pie with `pie`). The legend beside it carries every value, so the chart is
 * never the only way to read a number.
 */
export function DonutChart({
  data,
  center,
  centerSub,
  pie = false,
  height = 168,
  empty = 'Nothing to show yet.',
}: {
  data: Slice[];
  center?: ReactNode;
  centerSub?: string;
  pie?: boolean;
  height?: number;
  empty?: string;
}) {
  const rows = data.map((d, i) => ({ ...d, color: d.color ?? PALETTE[i % PALETTE.length]! }));
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (total === 0) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div
        className="relative shrink-0"
        style={{ width: height, height }}
        role="img"
        aria-label={rows.map((r) => `${r.name} ${r.value}`).join(', ')}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={rows}
              dataKey="value"
              nameKey="name"
              innerRadius={pie ? 0 : '62%'}
              outerRadius="100%"
              paddingAngle={pie ? 1 : 2}
              stroke="var(--card)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {rows.map((r) => (
                <Cell key={r.name} fill={r.color} />
              ))}
            </Pie>
            <Tooltip contentStyle={tip} />
          </PieChart>
        </ResponsiveContainer>
        {!pie && center !== undefined ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-xl font-bold tabular-nums">{center}</span>
            {centerSub ? <span className="text-[10px] text-muted">{centerSub}</span> : null}
          </div>
        ) : null}
      </div>
      <ul className="min-w-40 flex-1 space-y-1.5 text-sm">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: r.color }}
            />
            <span className="flex-1 truncate">{r.name}</span>
            <span className="font-semibold tabular-nums">{r.value}</span>
            <span className="w-10 text-right text-xs tabular-nums text-muted">
              {Math.round((r.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Single-series columns with the value above each bar and an optional dashed target line. */
export function Columns({
  data,
  height = 200,
  target,
  targetLabel,
  format = (n: number) => String(n),
  min,
  label,
}: {
  data: { label: string; value: number }[];
  height?: number;
  target?: number;
  targetLabel?: string;
  format?: (n: number) => string;
  min?: number;
  label: string;
}) {
  return (
    <div style={{ height }} role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 18, left: -18, right: 8 }} barCategoryGap="30%">
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={tick} />
          <YAxis
            hide={min !== undefined}
            tickLine={false}
            axisLine={false}
            tick={tick}
            allowDecimals={false}
            domain={min !== undefined ? [min, 'auto'] : undefined}
          />
          <Tooltip
            cursor={{ fill: 'var(--subtle)' }}
            contentStyle={tip}
            formatter={(v) => format(Number(v))}
          />
          {target !== undefined ? (
            <ReferenceLine
              y={target}
              stroke="var(--muted)"
              strokeDasharray="4 4"
              label={
                targetLabel
                  ? {
                      value: targetLabel,
                      fill: 'var(--muted)',
                      fontSize: 11,
                      position: 'insideTopRight',
                    }
                  : undefined
              }
            />
          ) : null}
          <Bar
            dataKey="value"
            fill="var(--chart-5)"
            radius={[6, 6, 0, 0]}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="value"
              position="top"
              formatter={(v) => format(Number(v))}
              style={{ fill: 'var(--foreground)', fontSize: 11 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Stacked columns for a handful of related series (e.g. present / half day / absent per day). */
export function StackedColumns({
  data,
  series,
  height = 240,
  label,
}: {
  data: Record<string, string | number>[];
  series: { key: string; name: string; color: string }[];
  height?: number;
  label: string;
}) {
  return (
    <div style={{ height }} role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: -18, right: 8 }} barCategoryGap="28%">
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={tick} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={tick} />
          <Tooltip cursor={{ fill: 'var(--subtle)' }} contentStyle={tip} />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12, color: 'var(--muted)' }}
          />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name}
              stackId="a"
              fill={s.color}
              isAnimationActive={false}
              radius={i === series.length - 1 ? [6, 6, 0, 0] : 0}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Labelled horizontal bars sized against the largest value. */
export function HBars({
  rows,
  color = 'var(--chart-5)',
  empty = 'Nothing to show yet.',
}: {
  rows: { name: string; value: number; text?: string }[];
  color?: string;
  empty?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="py-4 text-center text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.name} className="flex items-center gap-3 text-sm">
          <span className="w-28 shrink-0 truncate font-medium">{r.name}</span>
          <span
            className="h-2.5 flex-1 overflow-hidden rounded-full bg-subtle"
            role="progressbar"
            aria-label={r.name}
            aria-valuenow={r.value}
            aria-valuemin={0}
            aria-valuemax={max}
          >
            <span
              className="block h-full rounded-full"
              style={{ width: `${(r.value / max) * 100}%`, background: color }}
            />
          </span>
          <span className="w-12 shrink-0 text-right tabular-nums">{r.text ?? r.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** A label / value row, used for the small "overview" lists. */
export const StatRow = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0">
    <span className="text-muted">{label}</span>
    <span className="font-semibold tabular-nums">{value}</span>
  </div>
);

/** Big-number "needs your action" tile that links to where the work is done. */
export function ActionTile({
  value,
  title,
  sub,
  chip,
  href,
  tone = 'neutral',
}: {
  value: number | string;
  title: string;
  sub?: string;
  chip?: string;
  href: string;
  tone?: 'neutral' | 'danger' | 'warn' | 'info';
}) {
  const chipCls = {
    neutral: 'bg-subtle text-muted',
    danger: 'bg-danger-bg text-danger',
    warn: 'bg-warn-bg text-warn',
    info: 'bg-info-bg text-info',
  }[tone];
  return (
    <Link
      href={href}
      className="block rounded-xl border border-border bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-3xl font-bold tabular-nums">{value}</span>
        {chip ? (
          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', chipCls)}>
            {chip}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-sm font-semibold">{title}</p>
      {sub ? <p className="text-xs text-muted">{sub}</p> : null}
    </Link>
  );
}
