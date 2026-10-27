import { DateTime } from 'luxon';
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { QueryGate } from '@/components/state';
import { Badge, Body, Card, EmptyState, Eyebrow, Screen } from '@/components/ui';
import { useHolidays, useToday } from '@/hooks/queries';
import type { Key } from '@/i18n';
import { todayInZone } from '@/lib/calendar';
import { usePrefs } from '@/prefs';
import { useTheme } from '@/theme';

export default function Holidays() {
  const t = useTheme();
  const { t: tr, lang } = usePrefs();
  const tz = useToday().data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const todayIso = todayInZone(tz);
  const year = Number(todayIso.slice(0, 4));
  const q = useHolidays(`${year}-01-01`, `${year}-12-31`);
  const sorted = useMemo(
    () => [...(q.data ?? [])].sort((a, b) => a.date.localeCompare(b.date)),
    [q.data],
  );
  const next = sorted.find((h) => h.date.slice(0, 10) >= todayIso);
  const until = next
    ? Math.round(
        DateTime.fromISO(next.date.slice(0, 10), { zone: 'utc' }).diff(
          DateTime.fromISO(todayIso, { zone: 'utc' }),
          'days',
        ).days,
      )
    : 0;
  const when =
    until === 0 ? tr('hol.today') : until === 1 ? tr('hol.tomorrow') : tr('hol.in', { n: until });
  const fmt = (iso: string, f: string) =>
    DateTime.fromISO(iso.slice(0, 10), { zone: 'utc' }).setLocale(lang).toFormat(f);

  return (
    <Screen underHeader onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Body muted>{tr('hol.subtitle', { year })}</Body>
      <QueryGate q={q}>
        {() =>
          sorted.length === 0 ? (
            <EmptyState title={tr('hol.none')} />
          ) : (
            <>
              {next ? (
                <Card tone="accent">
                  <Eyebrow>{tr('hol.next')}</Eyebrow>
                  <Text style={{ color: t.text, fontSize: 22, fontWeight: '800' }}>
                    {next.name}
                  </Text>
                  <Body muted>
                    {fmt(next.date, 'cccc, dd LLLL')} · {when}
                  </Body>
                </Card>
              ) : null}
              <Card>
                {sorted.map((h, i) => {
                  const past = h.date.slice(0, 10) < todayIso;
                  return (
                    <View
                      key={h.id}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 14,
                        paddingVertical: 8,
                        opacity: past ? 0.5 : 1,
                        borderTopWidth: i ? 1 : 0,
                        borderColor: t.border,
                      }}
                    >
                      <View style={{ width: 48, alignItems: 'center' }}>
                        <Text style={{ color: t.primary, fontSize: 20, fontWeight: '800' }}>
                          {fmt(h.date, 'dd')}
                        </Text>
                        <Text style={{ color: t.muted, fontSize: 11, fontWeight: '700' }}>
                          {fmt(h.date, 'LLL').toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1, gap: 4 }}>
                        <Body bold>{h.name}</Body>
                        <Body muted small>
                          {fmt(h.date, 'cccc')}
                        </Body>
                      </View>
                      <Badge
                        label={tr(`hol.type.${h.holidayType}` as Key)}
                        tone={h.holidayType === 'OPTIONAL' ? 'warn' : 'neutral'}
                      />
                    </View>
                  );
                })}
              </Card>
            </>
          )
        }
      </QueryGate>
    </Screen>
  );
}
