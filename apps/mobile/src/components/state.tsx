import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/icons';
import { Banner, Body, Button, Card } from '@/components/ui';
import { userMessage } from '@/lib/errors';
import { useT } from '@/prefs';
import { useTheme } from '@/theme';

/** Shows a spinner or an error banner until the query has data, then renders the children. */
export function QueryGate<T>({
  q,
  children,
}: {
  q: UseQueryResult<T>;
  children: (data: T) => ReactNode;
}) {
  const t = useTheme();
  const tr = useT();
  if (q.isPending)
    return (
      <View style={{ padding: 32, alignItems: 'center' }}>
        <ActivityIndicator color={t.primary} accessibilityLabel={tr('common.loading')} />
      </View>
    );
  if (q.isError)
    return (
      <Banner
        tone="danger"
        action={
          <Button title={tr('common.retry')} variant="secondary" onPress={() => void q.refetch()} />
        }
      >
        {userMessage(q.error)}
      </Banner>
    );
  return <>{children(q.data)}</>;
}

/** A tappable row with an icon and a chevron, used by the More hub. */
export function NavRow({
  icon,
  label,
  hint,
  onPress,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 12,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          backgroundColor: t.accent,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} color={t.primary} size={20} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>{label}</Text>
        {hint ? (
          <Body muted small>
            {hint}
          </Body>
        ) : null}
      </View>
      <Icon name="chevron" color={t.muted} size={16} />
    </Pressable>
  );
}

/** A small selectable pill (filters, leave type choice). */
export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: on ? t.primary : t.border,
        backgroundColor: on ? t.accent : t.card,
      }}
    >
      <Text style={{ color: on ? t.primary : t.text, fontWeight: '600', fontSize: 14 }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Label on the left, value on the right. */
export function KV({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Text style={{ color: t.muted, fontSize: 14, flexShrink: 1 }}>{label}</Text>
      <Text
        style={{
          color: t.text,
          fontSize: 14,
          fontWeight: bold ? '800' : '600',
          textAlign: 'right',
          flexShrink: 1,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

export const Divider = () => {
  const t = useTheme();
  return <View style={{ height: 1, backgroundColor: t.border }} />;
};

export { Card };
