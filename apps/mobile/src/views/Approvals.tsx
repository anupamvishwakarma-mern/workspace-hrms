import { useState } from 'react';
import { Text, View } from 'react-native';
import { useAuth } from '@/auth/AuthProvider';
import { Chip, QueryGate } from '@/components/state';
import {
  Avatar,
  Badge,
  Banner,
  Body,
  Button,
  Card,
  EmptyState,
  Field,
  PageHeader,
  Screen,
  Segmented,
} from '@/components/ui';
import { KpiGrid, Kpi } from '@/components/charts';
import {
  useDecision,
  useReviewCorrections,
  useReviewExceptions,
  useReviewLeave,
  type DecisionKind,
} from '@/hooks/insights';
import { userMessage } from '@/lib/errors';
import { formatTime } from '@/lib/format';
import { useTheme } from '@/theme';
import { WINDOW_DAYS, daysSince, personName, rangeText } from './shared';

type Kind = 'leave' | 'correction' | 'exception';
const STATUS = ['PENDING', 'APPROVED', 'REJECTED'] as const;

/** HR and managers: decide leave, correction and location requests. You cannot decide your own. */
export default function Approvals({ scopeLabel }: { scopeLabel: string }) {
  const { active } = useAuth();
  const [kind, setKind] = useState<Kind>('leave');
  const [status, setStatus] = useState<(typeof STATUS)[number]>('PENDING');
  const leave = useReviewLeave({ status });
  const corr = useReviewCorrections(status);
  const exc = useReviewExceptions(status);
  const waitingLeave = useReviewLeave({ status: 'PENDING' });
  const waitingCorr = useReviewCorrections('PENDING');
  const waitingExc = useReviewExceptions('PENDING');
  const decide = useDecision();
  const [rejecting, setRejecting] = useState<string>();
  const [comment, setComment] = useState('');
  const mine = active?.employeeId;
  const n = (q: { data?: unknown[] }) => q.data?.length ?? 0;

  const act = (k: DecisionKind, id: string, action: 'approve' | 'reject', c?: string) =>
    decide.mutate(
      { kind: k, id, action, comment: c },
      {
        onSuccess: () => {
          setRejecting(undefined);
          setComment('');
        },
      },
    );

  const Actions = ({ k, id, own }: { k: DecisionKind; id: string; own: boolean }) =>
    status !== 'PENDING' ? null : own ? (
      <Body muted small>
        Your own request goes to someone else.
      </Body>
    ) : rejecting === id ? (
      <View style={{ gap: 8 }}>
        <Field
          label="Why are you rejecting?"
          value={comment}
          onChangeText={setComment}
          multiline
          maxLength={500}
        />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button title="Cancel" variant="secondary" onPress={() => setRejecting(undefined)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title="Reject"
              variant="danger"
              loading={decide.isPending}
              disabled={comment.trim().length < 3}
              onPress={() => act(k, id, 'reject', comment)}
            />
          </View>
        </View>
      </View>
    ) : (
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button
            title="Approve"
            loading={decide.isPending && decide.variables?.id === id}
            onPress={() => act(k, id, 'approve')}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            title="Reject"
            variant="secondary"
            onPress={() => {
              setRejecting(id);
              setComment('');
            }}
          />
        </View>
      </View>
    );

  const t = useTheme();
  const head = (name: string, sub: string, right?: React.ReactNode) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Avatar name={name} size={40} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontWeight: '800' }}>{name}</Text>
        <Body muted small>
          {sub}
        </Body>
      </View>
      {right}
    </View>
  );

  return (
    <Screen
      onRefresh={() => {
        void leave.refetch();
        void corr.refetch();
        void exc.refetch();
      }}
      refreshing={leave.isRefetching}
    >
      <PageHeader title="Approvals" subtitle={scopeLabel} />
      <KpiGrid>
        <Kpi
          label="Leave"
          value={n(waitingLeave)}
          tone={n(waitingLeave) ? 'warn' : 'success'}
          sub="waiting"
        />
        <Kpi
          label="Corrections"
          value={n(waitingCorr)}
          tone={n(waitingCorr) ? 'warn' : 'success'}
          sub="waiting"
        />
        <Kpi
          label="Locations"
          value={n(waitingExc)}
          tone={n(waitingExc) ? 'warn' : 'success'}
          sub="waiting"
        />
      </KpiGrid>
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { key: 'leave', label: `Leave ${n(waitingLeave)}` },
          { key: 'correction', label: `Punches ${n(waitingCorr)}` },
          { key: 'exception', label: `Location ${n(waitingExc)}` },
        ]}
      />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {STATUS.map((s) => (
          <Chip
            key={s}
            label={s.charAt(0) + s.slice(1).toLowerCase()}
            on={status === s}
            onPress={() => setStatus(s)}
          />
        ))}
      </View>
      {decide.error ? <Banner tone="danger">{userMessage(decide.error)}</Banner> : null}

      {kind === 'leave' ? (
        <QueryGate q={leave}>
          {(rows) =>
            rows.length === 0 ? (
              <EmptyState
                title={status === 'PENDING' ? 'All caught up' : 'Nothing here'}
                hint={status === 'PENDING' ? 'No leave is waiting for you.' : undefined}
              />
            ) : (
              rows.map((r) => {
                const waited = daysSince(r.createdAt);
                return (
                  <Card key={r.id}>
                    {head(
                      personName(r.employee),
                      `${r.leaveType?.name ?? 'Leave'} · ${rangeText(r.startDate, r.endDate)} · ${r.days} day${r.days === 1 ? '' : 's'}${r.halfDay ? ' (half)' : ''}`,
                      status === 'PENDING' ? (
                        <Badge
                          label={
                            waited > WINDOW_DAYS
                              ? `Waiting ${waited}d`
                              : waited === 0
                                ? 'Today'
                                : `${waited}d`
                          }
                          tone={waited > WINDOW_DAYS ? 'warn' : 'neutral'}
                        />
                      ) : (
                        <Badge
                          label={r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                          tone={r.status === 'APPROVED' ? 'success' : 'danger'}
                        />
                      ),
                    )}
                    {r.reason ? <Body small>{r.reason}</Body> : null}
                    {r.reviewComment ? (
                      <Body small muted>
                        Reviewer: {r.reviewComment}
                      </Body>
                    ) : null}
                    <Actions k="leave" id={r.id} own={r.employeeId === mine} />
                  </Card>
                );
              })
            )
          }
        </QueryGate>
      ) : null}

      {kind === 'correction' ? (
        <QueryGate q={corr}>
          {(rows) =>
            rows.length === 0 ? (
              <EmptyState title={status === 'PENDING' ? 'All caught up' : 'Nothing here'} />
            ) : (
              rows.map((r) => (
                <Card key={r.id}>
                  {head(
                    personName(r.employee),
                    `Correction for ${r.workDate}`,
                    <Badge
                      label={r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                      tone={
                        r.status === 'APPROVED'
                          ? 'success'
                          : r.status === 'REJECTED'
                            ? 'danger'
                            : 'warn'
                      }
                    />,
                  )}
                  <Body small>
                    In {formatTime(r.requestedChanges?.checkIn, 'UTC')} · Out{' '}
                    {formatTime(r.requestedChanges?.checkOut, 'UTC')}
                  </Body>
                  <Body small>{r.reason}</Body>
                  <Actions k="correction" id={r.id} own={r.employeeId === mine} />
                </Card>
              ))
            )
          }
        </QueryGate>
      ) : null}

      {kind === 'exception' ? (
        <QueryGate q={exc}>
          {(rows) =>
            rows.length === 0 ? (
              <EmptyState title={status === 'PENDING' ? 'All caught up' : 'Nothing here'} />
            ) : (
              rows.map((r) => (
                <Card key={r.id}>
                  {head(
                    personName(r.employee),
                    `${r.eventType.replace('_', ' ').toLowerCase()} · ${formatTime(r.occurredAt, 'UTC')}`,
                    <Badge
                      label={r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                      tone={
                        r.status === 'APPROVED'
                          ? 'success'
                          : r.status === 'REJECTED'
                            ? 'danger'
                            : 'warn'
                      }
                    />,
                  )}
                  {r.failure ? (
                    <Body small muted>
                      {r.failure.replace(/_/g, ' ').toLowerCase()}
                    </Body>
                  ) : null}
                  {r.employeeReason ? <Body small>{r.employeeReason}</Body> : null}
                  <Actions k="exception" id={r.id} own={false} />
                </Card>
              ))
            )
          }
        </QueryGate>
      ) : null}
    </Screen>
  );
}
