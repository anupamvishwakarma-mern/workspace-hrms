import { useMemo, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useAuth } from '@/auth/AuthProvider';
import { Chip, QueryGate } from '@/components/state';
import { Avatar, Badge, Body, Card, EmptyState, Field, PageHeader, Screen } from '@/components/ui';
import { useTeamToday } from '@/hooks/queries';
import type { Key } from '@/i18n';
import { canSeeTeam, seesEveryone } from '@/lib/roles';
import type { TeamMember } from '@/lib/schemas';
import { useT } from '@/prefs';
import PeopleSummary from '@/views/PeopleSummary';
import { useView } from '@/workspace';
import { useTheme } from '@/theme';

type Status = TeamMember['status'];
const ORDER: Status[] = ['WORKING', 'ON_BREAK', 'CHECKED_OUT', 'ON_LEAVE', 'NOT_IN'];
const LABEL: Record<Status, Key> = {
  WORKING: 'team.working',
  ON_BREAK: 'team.onBreak',
  CHECKED_OUT: 'team.checkedOut',
  ON_LEAVE: 'team.onLeave',
  NOT_IN: 'team.notIn',
};
const TONE: Record<Status, 'success' | 'warn' | 'neutral' | 'info' | 'danger'> = {
  WORKING: 'success',
  ON_BREAK: 'warn',
  CHECKED_OUT: 'neutral',
  ON_LEAVE: 'info',
  NOT_IN: 'danger',
};

/** Team: a manager's reports today; owners and HR also see headcount and movement above the list. */
export default function Team() {
  const { base } = useView();
  return <TeamList summary={base === 'owner' || base === 'hr'} />;
}

function TeamList({ summary }: { summary: boolean }) {
  const t = useTheme();
  const tr = useT();
  const { active } = useAuth();
  const allowed = canSeeTeam(active?.roles);
  const q = useTeamToday(allowed);
  const [filter, setFilter] = useState<Status | 'ALL'>('ALL');
  const [search, setSearch] = useState('');

  const members = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (q.data?.members ?? [])
      .filter((m) => filter === 'ALL' || m.status === filter)
      .filter((m) => !needle || m.name.toLowerCase().includes(needle))
      .sort(
        (a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.name.localeCompare(b.name),
      );
  }, [q.data, filter, search]);

  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <PageHeader
        title={tr('team.title')}
        subtitle={tr(seesEveryone(active?.roles) ? 'team.subtitleAll' : 'team.subtitleManager')}
      />
      {summary ? <PeopleSummary /> : null}
      <QueryGate q={q}>
        {(data) => (
          <>
            <Field
              label={tr('team.search')}
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
            />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Chip
                label={`${tr('team.all')} · ${data.members.length}`}
                on={filter === 'ALL'}
                onPress={() => setFilter('ALL')}
              />
              {ORDER.map((s) => (
                <Chip
                  key={s}
                  label={`${tr(LABEL[s])} · ${data.counts[s] ?? 0}`}
                  on={filter === s}
                  onPress={() => setFilter(s)}
                />
              ))}
            </View>
            {members.length === 0 ? (
              <EmptyState title={tr('team.none')} />
            ) : (
              members.map((m) => (
                <Card key={m.id}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <Avatar name={m.name} size={44} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Body bold>{m.name}</Body>
                      <Body muted small>
                        {[m.designation, m.department].filter(Boolean).join(' · ') ||
                          m.employeeCode}
                      </Body>
                    </View>
                    <Badge label={tr(LABEL[m.status])} tone={TONE[m.status]} />
                  </View>
                  {m.phone || m.email ? (
                    <View style={{ flexDirection: 'row', gap: 20 }}>
                      {m.phone ? (
                        <Pressable
                          accessibilityRole="link"
                          onPress={() => void Linking.openURL(`tel:${m.phone}`)}
                        >
                          <Text style={{ color: t.primary, fontWeight: '700' }}>
                            {tr('team.call')}
                          </Text>
                        </Pressable>
                      ) : null}
                      {m.email ? (
                        <Pressable
                          accessibilityRole="link"
                          onPress={() => void Linking.openURL(`mailto:${m.email}`)}
                        >
                          <Text style={{ color: t.primary, fontWeight: '700' }}>
                            {tr('team.email')}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                </Card>
              ))
            )}
          </>
        )}
      </QueryGate>
    </Screen>
  );
}
