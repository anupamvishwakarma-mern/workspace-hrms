import { useRouter } from 'expo-router';
import { Pressable } from 'react-native';
import { QueryGate } from '@/components/state';
import { Badge, Body, Card, EmptyState, Screen } from '@/components/ui';
import { useMyLetters } from '@/hooks/queries';
import type { Key } from '@/i18n';
import { formatWorkDate } from '@/lib/format';
import { useT } from '@/prefs';

export default function Letters() {
  const tr = useT();
  const router = useRouter();
  const q = useMyLetters();
  return (
    <Screen underHeader onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Body muted>{tr('let.subtitle')}</Body>
      <QueryGate q={q}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState title={tr('let.none')} hint={tr('let.noneHint')} />
          ) : (
            list.map((l) => (
              <Pressable
                key={l.id}
                accessibilityRole="button"
                accessibilityLabel={l.title}
                onPress={() => router.push({ pathname: '/hr/letter', params: { id: l.id } })}
              >
                <Card>
                  <Body bold>{l.title}</Body>
                  <Body muted small>
                    {tr(`let.cat.${l.category}` as Key)} · {tr('let.ref', { ref: l.referenceNo })}
                  </Body>
                  <Body muted small>
                    {tr('let.issued', { date: formatWorkDate(l.issuedAt.slice(0, 10)) })}
                  </Body>
                  {l.status === 'REVOKED' ? (
                    <Badge label={tr('let.revoked')} tone="danger" />
                  ) : null}
                </Card>
              </Pressable>
            ))
          )
        }
      </QueryGate>
    </Screen>
  );
}
