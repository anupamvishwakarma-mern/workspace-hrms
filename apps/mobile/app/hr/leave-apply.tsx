import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Chip, QueryGate } from '@/components/state';
import {
  Banner,
  Body,
  Button,
  Card,
  EmptyState,
  Eyebrow,
  Field,
  Screen,
  Segmented,
} from '@/components/ui';
import { useLeaveBalances, useToday } from '@/hooks/queries';
import { todayInZone } from '@/lib/calendar';
import { api } from '@/lib/client';
import { userMessage } from '@/lib/errors';
import { useT } from '@/prefs';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default function LeaveApply() {
  const tr = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const tz = useToday().data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const todayIso = todayInZone(tz);
  const bal = useLeaveBalances(Number(todayIso.slice(0, 4)));
  const [typeId, setTypeId] = useState<string>();
  const [start, setStart] = useState(todayIso);
  const [end, setEnd] = useState(todayIso);
  const [half, setHalf] = useState(false);
  const [session, setSession] = useState<'FIRST' | 'SECOND'>('FIRST');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();

  const send = useMutation({
    mutationFn: async () => {
      const endDate = half ? start : end;
      return api.call({
        method: 'POST',
        path: '/leave/requests',
        body: {
          leaveTypeId: typeId,
          startDate: start,
          endDate,
          halfDay: half,
          ...(half ? { halfDaySession: session } : {}),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        },
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['leave-requests'] });
      void qc.invalidateQueries({ queryKey: ['leave-balances'] });
      router.back();
    },
    onError: (e) => setError(userMessage(e)),
  });

  const submit = () => {
    setError(undefined);
    if (!typeId) return setError(tr('leave.type'));
    if (!DATE.test(start) || (!half && !DATE.test(end))) return setError(tr('leave.dateHint'));
    if (!half && end < start) return setError(tr('leave.dateOrder'));
    send.mutate();
  };

  return (
    <Screen underHeader>
      <QueryGate q={bal}>
        {(types) =>
          types.length === 0 ? (
            <EmptyState title={tr('leave.noTypes')} />
          ) : (
            <Card>
              {error ? <Banner tone="danger">{error}</Banner> : null}
              <Eyebrow>{tr('leave.type')}</Eyebrow>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {types.map((b) => (
                  <Chip
                    key={b.leaveTypeId}
                    label={b.name}
                    on={typeId === b.leaveTypeId}
                    onPress={() => setTypeId(b.leaveTypeId)}
                  />
                ))}
              </View>
              <Field
                label={tr('leave.from')}
                value={start}
                onChangeText={setStart}
                autoCapitalize="none"
                keyboardType="numbers-and-punctuation"
              />
              {!half ? (
                <Field
                  label={tr('leave.to')}
                  value={end}
                  onChangeText={setEnd}
                  autoCapitalize="none"
                  keyboardType="numbers-and-punctuation"
                />
              ) : null}
              <Segmented
                value={half ? 'half' : 'full'}
                onChange={(k) => setHalf(k === 'half')}
                options={[
                  { key: 'full', label: tr('common.day') },
                  { key: 'half', label: tr('common.halfDay') },
                ]}
              />
              {half ? (
                <Segmented
                  value={session}
                  onChange={setSession}
                  options={[
                    { key: 'FIRST', label: tr('leave.first') },
                    { key: 'SECOND', label: tr('leave.second') },
                  ]}
                />
              ) : null}
              <Field
                label={tr('leave.reason')}
                value={reason}
                onChangeText={setReason}
                multiline
                maxLength={500}
              />
              <Button title={tr('leave.submit')} loading={send.isPending} onPress={submit} />
              <Body muted small>
                {tr('leave.approvalNote')}
              </Body>
            </Card>
          )
        }
      </QueryGate>
    </Screen>
  );
}
