import { View } from 'react-native';
import { Text } from 'react-native';
import { Divider, KV, QueryGate } from '@/components/state';
import { Banner, Body, Card, EmptyState, Eyebrow, Screen } from '@/components/ui';
import { useMySalary } from '@/hooks/queries';
import { formatMoney, componentAmountMinor } from '@/lib/money';
import { formatWorkDate } from '@/lib/format';
import { useT } from '@/prefs';
import { useTheme } from '@/theme';

export default function Salary() {
  const t = useTheme();
  const tr = useT();
  const q = useMySalary();
  return (
    <Screen underHeader onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Body muted>{tr('sal.subtitle')}</Body>
      <QueryGate q={q}>
        {(s) => {
          if (!s) return <EmptyState title={tr('sal.none')} hint={tr('sal.noneHint')} />;
          const basic = s.components.find((c) => c.code === 'BASIC');
          const basicMinor = basic && basic.calc === 'FIXED' ? basic.value : 0;
          const amt = (c: (typeof s.components)[number]) => componentAmountMinor(c, basicMinor);
          const earn = s.components.filter((c) => c.kind === 'EARNING');
          const ded = s.components.filter((c) => c.kind === 'DEDUCTION');
          const gross = earn.reduce((n, c) => n + amt(c), 0);
          const deductions = ded.reduce((n, c) => n + amt(c), 0);
          const money = (n: number) => formatMoney(n, s.currency);
          const block = (title: string, rows: typeof earn) =>
            rows.length === 0 ? null : (
              <Card>
                <Eyebrow>{title}</Eyebrow>
                {rows.map((c) => (
                  <KV
                    key={c.code}
                    label={
                      c.calc === 'PERCENT_OF_BASIC'
                        ? `${c.name} (${tr('sal.percent', { p: c.value / 100 })})`
                        : c.name
                    }
                    value={money(amt(c))}
                  />
                ))}
              </Card>
            );
          return (
            <>
              <Card tone="accent">
                <Eyebrow>{tr('sal.net')}</Eyebrow>
                <Text style={{ color: t.primary, fontSize: 32, fontWeight: '800' }}>
                  {money(gross - deductions)}
                </Text>
                <Body muted small>
                  {tr('sal.effective', { date: formatWorkDate(s.effectiveFrom.slice(0, 10)) })}
                </Body>
              </Card>
              {block(tr('sal.earnings'), earn)}
              {block(tr('sal.deductions'), ded)}
              <Card>
                <KV label={tr('sal.gross')} value={money(gross)} bold />
                <Divider />
                <KV label={tr('sal.deductions')} value={money(deductions)} />
              </Card>
              <Banner tone="info">{tr('sal.note')}</Banner>
              <View />
            </>
          );
        }}
      </QueryGate>
    </Screen>
  );
}
