import { useRouter } from 'expo-router';
import { DateTime } from 'luxon';
import { Text, View } from 'react-native';
import { useAuth } from '@/auth/AuthProvider';
import { Avatar, Badge, Banner, Body, PageHeader, Screen, toneForStatus } from '@/components/ui';
import { ActionTile, Bars, KpiGrid, Line, Panel, SectionTitle, pct } from '@/components/charts';
import { useDashboardData, useReviewLeave } from '@/hooks/insights';
import { useTeamToday } from '@/hooks/queries';
import type { TeamMember } from '@/lib/schemas';
import { useTheme } from '@/theme';
import { Open } from './OwnerHome';
import {
  WINDOW_DAYS,
  daysSince,
  greetingDate,
  personName,
  rangeText,
  useFirstName,
} from './shared';

const STATUS: Record<
  TeamMember['status'],
  { text: string; tone: 'success' | 'warn' | 'neutral' | 'info' }
> = {
  WORKING: { text: 'Present', tone: 'success' },
  ON_BREAK: { text: 'On break', tone: 'warn' },
  CHECKED_OUT: { text: 'Checked out', tone: 'neutral' },
  ON_LEAVE: { text: 'On leave', tone: 'info' },
  NOT_IN: { text: 'Not in yet', tone: 'neutral' },
};
const COVER = 0.3;

/** Manager home: decisions first, then who is in and who is away. */
export default function ManagerHome() {
  const t = useTheme();
  const router = useRouter();
  const { active } = useAuth();
  const name = useFirstName();
  const team = useTeamToday(true);
  const dash = useDashboardData();
  const today = DateTime.now().toISODate()!;
  const pendingQ = useReviewLeave({ status: 'PENDING' });
  const aheadQ = useReviewLeave({
    from: today,
    to: DateTime.now().plus({ days: 60 }).toISODate()!,
  });
  const members = team.data?.members ?? [];
  const size = members.length;
  const pending = (pendingQ.data ?? []).filter((r) => r.employeeId !== active?.employeeId);
  const oldest = Math.max(0, ...pending.map((r) => daysSince(r.createdAt)));
  const ahead = (aheadQ.data ?? [])
    .filter((r) => r.status === 'APPROVED' || r.status === 'PENDING')
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  // The first day when too many of the team are away (counting approved and pending).
  const off = new Map<string, Set<string>>();
  for (const r of ahead)
    for (
      let d = r.startDate.slice(0, 10);
      d <= r.endDate.slice(0, 10);
      d = DateTime.fromISO(d).plus({ days: 1 }).toISODate()!
    ) {
      if (!off.has(d)) off.set(d, new Set());
      off.get(d)!.add(r.employeeId);
    }
  const crowded = size
    ? [...off.entries()]
        .filter(([, s]) => s.size / size >= COVER)
        .sort(([a], [b]) => a.localeCompare(b))[0]
    : undefined;
  const tr = dash.data?.trend ?? [];
  const totals = tr.reduce(
    (s, r) => ({
      p: s.p + r.present + r.halfDay * 0.5,
      n: s.n + r.present + r.halfDay + r.absent,
      a: s.a + r.absent,
      l: s.l + r.late,
    }),
    { p: 0, n: 0, a: 0, l: 0 },
  );
  const rate = (x: number) => (totals.n ? Math.round((x / totals.n) * 1000) / 10 : null);
  const present = members.filter(
    (m) => m.status === 'WORKING' || m.status === 'ON_BREAK' || m.status === 'CHECKED_OUT',
  ).length;
  const go = (p: string) => () => router.push(p as never);

  return (
    <Screen
      onRefresh={() => {
        void team.refetch();
        void dash.refetch();
        void pendingQ.refetch();
        void aheadQ.refetch();
      }}
      refreshing={team.isRefetching}
    >
      <PageHeader
        title={`Welcome back, ${name}`}
        subtitle={`${greetingDate()} · Manager · ${size} direct report${size === 1 ? '' : 's'}`}
      />
      <View style={{ flexDirection: 'row' }}>
        <Badge label="Manager · approve and plan" tone="info" />
      </View>

      <SectionTitle>Needs your action</SectionTitle>
      <Body muted small>
        Approve within {WINDOW_DAYS} working days, then requests escalate to HR.
      </Body>
      <KpiGrid>
        <ActionTile
          value={pendingQ.isPending ? '—' : pending.length}
          title="Leave requests"
          sub={
            pending.length
              ? `Oldest waiting ${oldest} day${oldest === 1 ? '' : 's'}`
              : 'Nothing waiting'
          }
          chip={oldest > WINDOW_DAYS ? 'Past window' : undefined}
          tone="warn"
          onPress={go('/(tabs)/requests')}
        />
        <ActionTile
          value={dash.data?.pending?.corrections ?? '—'}
          title="Attendance corrections"
          sub="Missed punches"
          onPress={go('/(tabs)/requests')}
        />
      </KpiGrid>

      <Panel
        title="Team today"
        aside={<Open onPress={go('/(tabs)/team')} />}
        sub={
          team.data
            ? `${present} in, ${team.data.counts.ON_LEAVE ?? 0} on leave, ${team.data.counts.NOT_IN ?? 0} not in yet`
            : undefined
        }
      >
        {team.isPending ? (
          <Body muted small>
            Loading…
          </Body>
        ) : members.length === 0 ? (
          <Body muted small>
            No one reports to you yet.
          </Body>
        ) : (
          members.slice(0, 8).map((m) => (
            <View
              key={m.id}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 }}
            >
              <Avatar name={m.name} size={34} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontWeight: '700' }}>{m.name}</Text>
                <Body muted small>
                  {m.designation ?? m.employeeCode}
                </Body>
              </View>
              <Badge label={STATUS[m.status].text} tone={STATUS[m.status].tone} />
            </View>
          ))
        )}
      </Panel>

      <Panel title="Team this month" sub="Last 14 days">
        <Line label="Attendance rate" value={pct(rate(totals.p))} />
        <Line label="Absenteeism" value={pct(rate(totals.a))} />
        <Line label="Late arrivals" value={pct(rate(totals.l))} />
        <Body muted small>
          Present per day, last 7 days
        </Body>
        <Bars
          data={tr.slice(-7).map((r) => ({ label: r.date.slice(8), value: r.present + r.halfDay }))}
          height={90}
        />
      </Panel>

      <Panel title="Upcoming team leave" aside={<Open onPress={go('/(tabs)/requests')} />}>
        {crowded ? (
          <Banner tone="danger">
            {rangeText(crowded[0], crowded[0])} is below minimum cover. {crowded[1].size} of {size}{' '}
            people are off if everything pending is approved.
          </Banner>
        ) : null}
        {aheadQ.isPending ? (
          <Body muted small>
            Loading…
          </Body>
        ) : ahead.length === 0 ? (
          <Body muted small>
            No leave booked in the next 60 days.
          </Body>
        ) : (
          ahead
            .slice(0, 6)
            .map((r) => (
              <Line
                key={r.id}
                label={`${personName(r.employee)} · ${rangeText(r.startDate, r.endDate)}`}
                badge={{
                  label: r.status === 'PENDING' ? 'Pending' : 'Approved',
                  tone: toneForStatus(r.status) === 'success' ? 'success' : 'warn',
                }}
              />
            ))
        )}
      </Panel>
    </Screen>
  );
}
