import { Body, PageHeader, Screen } from '@/components/ui';
import { QueryGate } from '@/components/state';
import { HBars, Kpi, KpiGrid, Line, Panel } from '@/components/charts';
import { useAttOverview, useLeaveOverview } from '@/hooks/insights';
import { thisMonth } from './shared';

/** Owner: how decisions are going. Owners watch the queue; HR and managers decide. */
export default function OwnerOversight() {
  const m = thisMonth();
  const att = useAttOverview(m);
  const leave = useLeaveOverview(m);
  return (
    <Screen
      onRefresh={() => {
        void att.refetch();
        void leave.refetch();
      }}
      refreshing={att.isRefetching}
    >
      <PageHeader
        title="Decisions"
        subtitle="Waiting and overdue approvals. HR and managers make these decisions."
      />
      <QueryGate q={att}>
        {(a) => (
          <>
            <KpiGrid>
              <Kpi
                label="Approvals overdue"
                value={a.attention.overdueApprovals.count}
                tone={a.attention.overdueApprovals.count ? 'warn' : 'success'}
                sub={`Waiting over ${a.attention.overdueApprovals.days} days`}
              />
              <Kpi
                label="Open location exceptions"
                value={a.compliance.openLocationExceptions}
                sub="Punches outside the geofence"
              />
            </KpiGrid>
            <Panel title="Leave queue" sub="Across the company">
              {leave.data ? (
                <>
                  <Line
                    label="Requests past the approval window"
                    value={leave.data.attention.pastWindow.count}
                  />
                  <Line
                    label="Employees with high unused leave"
                    value={leave.data.attention.highUnused.count}
                  />
                  <Line label="Negative balances" value={leave.data.attention.negativeBalances} />
                  <Line
                    label="Teams with a crowded week ahead"
                    value={leave.data.attention.crowdedTeams.names.length}
                  />
                </>
              ) : (
                <Body muted small>
                  Loading…
                </Body>
              )}
            </Panel>
            <Panel title="Coverage watch" sub="Weeks with 15% or more of a team on leave">
              <HBars
                rows={(leave.data?.coverage ?? []).map((c) => ({
                  name: `${c.department} · week of ${c.weekStart.slice(5)}`,
                  value: c.pct,
                  text: `${c.off}/${c.headcount} (${c.pct}%)`,
                  tone: 'warn' as const,
                }))}
                max={100}
              />
            </Panel>
          </>
        )}
      </QueryGate>
    </Screen>
  );
}
