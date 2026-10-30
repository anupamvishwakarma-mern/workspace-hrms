import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { Avatar, Badge, Body, PageHeader, Screen } from '@/components/ui';
import { QueryGate } from '@/components/state';
import {
  Bars,
  Delta,
  HBars,
  Kpi,
  KpiGrid,
  Line,
  Panel,
  SegmentBar,
  SectionTitle,
  pct,
} from '@/components/charts';
import { useAttOverview, useDepartmentNames, useLeaveOverview, useStaff } from '@/hooks/insights';
import {
  attrition12,
  countBy,
  headcountTrend,
  isEmployed,
  joinedIn,
  leftIn,
} from '@/lib/workforce';
import { useTheme } from '@/theme';
import { greetingDate, monthName, thisMonth, useFirstName } from './shared';

/** Owner home: the company at a glance. Read-only; decisions belong to HR and managers. */
export default function OwnerHome() {
  const t = useTheme();
  const router = useRouter();
  const name = useFirstName();
  const month = thisMonth();
  const att = useAttOverview(month);
  const leave = useLeaveOverview(month);
  const staff = useStaff();
  const depts = useDepartmentNames();
  const a = att.data;
  const l = leave.data;
  const all = staff.data ?? [];
  const employed = all.filter(isEmployed);
  const joined = joinedIn(all, month);
  const left = leftIn(all, month);
  const attr = attrition12(all, month);
  const byDept = countBy(employed, (e) => depts.name(e.departmentId));
  const trend = headcountTrend(all, month);
  const people = [
    ...joined.map((e) => ({ e, kind: 'Joiner' as const, date: e.joiningDate ?? '' })),
    ...left.map((e) => ({ e, kind: 'Leaver' as const, date: e.lastWorkingDate ?? '' })),
  ].sort((x, y) => x.date.localeCompare(y.date));

  return (
    <Screen
      onRefresh={() => {
        void att.refetch();
        void leave.refetch();
        void staff.refetch();
      }}
      refreshing={att.isRefetching}
    >
      <PageHeader
        title={`Welcome back, ${name}`}
        subtitle={`${greetingDate()} · Owner · ${employed.length} employees`}
      />
      <View style={{ flexDirection: 'row' }}>
        <Badge label="Owner · view and insights" tone="info" />
      </View>

      <KpiGrid>
        <Kpi
          label="Headcount"
          value={staff.isPending ? '…' : employed.length}
          sub={`${joined.length} joined · ${left.length} left this month`}
        />
        <Kpi
          label="Attendance rate"
          value={pct(a?.current.attendanceRate)}
          sub={a ? monthName(month) : undefined}
        />
        <Kpi
          label="Attrition, 12 months"
          value={pct(attr.pct)}
          sub={`${attr.leavers} leavers · avg headcount ${attr.avgHeadcount}`}
        />
        <Kpi label="Leave days this month" value={l?.current.days ?? '…'} />
        <Kpi
          label="On leave today"
          value={l ? `${l.onLeaveToday.people}` : '…'}
          sub={l ? `of ${l.onLeaveToday.headcount} people` : undefined}
        />
        <Kpi
          label="Unused leave"
          value={l ? `${l.liability.unusedDays} d` : '…'}
          sub={l ? `${l.liability.avgUnusedPerPerson} per person` : undefined}
        />
      </KpiGrid>
      {a ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Delta cur={a.current.attendanceRate} prev={a.previous.attendanceRate} unit="pts" />
          {l ? (
            <Delta cur={l.current.days} prev={l.previous.days} unit="days" lowerIsBetter />
          ) : null}
        </View>
      ) : null}

      <Panel
        title="Headcount · 6 months"
        sub={`${joined.length} joined and ${left.length} left this month`}
      >
        <Bars
          data={trend.map((x) => ({ label: x.label, value: x.value }))}
          floor={Math.max(0, Math.floor(Math.min(...trend.map((x) => x.value)) * 0.9))}
        />
        <Body muted small>
          The axis does not start at zero, so small changes show.
        </Body>
      </Panel>

      <Panel
        title="Where people are today"
        sub={a ? `${a.live.present} of ${a.live.expected} expected are in` : undefined}
      >
        {a ? (
          <SegmentBar
            parts={[
              { label: 'Present', value: a.live.present, color: t.success },
              { label: 'On leave', value: a.live.onLeave, color: t.info },
              { label: 'Absent', value: a.live.absent, color: t.danger },
              { label: 'Not in yet', value: a.live.notIn, color: t.muted },
            ]}
          />
        ) : (
          <Body muted small>
            Loading…
          </Body>
        )}
      </Panel>

      <SectionTitle>People health</SectionTitle>
      <Panel
        title="Attendance overview"
        aside={<Open onPress={() => router.push('/(tabs)/history')} />}
      >
        <Line label="Attendance rate" value={pct(a?.current.attendanceRate)} />
        <Line label="Absenteeism" value={pct(a?.current.absenteeism)} />
        <Line label="Late arrivals" value={pct(a?.current.lateRate)} />
      </Panel>
      <Panel
        title="Leave overview"
        aside={<Open onPress={() => router.push('/(tabs)/requests')} />}
      >
        <Line
          label="On leave today"
          value={l ? `${l.onLeaveToday.people} of ${l.onLeaveToday.headcount}` : '—'}
        />
        <Line label="Unplanned leave share" value={pct(l?.current.unplannedShare)} />
        <Line label="Teams with a crowded week ahead" value={l?.coverage.length ?? '—'} />
      </Panel>

      <Panel title="By department" sub="Share of headcount">
        <HBars rows={byDept.slice(0, 7)} />
      </Panel>
      <Panel title="By location">
        <HBars rows={(a?.byLocation ?? []).map((x) => ({ name: x.name, value: x.headcount }))} />
      </Panel>
      <Panel title="Leave by type" sub="Last 6 months">
        <HBars
          rows={(l?.byType ?? []).map((x) => ({
            name: x.name,
            value: x.share,
            text: `${x.share}% · ${x.days} d`,
          }))}
          max={100}
        />
      </Panel>

      <Panel title="Payroll and compliance" sub={monthName(month)}>
        <Line
          label="Previous month payroll"
          badge={{
            label: a?.compliance.previousMonthPayroll ?? 'No run',
            tone: a?.compliance.previousMonthPayroll ? 'success' : 'neutral',
          }}
        />
        <Line
          label="This month payroll"
          badge={{
            label: a?.compliance.currentMonthPayroll ?? 'Not started',
            tone: a?.compliance.currentMonthPayroll ? 'info' : 'neutral',
          }}
        />
        <Line
          label="Open location exceptions"
          value={a?.compliance.openLocationExceptions ?? '—'}
        />
        <Line label="Manual edits approved" value={a?.compliance.manualEditsApproved ?? '—'} />
      </Panel>

      <Panel title="Joiners and leavers this month">
        {people.length === 0 ? (
          <Body muted small>
            No joiners or leavers this month.
          </Body>
        ) : (
          people.map(({ e, kind, date }) => (
            <View
              key={`${kind}${e.id}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}
            >
              <Avatar name={`${e.firstName} ${e.lastName}`} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontWeight: '700' }}>
                  {e.firstName} {e.lastName}
                </Text>
                <Body muted small>
                  {depts.name(e.departmentId)} · {kind === 'Joiner' ? 'Joined' : 'Last day'}{' '}
                  {date.slice(0, 10)}
                </Body>
              </View>
              <Badge label={kind} tone={kind === 'Joiner' ? 'success' : 'neutral'} />
            </View>
          ))
        )}
      </Panel>
      <QueryGate q={att}>{() => null}</QueryGate>
    </Screen>
  );
}

function Open({ onPress }: { onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="link" hitSlop={10}>
      <Text style={{ color: t.primary, fontWeight: '700', fontSize: 13 }}>Open</Text>
    </Pressable>
  );
}
export { Open };
