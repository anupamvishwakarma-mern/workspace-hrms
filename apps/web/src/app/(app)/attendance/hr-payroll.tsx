'use client';
import { Card, CardTitle, Empty, Skeleton } from '@/components/ui/display';
import { useAuth } from '@/components/auth';
import { useList } from '@/hooks/api';
import type { AuditEntry } from '@/lib/types';
import { cn, formatDate, label } from '@/lib/utils';
import { useApprovalQueue, useExceptionItems } from './hr-data';

export function PayrollReadiness({
  from,
  to,
  selfId,
  monthName,
}: {
  from: string;
  to: string;
  selfId?: string;
  monthName: string;
}) {
  const ex = useExceptionItems(from, to);
  const q = useApprovalQueue(selfId);
  const by = (k: string) => q.items.filter((i) => i.kind === k).length;
  const rows: [string, number, string][] = [
    ['Exceptions resolved', ex.total, 'open'],
    ['Regularization requests approved', by('correction'), 'waiting'],
    ['Leave approvals up to date', by('leave'), 'waiting'],
    ['Location approvals cleared', by('location'), 'waiting'],
  ];
  const loading = ex.isPending || q.isPending;
  const ready = !loading && rows.every(([, n]) => n === 0);
  return (
    <Card>
      <CardTitle className="text-base text-foreground">{monthName} payroll readiness</CardTitle>
      <p className="mb-2 text-xs text-muted">
        Clear these before payroll uses this month&apos;s attendance. Items outside your approval
        scope are not counted.
      </p>
      {loading ? (
        <Skeleton className="h-28" />
      ) : (
        <>
          <ul className="divide-y divide-border text-sm">
            {rows.map(([k, n, w]) => (
              <li key={k} className="flex items-center justify-between gap-3 py-2.5">
                <span>{k}</span>
                <span
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                    n ? 'bg-warn-bg text-warn' : 'bg-success-bg text-success',
                  )}
                >
                  {n ? `${n} ${w}` : 'Done'}
                </span>
              </li>
            ))}
          </ul>
          <p className={cn('mt-3 text-sm font-medium', ready ? 'text-success' : 'text-warn')}>
            {ready
              ? 'Attendance is ready for payroll.'
              : 'Some items are still open, so payroll should wait.'}
          </p>
        </>
      )}
    </Card>
  );
}

export function AuditTrail() {
  const { can } = useAuth();
  const q = useList<AuditEntry>('audit', '/audit-logs', { limit: 50 }, can('audit:read'));
  const rows = (q.data?.data ?? [])
    .filter((e) => e.action.startsWith('attendance.') || e.action.startsWith('report.'))
    .slice(0, 6);
  return (
    <Card>
      <CardTitle className="text-base text-foreground">Audit trail</CardTitle>
      <p className="mb-2 text-xs text-muted">Every manual change to attendance is logged</p>
      {q.isPending ? (
        <Skeleton className="h-28" />
      ) : rows.length === 0 ? (
        <Empty>No attendance changes logged yet.</Empty>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {rows.map((e) => (
            <li key={e.id} className="py-2.5">
              <p className="font-medium">{label(e.action.split('.')[1] ?? e.action)}</p>
              <p className="text-xs text-muted">
                {e.actorEmail ?? 'System'} · {formatDate(e.createdAt)}
                {e.reason ? ` · ${e.reason}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
