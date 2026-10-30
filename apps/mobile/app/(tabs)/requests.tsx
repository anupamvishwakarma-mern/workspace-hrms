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
import Approvals from '@/views/Approvals';
import EmployeeLeave from '@/views/EmployeeLeave';
import OwnerOversight from '@/views/OwnerOversight';
import { useView } from '@/workspace';

type Tab = 'leave' | 'corrections' | 'exceptions';

/** Requests: HR and managers decide them, owners watch the queue, employees track their own. */
export default function Requests() {
  const { view } = useView();
  if (view === 'hr')
    return <Approvals scopeLabel="Leave, corrections and location requests across the company." />;
  if (view === 'manager')
    return <Approvals scopeLabel="Requests from your team. Approve within 2 working days." />;
  if (view === 'owner') return <OwnerOversight />;
  return <MyRequests />;
}

function MyRequests() {
  const tr = useT();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('leave');
  const corrections = useMyCorrections();
  const exceptions = useMyExceptions();
  const tz = useToday().data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const q = tab === 'exceptions' ? exceptions : corrections;

  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <PageHeader title={tr('tab.requests')} subtitle={tr('req.subtitle')} />
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { key: 'leave', label: 'Leave' },
          { key: 'corrections', label: tr('req.corrections') },
          { key: 'exceptions', label: tr('req.locationApprovals') },
        ]}
      />

      {tab === 'leave' ? <EmployeeLeave /> : null}

      {tab === 'leave' ? null : tab === 'corrections' ? (
        <Button title={tr('req.new')} onPress={() => router.push('/correction/new')} />
      ) : (
        <Body muted small>
          {tr('req.locationHint')}
        </Body>
      )}

      {tab !== 'leave' && q.isPending ? <Loading /> : null}
      {tab !== 'leave' && q.isError ? <Banner tone="danger">{userMessage(q.error)}</Banner> : null}

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
