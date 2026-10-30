import { View } from 'react-native';
import { Avatar, Badge, Body, PageHeader, Screen } from '@/components/ui';
import { QueryGate } from '@/components/state';
import { Bars, Kpi, KpiGrid, Panel, SegmentBar, pct } from '@/components/charts';
import { useDashboardData } from '@/hooks/insights';
import { useTeamToday } from '@/hooks/queries';
import { useTheme } from '@/theme';
import { Text } from 'react-native';

/** Manager: how the team is doing today and over the last two weeks. */
export default function ManagerAttendance() {
  const t = useTheme();
  const team = useTeamToday(true);
  const dash = useDashboardData();
  return (
    <Screen
      onRefresh={() => {
        void team.refetch();
        void dash.refetch();
      }}
      refreshing={team.isRefetching}
    >
      <PageHeader title="Attendance" subtitle="Your team today and the last 14 days." />
      <QueryGate q={team}>
        {(d) => {
          const c = d.counts;
          const absent = d.members.filter((m) => m.status === 'NOT_IN');
          return (
            <>
              <Panel title="Team today" sub={`${d.members.length} people`}>
                <SegmentBar
                  parts={[
                    {
                      label: 'Working',
                      value: (c.WORKING ?? 0) + (c.ON_BREAK ?? 0),
                      color: t.success,
                    },
                    { label: 'Checked out', value: c.CHECKED_OUT ?? 0, color: t.primary },
                    { label: 'On leave', value: c.ON_LEAVE ?? 0, color: t.info },
                    { label: 'Not in yet', value: c.NOT_IN ?? 0, color: t.muted },
                  ]}
                />
              </Panel>
              <Panel title="Not in yet" sub="Not punched in or on leave">
                {absent.length === 0 ? (
                  <Body muted small>
                    Everyone is in or on approved leave.
                  </Body>
                ) : (
                  absent.map((m) => (
                    <View
                      key={m.id}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                        paddingVertical: 5,
                      }}
                    >
                      <Avatar name={m.name} size={32} />
                      <Text style={{ color: t.text, fontWeight: '600', flex: 1 }}>{m.name}</Text>
                      <Badge label="Not in yet" tone="warn" />
                    </View>
                  ))
                )}
              </Panel>
            </>
          );
        }}
      </QueryGate>
      <QueryGate q={dash}>
        {(d) => {
          const tot = d.trend.reduce(
            (s, r) => ({
              p: s.p + r.present + r.halfDay * 0.5,
              n: s.n + r.present + r.halfDay + r.absent,
              a: s.a + r.absent,
              l: s.l + r.late,
            }),
            { p: 0, n: 0, a: 0, l: 0 },
          );
          const r = (x: number) => (tot.n ? Math.round((x / tot.n) * 1000) / 10 : null);
          return (
            <>
              <KpiGrid>
                <Kpi label="Attendance rate" value={pct(r(tot.p))} sub="Last 14 days" />
                <Kpi label="Absenteeism" value={pct(r(tot.a))} />
                <Kpi label="Late arrivals" value={pct(r(tot.l))} />
                <Kpi
                  label="Absent days"
                  value={tot.a}
                  sub="Team total"
                  tone={tot.a ? 'danger' : 'neutral'}
                />
              </KpiGrid>
              <Panel title="Present per day" sub="Last 14 days">
                <Bars
                  data={d.trend.map((x) => ({
                    label: x.date.slice(8),
                    value: x.present + x.halfDay,
                  }))}
                  height={100}
                />
              </Panel>
            </>
          );
        }}
      </QueryGate>
    </Screen>
  );
}
