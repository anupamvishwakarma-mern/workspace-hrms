import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Icon } from '@/components/icons';
import { QueryGate } from '@/components/state';
import { Body, Card, EmptyState, Screen } from '@/components/ui';
import { useHandbook } from '@/hooks/queries';
import { parseHandbook } from '@/lib/handbook';
import { useT } from '@/prefs';
import { useTheme } from '@/theme';

export default function Handbook() {
  const t = useTheme();
  const tr = useT();
  const q = useHandbook();
  const [open, setOpen] = useState<string>();
  return (
    <Screen underHeader onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Body muted>{tr('hb.subtitle')}</Body>
      <QueryGate q={q}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState title={tr('hb.none')} hint={tr('hb.noneHint')} />
          ) : (
            [...list]
              .sort((a, b) => a.order - b.order)
              .map((s) => {
                const on = open === s.id;
                return (
                  <Card key={s.id}>
                    <Pressable
                      onPress={() => setOpen(on ? undefined : s.id)}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: on }}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <Text style={{ color: t.text, fontSize: 17, fontWeight: '700', flex: 1 }}>
                        {s.title}
                      </Text>
                      <View style={{ transform: [{ rotate: on ? '90deg' : '0deg' }] }}>
                        <Icon name="chevron" color={t.muted} size={16} />
                      </View>
                    </Pressable>
                    {on
                      ? parseHandbook(s.body).map((b, i) =>
                          b.type === 'h' ? (
                            <Text
                              key={i}
                              style={{
                                color: t.text,
                                fontWeight: '800',
                                fontSize: 15,
                                marginTop: 6,
                              }}
                            >
                              {b.text}
                            </Text>
                          ) : b.type === 'li' ? (
                            <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
                              <Text style={{ color: t.primary }}>•</Text>
                              <View style={{ flex: 1 }}>
                                <Body>{b.text}</Body>
                              </View>
                            </View>
                          ) : (
                            <Body key={i}>{b.text}</Body>
                          ),
                        )
                      : null}
                  </Card>
                );
              })
          )
        }
      </QueryGate>
    </Screen>
  );
}
