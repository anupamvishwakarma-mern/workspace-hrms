import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Badge, Body, Card, Eyebrow } from '@/components/ui';
import { radius, useTheme, type Theme } from '@/theme';

export type Tone = 'success' | 'warn' | 'danger' | 'info' | 'neutral';

export const palette = (t: Theme) => [t.primary, t.info, t.warn, t.danger, t.muted, t.success];
const toneColor = (t: Theme, tone: Tone) =>
  ({ success: t.success, warn: t.warn, danger: t.danger, info: t.info, neutral: t.text })[tone];

/** A titled card. `aside` sits on the right of the title (a count, a link). */
export function Panel({
  title,
  sub,
  aside,
  children,
}: {
  title: string;
  sub?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const t = useTheme();
  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontSize: 16, fontWeight: '800' }}>{title}</Text>
          {sub ? (
            <Body muted small>
              {sub}
            </Body>
          ) : null}
        </View>
        {typeof aside === 'string' ? (
          <Body muted small>
            {aside}
          </Body>
        ) : (
          aside
        )}
      </View>
      {children}
    </Card>
  );
}

export const SectionTitle = ({ children }: { children: string }) => <Eyebrow>{children}</Eyebrow>;

/** A headline number with a small caption, two per row via KpiGrid. */
export function Kpi({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: Tone;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexBasis: '47%',
        flexGrow: 1,
        backgroundColor: t.card,
        borderColor: t.border,
        borderWidth: 1,
        borderRadius: radius.md,
        padding: 14,
        gap: 2,
      }}
    >
      <Text style={{ color: t.muted, fontSize: 12, fontWeight: '600' }}>{label}</Text>
      <Text style={{ color: toneColor(t, tone), fontSize: 24, fontWeight: '800' }}>{value}</Text>
      {sub ? <Text style={{ color: t.muted, fontSize: 11 }}>{sub}</Text> : null}
    </View>
  );
}
export const KpiGrid = ({ children }: { children: ReactNode }) => (
  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>{children}</View>
);

/** "Better / Worse" change against the previous period. */
export function Delta({
  cur,
  prev,
  unit,
  lowerIsBetter = false,
}: {
  cur: number | null | undefined;
  prev: number | null | undefined;
  unit: string;
  lowerIsBetter?: boolean;
}) {
  if (cur == null || prev == null) return null;
  const diff = Math.round((cur - prev) * 10) / 10;
  if (diff === 0) return <Badge label="No change" tone="neutral" />;
  const good = lowerIsBetter ? diff < 0 : diff > 0;
  return (
    <Badge
      label={`${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)} ${unit} · ${good ? 'Better' : 'Worse'}`}
      tone={good ? 'success' : 'danger'}
    />
  );
}

