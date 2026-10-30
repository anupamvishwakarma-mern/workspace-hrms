import { useRouter } from 'expo-router';
import { DateTime } from 'luxon';
import { Pressable, Text, View } from 'react-native';
import { Banner, Body } from '@/components/ui';
import { Bars, HBars, Kpi, KpiGrid, Panel, SectionTitle } from '@/components/charts';
import { useDays, useHolidays, useLeaveBalances, useMyLeaveRequests } from '@/hooks/queries';
import { monthBounds, monthOf } from '@/lib/calendar';
import { formatMinutes } from '@/lib/format';
import { useTheme } from '@/theme';
import { rangeText } from './shared';

const ACTIONS: [string, string, string][] = [
  ['Apply for leave', 'Casual, sick, earned', '/hr/leave-apply'],
  ['Regularize', 'Fix a missed punch', '/correction/new'],
  ['My leave', 'Balances and requests', '/hr/leave'],
  ['Payslips', 'Your pay history', '/hr/payslips'],
];

/** Employee home, below the punch card: the month so far, quick actions, leave balance and what is coming. */
export default function EmployeeExtras({ today }: { today: string }) {
  const t = useTheme();
  const router = useRouter();
  const month = monthOf(today);
  const { from, to } = monthBounds(month);
  const days = useDays(month, from, to);
  const bal = useLeaveBalances(DateTime.fromISO(today).year);
  const mine = useMyLeaveRequests();
  const hol = useHolidays(today, DateTime.fromISO(today).plus({ days: 60 }).toISODate()!);
  const rows = (days.data ?? []).filter((d) => d.workDate <= today);
  const worked = rows.filter((d) => d.workedMinutes > 0).slice(-7);
  const present = rows.filter((d) => d.status === 'PRESENT' || d.status === 'HALF_DAY').length;
  const working = rows.filter((d) => d.status !== 'HOLIDAY' && d.status !== 'WEEKLY_OFF').length;
  const late = rows.filter((d) => d.lateMinutes > 0).length;
  const overtime = rows.reduce((n, d) => n + (d.overtimeMinutes ?? 0), 0);
  const taken = (bal.data ?? []).reduce((n, b) => n + b.approvedDays, 0);
  const pending = (mine.data ?? []).filter((r) => r.status === 'PENDING');
  const monthLabel = DateTime.fromISO(`${month}-01`).toFormat('LLLL');

  return (
    <View style={{ gap: 14 }}>
      <SectionTitle>{`${monthLabel} at a glance`}</SectionTitle>
      <KpiGrid>
        <Kpi label="Present days" value={present} sub={`of ${working} working days`} />
        <Kpi label="Late marks" value={late} />
        <Kpi label="Leave taken" value={taken} sub="Approved days this year" />
        <Kpi label="Overtime" value={formatMinutes(overtime)} />
      </KpiGrid>
      <Panel title="Net hours" sub={`Last ${worked.length || 7} working days`}>
        <Bars
          data={worked.map((d) => ({
            label: d.workDate.slice(8),
            value: Math.round((d.workedMinutes / 60) * 10) / 10,
          }))}
          height={90}
          format={(n) => `${n}h`}
          highlightLast={false}
        />
      </Panel>

      <SectionTitle>Quick actions</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {ACTIONS.map(([title, sub, href]) => (
          <Pressable
            key={title}
            onPress={() => router.push(href as never)}
            accessibilityRole="button"
            style={({ pressed }) => ({
              flexBasis: '47%',
              flexGrow: 1,
              backgroundColor: t.card,
              borderColor: t.border,
              borderWidth: 1,
              borderRadius: 14,
              padding: 14,
              gap: 2,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: t.text, fontWeight: '800' }}>{title}</Text>
            <Text style={{ color: t.muted, fontSize: 12 }}>{sub}</Text>
          </Pressable>
        ))}
      </View>

      <Panel
        title="Leave balance"
        aside={
          <Text
            onPress={() => router.push('/hr/leave' as never)}
            style={{ color: t.primary, fontWeight: '700' }}
          >
            See all
          </Text>
        }
      >
        <HBars
          rows={(bal.data ?? []).map((b) => ({
            name: b.name,
            value: b.allowanceDays ? (b.remainingDays ?? 0) : b.approvedDays,
            text: b.allowanceDays ? `${b.remainingDays ?? 0} of ${b.allowanceDays} left` : 'No cap',
          }))}
          max={Math.max(1, ...(bal.data ?? []).map((b) => b.allowanceDays ?? 0))}
        />
        {pending[0] ? (
          <Banner tone="warn">
            {pending.length} pending: {pending[0].leaveType?.name},{' '}
            {rangeText(pending[0].startDate, pending[0].endDate)} ({pending[0].days} day
            {pending[0].days === 1 ? '' : 's'}), waiting for approval.
          </Banner>
        ) : null}
      </Panel>

      <Panel title="Upcoming holidays">
        {(hol.data ?? []).length === 0 ? (
          <Body muted small>
            No holidays in the next 60 days.
          </Body>
        ) : (
          (hol.data ?? []).slice(0, 4).map((h) => (
            <View
              key={h.id}
              style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}
            >
              <Text style={{ color: t.text, fontWeight: '600' }}>{h.name}</Text>
              <Text style={{ color: t.muted }}>
                {DateTime.fromISO(h.date.slice(0, 10)).toFormat('ccc, d LLL')}
              </Text>
            </View>
          ))
        )}
      </Panel>
    </View>
  );
}
