import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Icon } from '@/components/icons';
import { Divider, KV, QueryGate } from '@/components/state';
import {
  Badge,
  Body,
  Button,
  Card,
  PageHeader,
  Screen,
  Stat,
  toneForStatus,
} from '@/components/ui';
import { useDays, useHolidays, useMyLeaveRequests, useToday } from '@/hooks/queries';
import type { Key } from '@/i18n';
import {
  monthBounds,
  monthGrid,
  monthOf,
  monthTitle,
  shiftMonth,
  todayInZone,
  weekdayLetters,
} from '@/lib/calendar';
import { formatMinutes, formatTime, formatWorkDate } from '@/lib/format';
import { usePrefs } from '@/prefs';
import AttendanceInsights from '@/views/AttendanceInsights';
import ManagerAttendance from '@/views/ManagerAttendance';
import { useView } from '@/workspace';
import { useTheme, type Theme } from '@/theme';

type Kind = 'PRESENT' | 'HALF_DAY' | 'ABSENT' | 'LEAVE' | 'HOLIDAY' | 'OTHER';

const colorOf = (t: Theme, k: Kind): [string, string] =>
  ({
    PRESENT: [t.success, t.successBg],
    HALF_DAY: [t.warn, t.warnBg],
    ABSENT: [t.danger, t.dangerBg],
    LEAVE: [t.info, t.infoBg],
    HOLIDAY: [t.primary, t.accent],
    OTHER: [t.muted, t.subtle],
  })[k] as [string, string];

/** Attendance: company insights for owners and HR, the team for managers, the calendar for everyone's own days. */
export default function Attendance() {
  const { view } = useView();
  if (view === 'owner') return <AttendanceInsights canAct={false} />;
  if (view === 'hr') return <AttendanceInsights canAct />;
  if (view === 'manager') return <ManagerAttendance />;
  return <MyAttendance />;
}

