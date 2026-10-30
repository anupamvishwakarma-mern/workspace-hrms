'use client';
import { useMemo, useState } from 'react';
import { PageTop } from '@/components/page-top';
import { Alert, Avatar, Badge, Empty, Skeleton, TabBar } from '@/components/ui/display';
import { Users } from 'lucide-react';
import { BreakdownPanel } from '../dashboard/charts';
import { Input } from '@/components/ui/form';
import { useOne } from '@/hooks/api';
import { userMessage } from '@/lib/errors';
import { useI18n, type Key } from '@/lib/i18n';
import type { TeamMember, TeamToday } from '@/lib/types';

const ORDER: TeamMember['status'][] = ['WORKING', 'ON_BREAK', 'CHECKED_OUT', 'ON_LEAVE', 'NOT_IN'];
const TONE = {
  WORKING: 'success',
  ON_BREAK: 'warn',
  CHECKED_OUT: 'neutral',
  ON_LEAVE: 'info',
  NOT_IN: 'danger',
} as const;

export default function TeamPage() {
  const { t } = useI18n();
  const q = useOne<TeamToday>('team', '/team/today');
  const [filter, setFilter] = useState<TeamMember['status'] | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const data = q.data?.data;
  const members = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.members ?? [])
      .filter((m) => filter === 'ALL' || m.status === filter)
      .filter((m) => !needle || m.name.toLowerCase().includes(needle))
      .sort(
        (a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.name.localeCompare(b.name),
      );
  }, [data, filter, search]);
  return (
    <>
      <PageTop
        title={t('team.title')}
        description={t('team.desc')}
        scope="your team today"
        stats={
          data
            ? [
                { label: 'People', value: data.members.length },
                {
                  label: 'At work',
                  value: (data.counts.WORKING ?? 0) + (data.counts.ON_BREAK ?? 0),
                  tone: 'success',
                },
                { label: 'On leave', value: data.counts.ON_LEAVE ?? 0 },
                {
                  label: 'Not in yet',
                  value: data.counts.NOT_IN ?? 0,
                  tone: (data.counts.NOT_IN ?? 0) > 0 ? 'warn' : 'neutral',
                },
              ]
            : undefined
        }
        guide={[
          'Shows who is working, on a break, checked out, on leave or not in yet, right now.',
          'Managers see their direct reports. HR and owners see everyone.',
          'Only status is shown here. Locations, photos and punch times stay private.',
        ]}
      />
      {data ? (
        <BreakdownPanel
          title="Team status today"
          icon={Users}
          total={data.members.length}
          unit="People"
          data={ORDER.map((s) => ({
            name: t(`team.${s}` as Key),
            value: data.counts[s] ?? 0,
          }))}
          empty="No team members to show."
        />
      ) : null}
      {q.isError ? <Alert tone="danger">{userMessage(q.error)}</Alert> : null}
      {!data ? (
        q.isError ? null : (
          <Skeleton className="h-40" />
        )
      ) : (
        <>
          <TabBar
            label="Status filter"
            value={filter}
            onChange={setFilter}
            tabs={[
              { key: 'ALL', label: `${t('team.all')} · ${data.members.length}` },
              ...ORDER.map((s) => ({
                key: s,
                label: `${t(`team.${s}` as Key)} · ${data.counts[s] ?? 0}`,
              })),
            ]}
          />
          <div className="mb-4 max-w-xs">
            <Input
              aria-label={t('team.search')}
              placeholder={t('team.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {members.length === 0 ? (
            <Empty>No team members to show.</Empty>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {members.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-card"
                >
                  <Avatar name={m.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{m.name}</p>
                    <p className="truncate text-xs text-muted">
                      {[m.designation, m.department].filter(Boolean).join(' · ') || m.employeeCode}
                    </p>
                  </div>
                  <Badge tone={TONE[m.status]}>{t(`team.${m.status}` as Key)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
