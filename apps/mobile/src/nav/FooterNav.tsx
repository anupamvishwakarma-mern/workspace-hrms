import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';
import { useView } from '@/workspace';
import { footerFor } from './config';
import { NavIcon } from './icons';
import { CountBadge } from './parts';
import { useCurrentTab, useGo, useNav, useNavCounts } from './state';

/** At most five items. The active one gets a tinted pill and a bold label, so it never relies on colour alone. */
export function FooterNav() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { view } = useView();
  const { punchFooter } = useNav();
  const tab = useCurrentTab();
  const counts = useNavCounts();
  const go = useGo();
  const items = footerFor(view, punchFooter);
  return (
    <View
      style={{
        backgroundColor: t.bg,
        paddingHorizontal: 12,
        paddingTop: 10,
        paddingBottom: Math.max(insets.bottom, 12) + 10,
      }}
    >
      <View
        accessibilityRole="tablist"
        style={{
          flexDirection: 'row',
          backgroundColor: t.card,
          borderRadius: 22,
          paddingVertical: 8,
          paddingHorizontal: 4,
          shadowColor: t.shadow,
          shadowOpacity: 0.1,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        }}
      >
        {items.map((item) => {
          const active = !!item.tab && !item.center && item.tab === tab;
          const color = active ? t.primary : t.muted;
          const n = item.badge ? counts[item.badge] : 0;
          if (item.center)
            return (
              <View key={item.key} style={{ flex: 1, alignItems: 'center' }}>
                <Pressable
                  onPress={() => go(item)}
                  accessibilityRole="button"
                  accessibilityLabel="Punch in or out"
                  style={({ pressed }) => ({
                    width: 58,
                    height: 58,
                    borderRadius: 29,
                    marginTop: -30,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: pressed ? t.primaryPressed : t.primary,
                    borderWidth: 4,
                    borderColor: t.card,
                    shadowColor: t.primary,
                    shadowOpacity: 0.35,
                    shadowRadius: 10,
                    shadowOffset: { width: 0, height: 4 },
                    elevation: 8,
                  })}
                >
                  <NavIcon name="clock" color={t.primaryText} size={26} />
                </Pressable>
                <Text style={{ color: t.primary, fontSize: 11, fontWeight: '800', marginTop: 3 }}>
                  {item.label}
                </Text>
              </View>
            );
          return (
            <Pressable
              key={item.key}
              onPress={() => go(item)}
              accessibilityRole="tab"
              accessibilityLabel={n > 0 ? `${item.label}, ${n} waiting` : item.label}
              accessibilityState={{ selected: active }}
              style={{ flex: 1, minHeight: 48, alignItems: 'center', gap: 3 }}
            >
              <View
                style={{
                  width: 52,
                  height: 28,
                  borderRadius: 14,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: active ? t.accent : 'transparent',
                }}
              >
                <NavIcon name={item.icon} color={color} size={22} />
                {n > 0 ? (
                  <View style={{ position: 'absolute', top: -6, right: -2 }}>
                    <CountBadge n={n} />
                  </View>
                ) : null}
              </View>
              <Text style={{ color, fontSize: 11, fontWeight: active ? '800' : '500' }}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