/** Vertical columns with the value above each bar. */
export function Bars({
  data,
  height = 120,
  color,
  highlightLast = true,
  format = (n: number) => String(n),
  floor,
}: {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
  highlightLast?: boolean;
  format?: (n: number) => string;
  /** Where the bars start. Pass a number above zero to show small changes (say so in a caption). */
  floor?: number;
}) {
  const t = useTheme();
  const lo = floor ?? 0;
  const max = Math.max(lo + 1, ...data.map((d) => d.value));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: height + 36 }}>
      {data.map((d, i) => {
        const h = Math.max(4, ((d.value - lo) / (max - lo)) * height);
        const last = i === data.length - 1;
        return (
          <View key={`${d.label}${i}`} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
            <Text style={{ color: t.muted, fontSize: 10, fontWeight: '600' }}>
              {format(d.value)}
            </Text>
            <View
              accessibilityLabel={`${d.label} ${format(d.value)}`}
              style={{
                width: '100%',
                height: h,
                borderRadius: 6,
                backgroundColor: color ?? (highlightLast && !last ? t.info : t.primary),
                opacity: highlightLast && !last ? 0.55 : 1,
              }}
            />
            <Text style={{ color: t.muted, fontSize: 10 }}>{d.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** Labelled horizontal bars, sized against the largest value (or `max`). */
export function HBars({
  rows,
  max,
  color,
}: {
  rows: { name: string; value: number; text?: string; tone?: Tone }[];
  max?: number;
  color?: string;
}) {
  const t = useTheme();
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0)
    return (
      <Body muted small>
        Nothing to show yet.
      </Body>
    );
  return (
    <View style={{ gap: 9 }}>
      {rows.map((r) => (
        <View key={r.name} style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ color: t.text, fontSize: 13, fontWeight: '600', flexShrink: 1 }}>
              {r.name}
            </Text>
            <Text style={{ color: t.muted, fontSize: 13, fontVariant: ['tabular-nums'] }}>
              {r.text ?? r.value}
            </Text>
          </View>
          <View
            accessibilityRole="progressbar"
            accessibilityLabel={r.name}
            accessibilityValue={{ min: 0, max: top, now: r.value }}
            style={{ height: 8, borderRadius: 8, backgroundColor: t.subtle, overflow: 'hidden' }}
          >
            <View
              style={{
                width: `${Math.min(100, (r.value / top) * 100)}%`,
                height: '100%',
                borderRadius: 8,
                backgroundColor: color ?? (r.tone ? toneColor(t, r.tone) : t.primary),
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

/** One bar split into coloured parts, with a legend underneath. Reads as a donut does, in a narrow card. */
export function SegmentBar({
  parts,
}: {
  parts: { label: string; value: number; color: string }[];
}) {
  const t = useTheme();
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <View style={{ gap: 10 }}>
      <View
        accessibilityLabel={parts.map((p) => `${p.label} ${p.value}`).join(', ')}
        style={{
          flexDirection: 'row',
          height: 12,
          borderRadius: 12,
          overflow: 'hidden',
          backgroundColor: t.subtle,
        }}
      >
        {total > 0
          ? parts
              .filter((p) => p.value > 0)
              .map((p) => (
                <View key={p.label} style={{ flex: p.value, backgroundColor: p.color }} />
              ))
          : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, rowGap: 6 }}>
        {parts.map((p) => (
          <View
            key={p.label}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexBasis: '46%' }}
          >
            <View style={{ width: 9, height: 9, borderRadius: 9, backgroundColor: p.color }} />
            <Text style={{ color: t.muted, fontSize: 12, flex: 1 }}>{p.label}</Text>
            <Text style={{ color: t.text, fontSize: 12, fontWeight: '700' }}>{p.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Big-number tile that opens where the work is done. */
export function ActionTile({
  value,
  title,
  sub,
  chip,
  tone = 'neutral',
  onPress,
}: {
  value: number | string;
  title: string;
  sub?: string;
  chip?: string;
  tone?: Tone;
  onPress?: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${value} ${title}`}
      style={({ pressed }) => ({
        flexBasis: '47%',
        flexGrow: 1,
        backgroundColor: t.card,
        borderColor: t.border,
        borderWidth: 1,
        borderRadius: radius.md,
        padding: 14,
        gap: 3,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: t.text, fontSize: 26, fontWeight: '800' }}>{value}</Text>
        {chip ? <Badge label={chip} tone={tone} /> : null}
      </View>
      <Text style={{ color: t.text, fontSize: 14, fontWeight: '700' }}>{title}</Text>
      {sub ? <Text style={{ color: t.muted, fontSize: 11 }}>{sub}</Text> : null}
    </Pressable>
  );
}

/** Label / value line inside a card. */
export function Line({
  label,
  value,
  badge,
}: {
  label: string;
  value?: string | number;
  badge?: { label: string; tone: Tone };
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: t.border,
      }}
    >
      <Text style={{ color: t.muted, fontSize: 14, flex: 1 }}>{label}</Text>
      {badge ? (
        <Badge label={badge.label} tone={badge.tone} />
      ) : (
        <Text style={{ color: t.text, fontSize: 14, fontWeight: '700' }}>{value}</Text>
      )}
    </View>
  );
}

export const pct = (n: number | null | undefined) => (n == null ? '—' : `${n}%`);
