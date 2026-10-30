'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Avatar, Badge, Empty, Skeleton } from '@/components/ui/display';
import type { LeaveRequest } from '@/lib/types';
import { daysSince, eachDate, fullName, rangeText, WINDOW_DAYS } from './data';
import { RejectModal, useDecision } from './parts';

/** Others (besides the requester) already off on any day of the request. */
export const overlapOf = (r: LeaveRequest, off: Map<string, Set<string>>) => {
  let max = 0;
  for (const d of eachDate(r.startDate, r.endDate)) {
    const s = off.get(d);
    if (!s) continue;
    max = Math.max(max, s.size - (s.has(r.employeeId) ? 1 : 0));
  }
  return max;
};

/** Pending requests with approve / reject. `off` is date -> employees off, to show clashes. */
export function ApprovalsPanel({
  reqs,
  off,
  loading,
  canDecide = (_r: LeaveRequest) => true,
}: {
  reqs: LeaveRequest[];
  off: Map<string, Set<string>>;
  loading?: boolean;
  /** e.g. nobody approves their own request */
  canDecide?: (r: LeaveRequest) => boolean;
}) {
  const { approve, reject } = useDecision();
  const [rejecting, setRejecting] = useState<LeaveRequest>();
  if (loading) return <Skeleton className="h-40" />;
  if (reqs.length === 0) return <Empty>Nothing waiting for approval.</Empty>;
  return (
    <div className="space-y-3">
      {approve.error ? <Alert tone="danger">{approve.error}</Alert> : null}
      <ul className="space-y-2">
        {reqs.map((r) => {
          const waited = daysSince(r.createdAt);
          const clash = overlapOf(r, off);
          const name = fullName(r.employee);
          return (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={name} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{name}</p>
                  <p className="text-xs text-muted">
                    {r.leaveType?.name ?? 'Leave'} · {rangeText(r.startDate, r.endDate)} · {r.days}{' '}
                    {r.days === 1 ? 'day' : 'days'}
                    {r.halfDay
                      ? ` (${r.halfDaySession === 'SECOND' ? 'second' : 'first'} half)`
                      : ''}
                  </p>
                  {r.reason ? <p className="mt-0.5 truncate text-xs">{r.reason}</p> : null}
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge tone={waited > WINDOW_DAYS ? 'warn' : 'neutral'}>
                      {waited === 0 ? 'Today' : `Waiting ${waited}d`}
                    </Badge>
                    {clash > 0 ? (
                      <Badge tone="warn">
                        {clash} other{clash > 1 ? 's' : ''} off
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </div>
              {canDecide(r) ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setRejecting(r)}>
                    Reject
                  </Button>
                  <Button
                    size="sm"
                    loading={approve.isPending && approve.variables?.r.id === r.id}
                    onClick={() => approve.mutate({ r })}
                  >
                    Approve
                  </Button>
                </div>
              ) : (
                <span className="text-xs text-muted">Your own request goes to someone else.</span>
              )}
            </li>
          );
        })}
      </ul>
      {rejecting ? (
        <RejectModal
          r={rejecting}
          name={fullName(rejecting.employee)}
          reject={reject}
          onClose={() => setRejecting(undefined)}
        />
      ) : null}
    </div>
  );
}
