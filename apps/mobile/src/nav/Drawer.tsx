import { useEffect, useMemo, useRef } from 'react';
import {
  Alert,
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Application from 'expo-application';
import { useAuth } from '@/auth/AuthProvider';
import { Avatar } from '@/components/ui';
import { useMyEmployee } from '@/hooks/queries';
import { useTheme } from '@/theme';
import { useView } from '@/workspace';
import { drawerFor, ROLE_LABEL, type NavItem } from './config';
import { NavIcon } from './icons';
import { CountBadge, IconButton } from './parts';
import { useCurrentTab, useGo, useNav, useNavCounts } from './state';

const EDGE = 18;

export function Drawer() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const w = Math.min(320, Math.round(width * 0.86));
  const { open, setOpen, punchFooter, setPunchFooter } = useNav();
  const { view, base, canSwitch, self, setSelf } = useView();
  const { signOut, email } = useAuth();
  const me = useMyEmployee();
  const tab = useCurrentTab();
  const counts = useNavCounts();
  const go = useGo();
  const x = useRef(new Animated.Value(-w)).current;

  useEffect(() => {
    Animated.timing(x, { toValue: open ? 0 : -w, duration: 220, useNativeDriver: true }).start();
  }, [open, w, x]);

  // Swipe in from the left edge to open; swipe the open drawer to the left to close.
  const edge = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => g.dx > 12 && Math.abs(g.dy) < 24,
        onPanResponderRelease: (_, g) => g.dx > 40 && setOpen(true),
      }),
    [setOpen],
  );
  const closer = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => g.dx < -12 && Math.abs(g.dy) < 24,
        onPanResponderRelease: (_, g) => g.dx < -40 && setOpen(false),
      }),
    [setOpen],
  );

  const name =
    [me.data?.firstName, me.data?.lastName].filter(Boolean).join(' ') || email || 'Signed in';
  const sub = [me.data?.designation, me.data?.employeeCode].filter(Boolean).join(' · ');
  const groups = drawerFor(view);
  const other = canSwitch ? (self ? ROLE_LABEL[base] : 'My') : undefined;

  const pick = (item: NavItem) => {
    setOpen(false);
    go(item);
  };
  const confirmSignOut = () =>
    Alert.alert('Sign out?', 'You will need to sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          setOpen(false);
          void signOut();
        },
      },
    ]);

  const chip = (label: string, tone: 'role' | 'warn' | 'danger') => {
    const [bg, fg] =
      tone === 'role'
        ? [t.accent, t.primary]
        : tone === 'warn'
          ? [t.warnBg, t.warn]
          : [t.dangerBg, t.danger];
    return (
      <View
        key={label}
        style={{
          paddingHorizontal: 10,
          paddingVertical: 3,
          borderRadius: 999,
          backgroundColor: bg,
        }}
      >
        <Text style={{ color: fg, fontSize: 12, fontWeight: '700' }}>{label}</Text>
      </View>
    );
  };
  const waiting =
    counts.total > 0
      ? view === 'owner'
        ? `${counts.total} decision${counts.total === 1 ? '' : 's'}`
        : view === 'hr'
          ? `${counts.total} to review`
          : `${counts.total} approval${counts.total === 1 ? '' : 's'}`
      : undefined;

  return (
    <>
      {!open ? (
        <View
          {...edge.panHandlers}
          style={{ position: 'absolute', left: 0, top: 120, bottom: 120, width: EDGE }}
        />
      ) : null}
      <View
        pointerEvents={open ? 'auto' : 'none'}
        style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
      >
        <Pressable
          accessibilityLabel="Close menu"
          onPress={() => setOpen(false)}
          style={{ flex: 1, backgroundColor: '#000', opacity: open ? 0.45 : 0 }}
        />
        <Animated.View
          {...closer.panHandlers}
          accessibilityViewIsModal={open}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: w,
            backgroundColor: t.card,
            borderTopRightRadius: 28,
            borderBottomRightRadius: 28,
            paddingTop: insets.top,
            paddingBottom: Math.max(insets.bottom, 12),
            transform: [{ translateX: x }],
          }}
        >
          <View style={{ padding: 20, paddingBottom: 14, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 }}>
              <View style={{ flex: 1, alignItems: 'flex-start' }}>
                <Avatar name={name} size={56} />
              </View>
              <IconButton label="Close menu" onPress={() => setOpen(false)}>
                <NavIcon name="close" color={t.text} size={22} />
              </IconButton>
            </View>
            <Text numberOfLines={1} style={{ color: t.text, fontSize: 19, fontWeight: '800' }}>
              {name}
            </Text>
            {sub ? (
              <Text numberOfLines={1} style={{ color: t.muted, fontSize: 13 }}>
                {sub}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {chip(ROLE_LABEL[view], 'role')}
              {waiting ? chip(waiting, view === 'hr' ? 'danger' : 'warn') : null}
            </View>
          </View>
          <View style={{ height: 1, backgroundColor: t.border }} />
          <ScrollView contentContainerStyle={{ padding: 12, gap: 14 }}>
            {groups.map((g) => (
              <View key={g.title} style={{ gap: 2 }}>
                <Text
                  accessibilityRole="header"
                  style={{
                    color: t.muted,
                    fontSize: 11,
                    fontWeight: '800',
                    letterSpacing: 1,
                    textTransform: 'uppercase',
                    paddingHorizontal: 10,
                    paddingBottom: 4,
                  }}
                >
                  {g.title}
                </Text>
                {g.items.map((item) => {
                  const active = !!item.tab && item.tab === tab;
                  const n = item.badge ? counts[item.badge] : 0;
                  return (
                    <Pressable
                      key={item.key}
                      onPress={() => pick(item)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={n > 0 ? `${item.label}, ${n} waiting` : item.label}
                      style={({ pressed }) => ({
                        minHeight: 48,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 14,
                        paddingHorizontal: 10,
                        borderRadius: 12,
                        backgroundColor: active ? t.accent : pressed ? t.subtle : 'transparent',
                      })}
                    >
                      <NavIcon name={item.icon} color={active ? t.primary : t.muted} size={22} />
                      <Text
                        style={{
                          flex: 1,
                          color: active ? t.primary : t.text,
                          fontSize: 16,
                          fontWeight: active ? '800' : '600',
                        }}
                      >
                        {item.label}
                      </Text>
                      <CountBadge n={n} />
                    </Pressable>
                  );
                })}
              </View>
            ))}
            {other ? (
              <Pressable
                onPress={() => {
                  setSelf(!self);
                  setOpen(false);
                }}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  minHeight: 48,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 14,
                  paddingHorizontal: 10,
                  borderRadius: 14,
                  backgroundColor: pressed ? t.subtle : 'transparent',
                })}
              >
                <NavIcon name="swap" color={t.muted} size={22} />
                <Text style={{ flex: 1, color: t.text, fontSize: 16, fontWeight: '600' }}>
                  {self ? `Switch to ${other} workspace` : 'Switch to my workspace'}
                </Text>
              </Pressable>
            ) : null}
            {view === 'employee' ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingHorizontal: 10,
                  minHeight: 48,
                }}
              >
                <Text style={{ flex: 1, color: t.text, fontSize: 15, fontWeight: '600' }}>
                  Punch button in footer
                </Text>
                <Switch
                  value={punchFooter}
                  onValueChange={setPunchFooter}
                  accessibilityLabel="Punch button in footer"
                  trackColor={{ true: t.primary }}
                />
              </View>
            ) : null}
          </ScrollView>
          <View style={{ height: 1, backgroundColor: t.border }} />
          <View style={{ paddingHorizontal: 12, paddingTop: 8 }}>
            <Pressable
              onPress={confirmSignOut}
              accessibilityRole="button"
              style={({ pressed }) => ({
                minHeight: 48,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                paddingHorizontal: 10,
                borderRadius: 14,
                backgroundColor: pressed ? t.dangerBg : 'transparent',
              })}
            >
              <NavIcon name="logout" color={t.danger} size={22} />
              <Text style={{ color: t.danger, fontSize: 16, fontWeight: '700' }}>Sign out</Text>
            </Pressable>
            <Text style={{ color: t.muted, fontSize: 12, paddingHorizontal: 10, paddingTop: 4 }}>
              Version {Application.nativeApplicationVersion ?? '0.1.0'}
            </Text>
          </View>
        </Animated.View>
      </View>
    </>
  );
}
