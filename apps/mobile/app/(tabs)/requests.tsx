import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import {
  Badge,
  Banner,
  Body,
  Button,
  Card,
  EmptyState,
  Loading,
  PageHeader,
  Screen,
  Segmented,
  toneForStatus,
} from '@/components/ui';
import { useMyCorrections, useMyExceptions, useToday } from '@/hooks/queries';
import { userMessage } from '@/lib/errors';
import { EVENT_LABEL, formatTime, formatWorkDate } from '@/lib/format';
import { useT } from '@/prefs';

type Tab = 'corrections' | 'exceptions';

export default function Requests() {
  const tr = useT();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('corrections');
  const corrections = useMyCorrections();
  const exceptions = useMyExceptions();
  const tz = useToday().data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const q = tab === 'corrections' ? corrections : exceptions;

  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <PageHeader title={tr('tab.requests')} subtitle={tr('req.subtitle')} />
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { key: 'corrections', label: tr('req.corrections') },
          { key: 'exceptions', label: tr('req.locationApprovals') },
        ]}
      />

      {tab === 'corrections' ? (
        <Button title={tr('req.new')} onPress={() => router.push('/correction/new')} />
      ) : (
        <Body muted small>
          {tr('req.locationHint')}
        </Body>
      )}

      {q.isPending ? <Loading /> : null}
      {q.isError ? <Banner tone="danger">{userMessage(q.error)}</Banner> : null}

      {tab === 'corrections' && corrections.data ? (
        corrections.data.length === 0 ? (
          <EmptyState title={tr('req.none')} hint={tr('req.noneHint')} />
        ) : (
          corrections.data.map((c) => (
            <Card key={c.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Body bold>{formatWorkDate(c.workDate)}</Body>
                <Badge
                  label={c.status.charAt(0) + c.status.slice(1).toLowerCase()}
                  tone={toneForStatus(c.status)}
                />
              </View>
              <Body small muted>
                In {formatTime(c.requestedChanges?.checkIn, tz)} · Out{' '}
                {formatTime(c.requestedChanges?.checkOut, tz)}
              </Body>
              <Body small>{c.reason}</Body>
              {c.reviewComment ? (
                <Body small muted>
                  Reviewer: {c.reviewComment}
                </Body>
              ) : null}
            </Card>
          ))
        )
      ) : null}

      {tab === 'exceptions' && exceptions.data ? (
        exceptions.data.length === 0 ? (
          <EmptyState title={tr('req.noLocation')} />
        ) : (
          exceptions.data.map((x) => (
            <Card key={x.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Body bold>
                  {EVENT_LABEL[x.eventType]} · {formatTime(x.occurredAt, tz)}
                </Body>
                <Badge
                  label={x.status.charAt(0) + x.status.slice(1).toLowerCase()}
                  tone={toneForStatus(x.status)}
                />
              </View>
              {x.employeeReason ? <Body small>{x.employeeReason}</Body> : null}
              {x.reviewComment ? (
                <Body small muted>
                  Reviewer: {x.reviewComment}
                </Body>
              ) : null}
            </Card>
          ))
        )
      ) : null}
    </Screen>
  );
}
