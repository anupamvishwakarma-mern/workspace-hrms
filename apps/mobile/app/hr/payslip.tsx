import { useLocalSearchParams } from 'expo-router';
import { Share, Text } from 'react-native';
import { Divider, KV, QueryGate } from '@/components/state';
import { Banner, Button, Card, Eyebrow, PageHeader, Screen } from '@/components/ui';
import { usePayslip } from '@/hooks/queries';
import { monthTitle } from '@/lib/calendar';
import { formatMoney } from '@/lib/money';
import type { PayslipFull } from '@/lib/schemas';
import { usePrefs } from '@/prefs';
import { useTheme } from '@/theme';

export default function PayslipDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const { t: tr, lang } = usePrefs();
  const q = usePayslip(String(id));

  const text = (p: PayslipFull) => {
    const m = (n: number) => formatMoney(n, p.currency);
    return [
      tr('pay.shareTitle', { month: monthTitle(p.month, lang) }),
      p.employee?.name ?? '',
      '',
      ...p.lines.map((l) => `${l.name}: ${l.kind === 'DEDUCTION' ? '-' : ''}${m(l.amountMinor)}`),
      '',
      `${tr('pay.gross')}: ${m(p.grossMinor)}`,
      `${tr('pay.deductions')}: ${m(p.deductionsMinor)}`,
      `${tr('pay.net')}: ${m(p.netMinor)}`,
    ].join('\n');
  };

  return (
    <Screen underHeader>
      <QueryGate q={q}>
        {(p) => {
          const m = (n: number) => formatMoney(n, p.currency);
          const a = p.attendance;
          const earn = p.lines.filter((l) => l.kind === 'EARNING');
          const ded = p.lines.filter((l) => l.kind === 'DEDUCTION');
          return (
            <>
              <PageHeader title={monthTitle(p.month, lang)} subtitle={p.employee?.name} />
              <Card tone="accent">
                <Eyebrow>{tr('pay.net')}</Eyebrow>
                <Text style={{ color: t.primary, fontSize: 32, fontWeight: '800' }}>
                  {m(p.netMinor)}
                </Text>
              </Card>
              {p.warnings.length ? (
                <Banner tone="warn">{tr('pay.warnings', { w: p.warnings.join(', ') })}</Banner>
              ) : null}
              {a ? (
                <Card>
                  <Eyebrow>{tr('pay.attendance')}</Eyebrow>
                  <KV
                    label={tr('pay.payable')}
                    value={`${a.payableDays ?? '-'} ${a.daysInMonth ? tr('pay.outOf', { n: a.daysInMonth }) : ''}`}
                    bold
                  />
                  {a.presentDays !== undefined ? (
                    <KV label={tr('pay.present')} value={String(a.presentDays)} />
                  ) : null}
                  {a.paidLeaveDays !== undefined ? (
                    <KV label={tr('pay.leave')} value={String(a.paidLeaveDays)} />
                  ) : null}
                  {a.holidays !== undefined || a.weeklyOffs !== undefined ? (
                    <KV
                      label={tr('pay.holidays')}
                      value={String((a.holidays ?? 0) + (a.weeklyOffs ?? 0))}
                    />
                  ) : null}
                  {a.lopDays !== undefined ? (
                    <KV label={tr('pay.lop')} value={String(a.lopDays)} />
                  ) : null}
                </Card>
              ) : null}
              <Card>
                <Eyebrow>{tr('sal.earnings')}</Eyebrow>
                {earn.map((l) => (
                  <KV key={l.code} label={l.name} value={m(l.amountMinor)} />
                ))}
                <Divider />
                <KV label={tr('pay.gross')} value={m(p.grossMinor)} bold />
              </Card>
              {ded.length ? (
                <Card>
                  <Eyebrow>{tr('sal.deductions')}</Eyebrow>
                  {ded.map((l) => (
                    <KV key={l.code} label={l.name} value={m(l.amountMinor)} />
                  ))}
                  <Divider />
                  <KV label={tr('pay.deductions')} value={m(p.deductionsMinor)} bold />
                </Card>
              ) : null}
              <Button
                title={tr('common.share')}
                variant="secondary"
                onPress={() => void Share.share({ message: text(p) })}
              />
            </>
          );
        }}
      </QueryGate>
    </Screen>
  );
}
