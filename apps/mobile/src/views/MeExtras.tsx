import { Body, Button, Card } from '@/components/ui';
import { Line, Panel } from '@/components/charts';
import { useLeaveOverview } from '@/hooks/insights';
import { useView } from '@/workspace';
import { WINDOW_DAYS, thisMonth } from './shared';

/** What differs by role on the More tab: switch workspace, and the rules that matter to your job. */
export default function MeExtras() {
  const { base, view, canSwitch, self, setSelf } = useView();
  const policy = useLeaveOverview(thisMonth(), base === 'owner' || base === 'hr');
  return (
    <>
      {canSwitch ? (
        <Card>
          <Body bold>My own workspace</Body>
          <Body muted small>
            {self
              ? 'You are working as an employee: punch, leave, pay and profile.'
              : `You are in the ${base === 'hr' ? 'HR' : base} view. Switch to punch in and see your own leave and pay.`}
          </Body>
          <Button
            title={self ? `Back to ${base === 'hr' ? 'HR' : base} view` : 'Switch to my workspace'}
            variant="secondary"
            onPress={() => setSelf(!self)}
          />
        </Card>
      ) : null}

      {view === 'manager' ? (
        <Panel title="Approval rules" sub="How slow approvals are flagged">
          <Line label="Approval window" value={`${WINDOW_DAYS} working days`} />
          <Line label="After the window" value="Escalates to HR" />
          <Line label="Crowded-day alert" value="30% of team off" />
        </Panel>
      ) : null}

      {(view === 'owner' || view === 'hr') && policy.data ? (
        <Panel
          title="Policy snapshot"
          sub={
            view === 'owner'
              ? 'Read-only. HR maintains the rules.'
              : 'Leave types and yearly allowance'
          }
        >
          {policy.data.policy.map((p) => (
            <Line
              key={p.id}
              label={`${p.name}${p.paid ? '' : ' (unpaid)'}`}
              value={p.annualAllowanceDays === 0 ? 'No cap' : `${p.annualAllowanceDays} days`}
            />
          ))}
          <Line label="Approval window" value={`${WINDOW_DAYS} working days`} />
        </Panel>
      ) : null}
    </>
  );
}
