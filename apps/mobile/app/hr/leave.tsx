import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Alert, View } from 'react-native';
import { KV, QueryGate } from '@/components/state';
import { Badge, Body, Button, Card, EmptyState, Eyebrow, Screen } from '@/components/ui';
import { useLeaveBalances, useMyLeaveRequests, useToday } from '@/hooks/queries';
import type { Key } from '@/i18n';
import { todayInZone } from '@/lib/calendar';
import { api } from '@/lib/client';
import { userMessage } from '@/lib/errors';
import { formatWorkDate } from '@/lib/format';
import { useT } from '@/prefs';
import { useTheme } from '@/theme';
import { Text } from 'react-native';

const tone = {
  PENDING: 'warn',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
} as const;

export default function Leave() {
  const t = useTheme();
  const tr = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const tz = useToday().data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const year = Number(todayInZone(tz).slice(0, 4));
  const bal = useLeaveBalances(year);
  const reqs = useMyLeaveRequests();

  const cancel = useMutation({
    mutationFn: async (id: string) =>
      api.call({ method: 'POST', path: `/leave/requests/${id}/cancel`, body: {} }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['leave-requests'] });
      void qc.invalidateQueries({ queryKey: ['leave-balances'] });
    },
    onError: (e) => Alert.alert(tr('page.leave'), userMessage(e)),
  });

  return (
    <Screen
      underHeader
      onRefresh={() => {
        void bal.refetch();
        void reqs.refetch();
      }}
      refreshing={bal.isRefetching}
    >
      <Body muted>{tr('leave.subtitle', { year })}</Body>
      <Button title={tr('leave.apply')} onPress={() => router.push('/hr/leave-apply')} />

      <Eyebrow>{tr('leave.balances')}</Eyebrow>
      <QueryGate q={bal}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState title={tr('leave.noTypes')} />
          ) : (
            list.map((b) => (
              <Card key={b.leaveTypeId}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Body bold>{b.name}</Body>
                  {!b.paid ? <Badge label={tr('leave.unpaid')} tone="neutral" /> : null}
                </View>
                <Text style={{ color: t.primary, fontSize: 28, fontWeight: '800' }}>
                  {b.remainingDays === null
                    ? tr('leave.unlimited')
                    : tr('leave.remaining', { n: b.remainingDays })}
                </Text>
                <KV
                  label={tr('leave.used', { n: b.approvedDays })}
                  value={b.allowanceDays === null ? '' : `/ ${b.allowanceDays}`}
                />
                {b.pendingDays ? (
                  <Body muted small>
                    {tr('leave.pending', { n: b.pendingDays })}
                  </Body>
                ) : null}
              </Card>
            ))
          )
        }
      </QueryGate>

      <Eyebrow>{tr('leave.requests')}</Eyebrow>
      <QueryGate q={reqs}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState title={tr('leave.noRequests')} />
          ) : (
            list.map((r) => (
              <Card key={r.id}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Body bold>{r.leaveType?.name ?? '—'}</Body>
                  <Badge label={tr(`leave.status.${r.status}` as Key)} tone={tone[r.status]} />
                </View>
                <Body muted small>
                  {formatWorkDate(r.startDate.slice(0, 10))}
                  {r.endDate.slice(0, 10) !== r.startDate.slice(0, 10)
                    ? ` → ${formatWorkDate(r.endDate.slice(0, 10))}`
                    : ''}
                  {' · '}
                  {r.halfDay
                    ? tr('common.halfDay')
                    : r.days === 1
                      ? tr('common.day')
                      : tr('common.days', { n: r.days })}
                </Body>
                {r.reason ? <Body small>{r.reason}</Body> : null}
                {r.reviewComment ? (
                  <Body muted small>
                    {r.reviewComment}
                  </Body>
                ) : null}
                {r.status === 'PENDING' ? (
                  <Button
                    title={tr('leave.cancel')}
                    variant="ghost"
                    loading={cancel.isPending && cancel.variables === r.id}
                    onPress={() =>
                      Alert.alert(tr('leave.cancelTitle'), tr('leave.cancelBody'), [
                        { text: tr('common.cancel'), style: 'cancel' },
                        {
                          text: tr('leave.cancel'),
                          style: 'destructive',
                          onPress: () => cancel.mutate(r.id),
                        },
                      ])
                    }
                  />
                ) : null}
              </Card>
            ))
          )
        }
      </QueryGate>
    </Screen>
  );
}
