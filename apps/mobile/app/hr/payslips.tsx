import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { QueryGate } from '@/components/state';
import { Body, Card, EmptyState, Screen } from '@/components/ui';
import { useMyPayslips } from '@/hooks/queries';
import { monthTitle } from '@/lib/calendar';
import { formatMoney } from '@/lib/money';
import { usePrefs } from '@/prefs';

export default function Payslips() {
  const { t: tr, lang } = usePrefs();
  const router = useRouter();
  const q = useMyPayslips();
  return (
    <Screen underHeader onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Body muted>{tr('pay.subtitle')}</Body>
      <QueryGate q={q}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState title={tr('pay.none')} hint={tr('pay.noneHint')} />
          ) : (
            list.map((p) => (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                accessibilityLabel={monthTitle(p.month, lang)}
                onPress={() => router.push({ pathname: '/hr/payslip', params: { id: p.id } })}
              >
                <Card>
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <Body bold>{monthTitle(p.month, lang)}</Body>
                    <Body bold>{formatMoney(p.netMinor, p.currency)}</Body>
                  </View>
                  <Body muted small>
                    {tr('pay.gross')} {formatMoney(p.grossMinor, p.currency)} ·{' '}
                    {tr('pay.deductions')} {formatMoney(p.deductionsMinor, p.currency)}
                  </Body>
                </Card>
              </Pressable>
            ))
          )
        }
      </QueryGate>
    </Screen>
  );
}