function MyAttendance() {
  const t = useTheme();
  const { t: tr, lang } = usePrefs();
  const router = useRouter();
  const today = useToday();
  const tz = today.data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const todayIso = todayInZone(tz);
  const [month, setMonth] = useState(monthOf(todayIso));
  const [picked, setPicked] = useState<string>(todayIso);
  const { from, to } = monthBounds(month);
  const days = useDays(month, from, to);
  const holidays = useHolidays(from, to);
  const leaves = useMyLeaveRequests();

  const byDate = useMemo(() => new Map((days.data ?? []).map((d) => [d.workDate, d])), [days.data]);
  const holidayByDate = useMemo(
    () => new Map((holidays.data ?? []).map((h) => [h.date.slice(0, 10), h])),
    [holidays.data],
  );
  const leaveDates = useMemo(() => {
    const set = new Set<string>();
    for (const l of leaves.data ?? []) {
      if (l.status !== 'APPROVED') continue;
      for (let d = l.startDate.slice(0, 10); d <= l.endDate.slice(0, 10); d = shiftDay(d))
        set.add(d);
    }
    return set;
  }, [leaves.data]);

  const kindOf = (date: string): Kind | null => {
    const d = byDate.get(date);
    if (d?.status === 'PRESENT') return 'PRESENT';
    if (d?.status === 'HALF_DAY') return 'HALF_DAY';
    if (d?.status === 'ABSENT') return 'ABSENT';
    if (d?.status === 'ON_LEAVE' || leaveDates.has(date)) return 'LEAVE';
    if (d?.status === 'HOLIDAY' || holidayByDate.has(date)) return 'HOLIDAY';
    if (d) return 'OTHER';
    return null;
  };

  const list = days.data ?? [];
  const present = list.filter((d) => d.status === 'PRESENT' || d.status === 'HALF_DAY').length;
  const absent = list.filter((d) => d.status === 'ABSENT').length;
  const late = list.filter((d) => d.lateMinutes > 0).length;
  const minutes = list.reduce((n, d) => n + d.workedMinutes, 0);
  const sel = byDate.get(picked);
  const selHoliday = holidayByDate.get(picked);
  const grid = monthGrid(month);
  const letters = weekdayLetters(lang);

  const legend: [Kind, Key][] = [
    ['PRESENT', 'att.legend.present'],
    ['HALF_DAY', 'att.legend.half'],
    ['ABSENT', 'att.legend.absent'],
    ['LEAVE', 'att.legend.leave'],
    ['HOLIDAY', 'att.legend.holiday'],
  ];

  return (
    <Screen
      onRefresh={() => {
        void days.refetch();
        void holidays.refetch();
        void leaves.refetch();
      }}
      refreshing={days.isRefetching}
    >
      <PageHeader title={tr('tab.attendance')} subtitle={tr('att.subtitle')} />

      <Card>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Pressable
            onPress={() => setMonth(shiftMonth(month, -1))}
            accessibilityRole="button"
            accessibilityLabel={tr('att.prev')}
            hitSlop={12}
            style={{ transform: [{ rotate: '180deg' }], padding: 6 }}
          >
            <Icon name="chevron" color={t.primary} size={20} />
          </Pressable>
          <Text style={{ color: t.text, fontSize: 17, fontWeight: '800' }}>
            {monthTitle(month, lang)}
          </Text>
          <Pressable
            onPress={() => setMonth(shiftMonth(month, 1))}
            accessibilityRole="button"
            accessibilityLabel={tr('att.next')}
            hitSlop={12}
            style={{ padding: 6 }}
          >
            <Icon name="chevron" color={t.primary} size={20} />
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row' }}>
          {letters.map((l, i) => (
            <Text
              key={i}
              style={{
                flex: 1,
                textAlign: 'center',
                color: t.muted,
                fontSize: 12,
                fontWeight: '700',
              }}
            >
              {l}
            </Text>
          ))}
        </View>
        {grid.map((week, wi) => (
          <View key={wi} style={{ flexDirection: 'row', gap: 4 }}>
            {week.map((c) => {
              const k = c.inMonth ? kindOf(c.date) : null;
              const [fg, bg] = k ? colorOf(t, k) : [t.text, 'transparent'];
              const isSel = c.date === picked;
              return (
                <Pressable
                  key={c.date}
                  disabled={!c.inMonth}
                  onPress={() => setPicked(c.date)}
                  accessibilityRole="button"
                  accessibilityLabel={formatWorkDate(c.date)}
                  accessibilityState={{ selected: isSel }}
                  style={{
                    flex: 1,
                    height: 42,
                    borderRadius: 12,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: bg,
                    borderWidth: isSel ? 2 : c.date === todayIso ? 1 : 0,
                    borderColor: isSel ? t.primary : t.muted,
                    opacity: c.inMonth ? 1 : 0.25,
                  }}
                >
                  <Text style={{ color: fg, fontWeight: k ? '800' : '500', fontSize: 14 }}>
                    {c.day}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 }}>
          {legend.map(([k, label]) => (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  backgroundColor: colorOf(t, k)[0],
                }}
              />
              <Text style={{ color: t.muted, fontSize: 12 }}>{tr(label)}</Text>
            </View>
          ))}
        </View>
      </Card>

      <QueryGate q={days}>
        {() => (
          <>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Stat label={tr('att.present')} value={String(present)} />
              <Stat label={tr('att.absent')} value={String(absent)} />
              <Stat label={tr('att.late')} value={String(late)} />
              <Stat label={tr('att.hours')} value={formatMinutes(minutes)} />
            </View>

            <Card>
              <Text style={{ color: t.text, fontSize: 17, fontWeight: '700' }}>
                {formatWorkDate(picked)}
              </Text>
              {selHoliday ? <Badge label={selHoliday.name} tone="info" /> : null}
              {sel ? (
                <>
                  <Badge
                    label={sel.status ? tr(`status.${sel.status}` as Key) : tr('att.inProgress')}
                    tone={toneForStatus(sel.status)}
                  />
                  <Divider />
                  <KV label={tr('today.firstIn')} value={formatTime(sel.firstCheckIn, tz)} />
                  <KV
                    label={tr('today.lastOut')}
                    value={sel.isOpen ? tr('att.working') : formatTime(sel.lastCheckOut, tz)}
                  />
                  <KV label={tr('today.worked')} value={formatMinutes(sel.workedMinutes)} />
                  <KV label={tr('today.breaks')} value={formatMinutes(sel.breakMinutes)} />
                  {sel.lateMinutes ? (
                    <KV label={tr('today.lateBy')} value={formatMinutes(sel.lateMinutes)} />
                  ) : null}
                  {sel.correctionStatus === 'PENDING' ? (
                    <Badge label={tr('today.correctionPending')} tone="warn" />
                  ) : null}
                </>
              ) : (
                <Body muted>{tr('att.noRecord')}</Body>
              )}
              {picked <= todayIso ? (
                <Button
                  title={tr('att.requestCorrection')}
                  variant="ghost"
                  onPress={() =>
                    router.push({ pathname: '/correction/new', params: { workDate: picked } })
                  }
                />
              ) : null}
            </Card>
          </>
        )}
      </QueryGate>
    </Screen>
  );
}

function shiftDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
