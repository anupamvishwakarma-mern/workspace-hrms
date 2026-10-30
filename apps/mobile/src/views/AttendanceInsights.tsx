import { useState } from 'react';
import { View } from 'react-native';
import { Chip } from '@/components/state';
import { Body, PageHeader, Screen } from '@/components/ui';
import { QueryGate } from '@/components/state';
import { Bars, Delta, HBars, Kpi, KpiGrid, Panel, SegmentBar, pct } from '@/components/charts';
import { useAttOverview } from '@/hooks/insights';
import { formatMinutes } from '@/lib/format';
import { shiftMonth } from '@/lib/calendar';
import { useTheme } from '@/theme';
import { monthName, thisMonth } from './shared';

const MONTH_NAMES = (m: string) =>
  new Date(`${m}-01T00:00:00`).toLocaleString('en', { month: 'short' });

/** Owner and HR: attendance across the company for a month. */
export default function AttendanceInsights({ canAct }: { canAct: boolean }) {
  const t = useTheme();
  const cur = thisMonth();
  const [month, setMonth] = useState(cur);
  const q = useAttOverview(month);
  const a = q.data;
  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <PageHeader
        title="Attendance"
        subtitle={
          canAct
            ? 'Live attendance and the month so far.'
            : 'Attendance insights for the whole company.'
        }
      />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[shiftMonth(cur, -2), shiftMonth(cur, -1), cur].map((m) => (
          <Chip key={m} label={MONTH_NAMES(m)} on={month === m} onPress={() => setMonth(m)} />
        ))}
      </View>
      <QueryGate q={q}>
        {(d) => (
          <>
            <Panel
              title="Today"
              sub={`${d.live.present} of ${d.live.expected} expected are in${d.live.rate != null ? ` · ${d.live.rate}%` : ''}`}
            >
              <SegmentBar
                parts={[
                  { label: 'Present', value: d.live.present, color: t.success },
                  { label: 'On leave', value: d.live.onLeave, color: t.info },
                  { label: 'Absent', value: d.live.absent, color: t.danger },
                  { label: 'Not in yet', value: d.live.notIn, color: t.muted },
                ]}
              />
              <Body muted small>
                {d.live.lateToday} late today · {d.live.off} on weekly off or holiday
              </Body>
            </Panel>

            <KpiGrid>
              <Kpi label="Attendance rate" value={pct(d.current.attendanceRate)} />
              <Kpi label="Absenteeism" value={pct(d.current.absenteeism)} />
              <Kpi label="Late arrivals" value={pct(d.current.lateRate)} />
              <Kpi label="Avg net hours" value={formatMinutes(d.current.avgNetMinutes)} />
              <Kpi label="Overtime" value={formatMinutes(d.current.overtimeMinutes)} />
            </KpiGrid>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Delta cur={d.current.attendanceRate} prev={d.previous.attendanceRate} unit="pts" />
              <Delta
                cur={d.current.absenteeism}
                prev={d.previous.absenteeism}
                unit="pts"
                lowerIsBetter
              />
              <Delta cur={d.current.lateRate} prev={d.previous.lateRate} unit="pts" lowerIsBetter />
            </View>

            <Panel
              title="Attendance rate"
              sub={`Last ${d.trend.length} months · ${monthName(month)} is the latest`}
            >
              {(() => {
                const vals = d.trend.map((x) => x.attendanceRate ?? 0);
                const floor = Math.max(0, Math.floor(Math.min(...vals) - 5));
                return (
                  <Bars
                    data={d.trend.map((x) => ({
                      label: MONTH_NAMES(x.month),
                      value: x.attendanceRate ?? 0,
                    }))}
                    floor={floor}
                    format={(n) => `${n}`}
                  />
                );
              })()}
              <Body muted small>
                The axis does not start at zero, so small changes show.
              </Body>
            </Panel>

            <Panel title="Absenteeism by weekday" sub="Which days carry the most absence">
              <HBars
                rows={d.weekday.map((w) => ({
                  name: w.day,
                  value: w.absenteeism ?? 0,
                  text: pct(w.absenteeism),
                }))}
              />
            </Panel>

            <Panel title="Departments" sub="Sorted by attendance rate">
              <HBars
                max={100}
                rows={[...d.byDepartment]
                  .sort((x, y) => (y.attendanceRate ?? 0) - (x.attendanceRate ?? 0))
                  .map((x) => ({
                    name: `${x.name} · ${x.headcount}`,
                    value: x.attendanceRate ?? 0,
                    text: pct(x.attendanceRate),
                  }))}
              />
            </Panel>
            <Panel title="Locations">
              <HBars
                max={100}
                rows={d.byLocation.map((x) => ({
                  name: x.name,
                  value: x.attendanceRate ?? 0,
                  text: pct(x.attendanceRate),
                }))}
              />
            </Panel>

            <Panel title="Needs attention">
              <HBars
                rows={[
                  {
                    name: `At the late-mark limit (${d.attention.lateMarkLimit.limit}+)`,
                    value: d.attention.lateMarkLimit.count,
                    tone: 'warn' as const,
                  },
                  {
                    name: `Absent ${d.attention.absentStreak.days}+ days in a row`,
                    value: d.attention.absentStreak.count,
                    tone: 'danger' as const,
                  },
                  {
                    name: `Over ${d.attention.highOvertime.hours} h overtime`,
                    value: d.attention.highOvertime.count,
                    tone: 'info' as const,
                  },
                  {
                    name: `Approvals waiting over ${d.attention.overdueApprovals.days} days`,
                    value: d.attention.overdueApprovals.count,
                    tone: 'warn' as const,
                  },
                ]}
              />
              {d.attention.teamsBelowFloor.names.length ? (
                <Body small>
                  Teams below {d.attention.teamsBelowFloor.floor}%:{' '}
                  {d.attention.teamsBelowFloor.names.join(', ')}
                </Body>
              ) : null}
            </Panel>
          </>
        )}
      </QueryGate>
      {a ? null : null}
    </Screen>
  );
}
