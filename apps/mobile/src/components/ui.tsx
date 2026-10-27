import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/components/icons';
import { radius, useIsDark, useTheme, type Theme } from '@/theme';

export function Screen({
  children,
  onRefresh,
  refreshing,
  padded = true,
  underHeader,
}: {
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  padded?: boolean;
  /** True when a navigation header already covers the status bar area. */
  underHeader?: boolean;
}) {
  const t = useTheme();
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: t.bg }}
      edges={underHeader ? ['left', 'right'] : ['top', 'left', 'right']}
    >
      <ScrollView
        contentContainerStyle={[padded && { padding: 20, gap: 14 }, { paddingBottom: 40 }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={!!refreshing}
              onRefresh={onRefresh}
              tintColor={t.primary}
              colors={[t.primary]}
            />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export const shadow = (t: Theme) => ({
  shadowColor: t.shadow,
  shadowOpacity: 0.06,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
});

export function Card({ children, tone }: { children: ReactNode; tone?: 'accent' }) {
  const t = useTheme();
  return (
    <View
      style={[
        s.card,
        { backgroundColor: tone === 'accent' ? t.accent : t.card, borderColor: t.border },
        shadow(t),
      ]}
    >
      {children}
    </View>
  );
}

export function H1({ children }: { children: ReactNode }) {
  return (
    <Text style={[s.h1, { color: useTheme().text }]} accessibilityRole="header">
      {children}
    </Text>
  );
}
export function Body({
  children,
  muted,
  small,
  bold,
}: {
  children: ReactNode;
  muted?: boolean;
  small?: boolean;
  bold?: boolean;
}) {
  const t = useTheme();
  return (
    <Text
      style={{
        color: muted ? t.muted : t.text,
        fontSize: small ? 13 : 15,
        lineHeight: small ? 19 : 22,
        fontWeight: bold ? '600' : '400',
      }}
    >
      {children}
    </Text>
  );
}

/** Section label above a group of content. */
export function Eyebrow({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <Text
      style={{
        color: t.muted,
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
      }}
    >
      {children}
    </Text>
  );
}

/** Screen heading with an optional supporting line. */
export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ gap: 2, marginBottom: 4 }}>
      <H1>{title}</H1>
      {subtitle ? <Body muted>{subtitle}</Body> : null}
    </View>
  );
}

/** Initials in a circle; the hue comes from the name so people are visually distinct. */
export function Avatar({ name, size = 48 }: { name: string; size?: number }) {
  const isDark = useIsDark();
  const initials =
    name
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join('') || '?';
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  const dark = isDark;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{
        width: size,
        height: size,
        borderRadius: size,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: `hsl(${h}, ${dark ? 35 : 60}%, ${dark ? 22 : 90}%)`,
      }}
    >
      <Text
        style={{
          fontWeight: '700',
          fontSize: size * 0.38,
          color: `hsl(${h}, ${dark ? 70 : 65}%, ${dark ? 75 : 28}%)`,
        }}
      >
        {initials}
      </Text>
    </View>
  );
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  accessibilityHint,
  size = 'md',
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
  size?: 'md' | 'lg';
}) {
  const t = useTheme();
  const off = disabled || loading;
  const fg =
    variant === 'primary'
      ? t.primaryText
      : variant === 'danger'
        ? '#ffffff'
        : variant === 'ghost'
          ? t.primary
          : t.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={({ pressed }) => {
        const bg =
          variant === 'primary'
            ? pressed
              ? t.primaryPressed
              : t.primary
            : variant === 'danger'
              ? t.danger
              : variant === 'ghost'
                ? pressed
                  ? t.accent
                  : 'transparent'
                : pressed
                  ? t.subtle
                  : t.card;
        return [
          s.btn,
          size === 'lg' && s.btnLg,
          {
            backgroundColor: bg,
            borderColor: variant === 'secondary' ? t.border : 'transparent',
            opacity: off ? 0.5 : 1,
          },
          variant === 'primary' && !off ? shadow(t) : null,
        ];
      }}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[s.btnText, size === 'lg' && { fontSize: 18 }, { color: fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  error,
  ...rest
}: TextInputProps & { label: string; error?: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: t.text, fontWeight: '600', fontSize: 14 }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={t.muted}
        selectionColor={t.primary}
        {...rest}
        style={[
          s.input,
          { color: t.text, backgroundColor: t.subtle, borderColor: error ? t.danger : t.border },
          rest.multiline && { minHeight: 96, textAlignVertical: 'top', paddingTop: 12 },
        ]}
      />
      {error ? <Text style={{ color: t.danger, fontSize: 13 }}>{error}</Text> : null}
    </View>
  );
}

