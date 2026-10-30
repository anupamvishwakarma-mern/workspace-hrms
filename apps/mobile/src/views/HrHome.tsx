import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { Badge, Body, PageHeader, Screen } from '@/components/ui';
import {
  ActionTile,
  Bars,
  HBars,
  KpiGrid,
  Line,
  Panel,
  SegmentBar,
  SectionTitle,
} from '@/components/charts';
import {
  useAttOverview,
  useDashboardData,
  useDepartmentNames,
  useReviewLeave,
  useStaff,
} from '@/hooks/insights';
import { countBy, isEmployed, joinedIn, leftIn } from '@/lib/workforce';
import { useTheme } from '@/theme';
import { Open } from './OwnerHome';
import { WINDOW_DAYS, daysSince, greetingDate, thisMonth, useFirstName } from './shared';

/** HR home: what needs action, sorted by what affects payroll first. */
export default function HrHome() {
  const t = useTheme();
  const router = useRouter();
  const name = useFirstName();
  const month = thisMonth();
  const dash = useDashboardData();
  const att = useAttOverview(month);
  const pending = useReviewLeave({ status: 'PENDING' });
  const staff = useStaff();
  const depts = useDepartmentNames();
  const d = dash.data;
  const a = att.data;
  const all = staff.data ?? [];
  const employed = all.filter(isEmployed);
  const notice = all.filter((e) => e.employmentStatus === 'NOTICE_PERIOD');
  const joined = joinedIn(all, month);
  const left = leftIn(all, month);
  const late = (pending.data ?? []).filter((r) => daysSince(r.createdAt) > WINDOW_DAYS).length;
  const go = (p: string) => () => router.push(p as never);
  const tail = d?.trend.slice(-7) ?? [];

  return (
    <Screen
      onRefresh={() => {
        void dash.refetch();
        void att.refetch();
        void pending.refetch();
        void staff.refetch();
      }}
      refreshing={dash.isRefetching}
    >
      <PageHeader
        title={`Welcome back, ${name}`}
        subtitle={`${greetingDate()} · HR · ${employed.length} employees`}
      />
      <View style={{ flexDirection: 'row' }}>
        <Badge label="HR · manage and approve" tone="warn" />
      </View>

      <SectionTitle>Needs your action</SectionTitle>
      <KpiGrid>
        <ActionTile
          value={d?.pending?.exceptions ?? '—'}
          title="Location exceptions"
          sub="Punches outside the geofence"
          chip="Blocks payroll"
          tone="danger"
          onPress={go('/(tabs)/requests')}
        />
        <ActionTile
          value={d?.pending?.corrections ?? '—'}
          title="Attendance corrections"
          sub="Waiting for manager or HR"
          chip="Blocks payroll"
          tone="danger"
          onPress={go('/(tabs)/requests')}
        />
        <ActionTile
          value={pending.isPending ? '—' : (pending.data?.length ?? 0)}
          title="Leave approvals"
          sub={late ? `${late} past the ${WINDOW_DAYS}-day window` : 'All within the window'}
          chip="Review"
          tone="warn"
          onPress={go('/(tabs)/requests')}
        />
        <ActionTile
          value={a?.attention.lateMarkLimit.count ?? '—'}
          title="At the late-mark limit"
          sub={a ? `${a.attention.lateMarkLimit.limit}+ late marks` : undefined}
          chip="Review"
          tone="warn"
          onPress={go('/(tabs)/history')}
        />
        <ActionTile
          value={a?.attention.absentStreak.count ?? '—'}
          title="Absent streaks"
          sub={a ? `${a.attention.absentStreak.days}+ days in a row` : undefined}
          chip="This week"
          tone="info"
          onPress={go('/(tabs)/history')}
        />
        <ActionTile
          value={notice.length}
          title="Exits in progress"
          sub="On notice period"
          onPress={go('/(tabs)/team')}
        />
      </KpiGrid>

      <Panel
        title="Workforce today"
        aside={<Open onPress={go('/(tabs)/history')} />}
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
        <Body muted small>
          Headcount by department
        </Body>
        <HBars rows={countBy(employed, (e) => depts.name(e.departmentId)).slice(0, 6)} />
      </Panel>

      <Panel
        title={`${new Date().toLocaleString('en', { month: 'long' })} payroll readiness`}
        sub={
          d ? `Last 14 days: ${d.trend.reduce((n, r) => n + r.absent, 0)} absent days` : undefined
        }
      >
        <Line
          label="Exceptions resolved"
          badge={{
            label: (d?.pending?.exceptions ?? 0) === 0 ? 'Done' : `${d?.pending?.exceptions} open`,
            tone: (d?.pending?.exceptions ?? 0) === 0 ? 'success' : 'danger',
          }}
        />
        <Line
          label="Corrections approved"
          badge={{
            label:
              (d?.pending?.corrections ?? 0) === 0 ? 'Done' : `${d?.pending?.corrections} waiting`,
            tone: (d?.pending?.corrections ?? 0) === 0 ? 'success' : 'warn',
          }}
        />
        <Line
          label="Leave approvals up to date"
          badge={{
            label: (pending.data?.length ?? 0) === 0 ? 'Done' : `${pending.data?.length} waiting`,
            tone: (pending.data?.length ?? 0) === 0 ? 'success' : 'warn',
          }}
        />
        <Line
          label="Payroll this month"
          badge={{
            label: a?.compliance.currentMonthPayroll ?? 'Not started',
            tone: a?.compliance.currentMonthPayroll ? 'info' : 'neutral',
          }}
        />
      </Panel>

      <Panel title="Present, last 7 days" sub="People marked present each day">
        <Bars data={tail.map((r) => ({ label: r.date.slice(8), value: r.present + r.halfDay }))} />
      </Panel>

      <Panel
        title="Onboarding this month"
        sub={`${joined.length} joiner${joined.length === 1 ? '' : 's'}`}
      >
        {joined.length === 0 ? (
          <Body muted small>
            No one joined this month.
          </Body>
        ) : (
          joined.map((e) => (
            <Line
              key={e.id}
              label={`${e.firstName} ${e.lastName}`}
              value={depts.name(e.departmentId)}
            />
          ))
        )}
      </Panel>
      <Panel title="Exits in progress" sub={`${left.length} leaving this month`}>
        {notice.length === 0 && left.length === 0 ? (
          <Body muted small>
            No exits in progress.
          </Body>
        ) : (
          [...notice, ...left.filter((e) => e.employmentStatus !== 'NOTICE_PERIOD')].map((e) => (
            <Line
              key={e.id}
              label={`${e.employeeCode} · ${depts.name(e.departmentId)}`}
              badge={{
                label: e.employmentStatus === 'NOTICE_PERIOD' ? 'On notice' : 'Left',
                tone: e.employmentStatus === 'NOTICE_PERIOD' ? 'warn' : 'neutral',
              }}
            />
          ))
        )}
      </Panel>
    </Screen>
  );
}
