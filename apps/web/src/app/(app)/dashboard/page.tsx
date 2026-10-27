'use client';
import { useQuery } from '@tanstack/react-query';
import {
  AlarmClock,
  ArrowRight,
  CalendarOff,
  CircleSlash,
  Palmtree,
  UserCheck,
  UserMinus,
  UserX,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '@/components/auth';
import {
  Alert,
  Card,
  CardTitle,
  PageHeader,
  Skeleton,
  Table,
  Td,
  Th,
} from '@/components/ui/display';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import type { Dashboard } from '@/lib/types';
import { formatDate } from '@/lib/utils';

export default function DashboardPage() {
  const { active } = useAuth();
  const q = useQuery({
    queryKey: ['dashboard', active?.tenantId],
    queryFn: async () => (await api.get<Dashboard>('/reports/dashboard')).data,
    refetchInterval: 60_000,
  });

  if (q.isPending)
    return (
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  if (q.isError) return <Alert tone="danger">{userMessage(q.error)}</Alert>;
  const d = q.data;
  const t = d.today;
  type Tint = 'teal' | 'sky' | 'amber' | 'rose' | 'violet' | 'slate';
  const stats: { label: string; value: number; hint?: string; icon: LucideIcon; tint: Tint }[] = [
    {
      label: 'Present',
      value: t.present + t.halfDay,
      hint: t.halfDay ? `${t.halfDay} half day` : undefined,
      icon: UserCheck,
      tint: 'teal',
    },
    { label: 'Working now', value: t.workingNow, icon: AlarmClock, tint: 'sky' },
    { label: 'Not checked in yet', value: t.notYetIn, icon: UserMinus, tint: 'slate' },
    { label: 'Late today', value: t.lateToday, icon: AlarmClock, tint: 'amber' },
    { label: 'Absent', value: t.absent, icon: UserX, tint: 'rose' },
    { label: 'On leave', value: t.onLeave, icon: Palmtree, tint: 'violet' },
    {
      label: 'Holiday / weekly off',
      value: t.holiday + t.weeklyOff,
      icon: CalendarOff,
      tint: 'sky',
    },
    { label: 'No shift assigned', value: t.unscheduled, icon: CircleSlash, tint: 'slate' },
  ];
  const tints: Record<Tint, string> = {
    teal: 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
    sky: 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    rose: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
    violet: 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
    slate: 'bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300',
  };
  const chartData = d.trend.map((r) => ({ ...r, label: r.date.slice(5) }));

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${formatDate(d.workDate)} · ${d.timezone} · ${d.headcount} ${d.scope === 'TEAM' ? 'people in your team' : 'employees'}`}
      />
      {d.pending && (d.pending.corrections > 0 || d.pending.exceptions > 0) ? (
        <div className="mb-6">
          <Alert tone="warn">
            <Link href="/approvals" className="font-semibold underline">
              {d.pending.corrections} correction{d.pending.corrections === 1 ? '' : 's'} and{' '}
              {d.pending.exceptions} location approval{d.pending.exceptions === 1 ? '' : 's'}{' '}
              waiting for review
            </Link>
          </Alert>
        </div>
      ) : null}

      <section aria-label="Today" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {stats.map((s, i) => (
          <Card
            key={s.label}
            className="animate-rise flex items-start justify-between gap-2 !p-4 transition sm:gap-3 sm:!p-5 hover:-translate-y-0.5 hover:shadow-pop"
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <div>
              <CardTitle>{s.label}</CardTitle>
              <p className="mt-1.5 text-2xl font-bold sm:mt-2 sm:text-3xl tabular-nums tracking-tight">
                {s.value}
              </p>
              <p className="mt-1 min-h-4 text-xs text-muted">{s.hint ?? ''}</p>
            </div>
            <span
              aria-hidden
              className={`flex h-9 w-9 shrink-0 sm:h-11 sm:w-11 items-center justify-center rounded-xl ${tints[s.tint]}`}
            >
              <s.icon className="h-5 w-5" />
            </span>
          </Card>
        ))}
      </section>

      <Card className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Last 14 days</CardTitle>
            <p className="text-xs text-muted">Daily attendance across the company</p>
          </div>
          <Link
            href="/reports"
            className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
          >
            Open reports <ArrowRight aria-hidden className="h-4 w-4" />
          </Link>
        </div>
        <div
          className="mt-3 h-72"
          role="img"
          aria-label="Stacked bars of present, half day and absent employees for each of the last 14 days"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ left: -16, right: 8 }} barCategoryGap="28%">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'var(--muted)', fontSize: 12 }}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'var(--muted)', fontSize: 12 }}
              />
              <Tooltip
                cursor={{ fill: 'var(--subtle)' }}
                contentStyle={{
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  boxShadow: 'var(--shadow-md)',
                  color: 'var(--foreground)',
                }}
              />
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 12, color: 'var(--muted)' }}
              />
              <Bar dataKey="present" name="Present" stackId="a" fill="var(--chart-1)" />
              <Bar dataKey="halfDay" name="Half day" stackId="a" fill="var(--chart-2)" />
              <Bar
                dataKey="absent"
                name="Absent"
                stackId="a"
                fill="var(--chart-3)"
                radius={[6, 6, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-medium text-muted hover:text-foreground">
            View as table
          </summary>
          <div className="mt-2">
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Present</Th>
                  <Th>Half day</Th>
                  <Th>Absent</Th>
                  <Th>Late</Th>
                </tr>
              </thead>
              <tbody>
                {d.trend.map((r) => (
                  <tr key={r.date}>
                    <Td>{formatDate(r.date)}</Td>
                    <Td>{r.present}</Td>
                    <Td>{r.halfDay}</Td>
                    <Td>{r.absent}</Td>
                    <Td>{r.late}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </details>
        <p className="mt-2 text-xs text-muted">
          Past days with no punches count as absent only when the person had a shift that day.
        </p>
      </Card>
    </>
  );
}