type Tone = 'danger' | 'success' | 'warn' | 'info';
const toneColors = (t: Theme, tone: Tone) =>
  ({
    danger: [t.danger, t.dangerBg],
    success: [t.success, t.successBg],
    warn: [t.warn, t.warnBg],
    info: [t.info, t.infoBg],
  })[tone] as [string, string];
const toneIcon: Record<Tone, IconName> = {
  danger: 'alert',
  warn: 'alert',
  success: 'check',
  info: 'info',
};

export function Banner({
  tone,
  children,
  action,
}: {
  tone: Tone;
  children: ReactNode;
  action?: ReactNode;
}) {
  const t = useTheme();
  const [fg, bg] = toneColors(t, tone);
  return (
    <View
      accessibilityRole={tone === 'danger' ? 'alert' : undefined}
      style={[s.banner, { backgroundColor: bg, borderColor: fg + '33' }]}
    >
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <View style={{ marginTop: 1 }}>
          <Icon name={toneIcon[tone]} color={fg} size={18} />
        </View>
        <Text style={{ color: fg, fontSize: 14, lineHeight: 20, flex: 1 }}>{children}</Text>
      </View>
      {action}
    </View>
  );
}

/** Status pill with a leading dot, mirroring the web badges. */
export function Badge({ label, tone }: { label: string; tone: Tone | 'neutral' }) {
  const t = useTheme();
  const [fg, bg] = tone === 'neutral' ? [t.muted, t.subtle] : toneColors(t, tone);
  return (
    <View style={[s.badge, { backgroundColor: bg }]}>
      <View style={{ width: 6, height: 6, borderRadius: 6, backgroundColor: fg }} />
      <Text style={{ color: fg, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

/** Two-up segmented control. */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
}) {
  const t = useTheme();
  return (
    <View style={[s.segment, { backgroundColor: t.subtle, borderColor: t.border }]}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[s.segmentItem, on && [{ backgroundColor: t.card }, shadow(t)]]}
          >
            <Text style={{ color: on ? t.primary : t.muted, fontWeight: '700', fontSize: 14 }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={[s.stat, { backgroundColor: t.subtle }]}>
      <Text style={{ color: t.muted, fontSize: 12, fontWeight: '600' }}>{label}</Text>
      <Text style={{ color: t.text, fontSize: 18, fontWeight: '700' }}>{value}</Text>
    </View>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  const t = useTheme();
  return (
    <View style={[s.empty, { borderColor: t.border }]}>
      <Text style={{ color: t.text, fontWeight: '700', fontSize: 15 }}>{title}</Text>
      {hint ? (
        <Body muted small>
          {hint}
        </Body>
      ) : null}
    </View>
  );
}

export const Center = ({ children }: { children: ReactNode }) => (
  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
    {children}
  </View>
);

export const Loading = () => {
  const t = useTheme();
  return (
    <Center>
      <ActivityIndicator size="large" color={t.primary} accessibilityLabel="Loading" />
    </Center>
  );
};

export function toneForStatus(status?: string | null): Tone | 'neutral' {
  switch (status) {
    case 'PRESENT':
    case 'APPROVED':
      return 'success';
    case 'HALF_DAY':
    case 'PENDING':
    case 'INCOMPLETE':
      return 'warn';
    case 'ABSENT':
    case 'REJECTED':
      return 'danger';
    default:
      return 'neutral';
  }
}

const s = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: 18, gap: 10 },
  h1: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  btn: {
    minHeight: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  btnLg: { minHeight: 60, borderRadius: radius.lg },
  btnText: { fontSize: 16, fontWeight: '700' },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  banner: { borderWidth: 1, borderRadius: radius.md, padding: 14, gap: 10 },
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  segment: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  segmentItem: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  stat: { flex: 1, borderRadius: radius.md, padding: 12, gap: 2 },
  empty: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.lg,
    padding: 24,
    alignItems: 'center',
    gap: 4,
  },
});
