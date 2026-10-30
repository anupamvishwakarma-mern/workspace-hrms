import { useRouter } from 'expo-router';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Chip, QueryGate } from '@/components/state';
import { Badge, Body, Button, Card, EmptyState, toneForStatus } from '@/components/ui';
import { HBars, Panel } from '@/components/charts';
import { useHolidays, useLeaveBalances, useMyLeaveRequests } from '@/hooks/queries';
import { useTheme } from '@/theme';
import { rangeText } from './shared';

type Filter = 'PENDING' | 'APPROVED' | 'ALL';

/** The leave part of the employee Requests tab: balances, apply, and every request with its status. */
export default function EmployeeLeave() {
  const t = useTheme();
  const router = useRouter();
  const year = DateTime.now().year;
  const bal = useLeaveBalances(year);
  const reqs = useMyLeaveRequests();
  const hol = useHolidays(
    DateTime.now().toISODate()!,
    DateTime.now().plus({ days: 90 }).toISODate()!,
  );
  const [filter, setFilter] = useState<Filter>('PENDING');
  return (
    <View style={{ gap: 14 }}>
      <Button title="Apply for leave" onPress={() => router.push('/hr/leave-apply' as never)} />
      <Panel title="Balances" sub={String(year)}>
        <QueryGate q={bal}>
          {(rows) => (
            <HBars
              rows={rows.map((b) => ({
                name: b.name,
                value: b.allowanceDays ? (b.remainingDays ?? 0) : b.approvedDays,
                text: b.allowanceDays
                  ? `${b.remainingDays ?? 0} of ${b.allowanceDays} left`
                  : 'No cap',
              }))}
              max={Math.max(1, ...rows.map((b) => b.allowanceDays ?? 0))}
            />
          )}
        </QueryGate>
      </Panel>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['PENDING', 'APPROVED', 'ALL'] as const).map((f) => (
          <Chip
            key={f}
            label={f === 'ALL' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
            on={filter === f}
            onPress={() => setFilter(f)}
          />
        ))}
      </View>
      <QueryGate q={reqs}>
        {(rows) => {
          const list = rows.filter((r) => filter === 'ALL' || r.status === filter);
          return list.length === 0 ? (
            <EmptyState
              title="No leave requests here"
              hint="Apply for leave and it will show up with its status."
            />
          ) : (
            list.map((r) => (
              <Card key={r.id}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={{ color: t.text, fontWeight: '800' }}>
                    {rangeText(r.startDate, r.endDate)} · {r.leaveType?.name ?? 'Leave'}
                  </Text>
                  <Badge
                    label={r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                    tone={toneForStatus(r.status)}
                  />
                </View>
                <Body small muted>
                  {r.days} day{r.days === 1 ? '' : 's'}
                  {r.halfDay ? ' (half day)' : ''}
                </Body>
                {r.reviewComment ? (
                  <Body small muted>
                    Reviewer: {r.reviewComment}
                  </Body>
                ) : null}
              </Card>
            ))
          );
        }}
      </QueryGate>
      <Panel title="Upcoming holidays">
        {(hol.data ?? []).length === 0 ? (
          <Body muted small>
            No holidays in the next 90 days.
          </Body>
        ) : (
          (hol.data ?? []).slice(0, 4).map((h) => (
            <View
              key={h.id}
              style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}
            >
              <Text style={{ color: t.text, fontWeight: '600' }}>{h.name}</Text>
              <Text style={{ color: t.muted }}>
                {DateTime.fromISO(h.date.slice(0, 10)).toFormat('ccc, d LLL')}
              </Text>
            </View>
          ))
        )}
      </Panel>
      <Button
        title="Open full leave page"
        variant="ghost"
        onPress={() => router.push('/hr/leave' as never)}
      />
    </View>
  );
}
