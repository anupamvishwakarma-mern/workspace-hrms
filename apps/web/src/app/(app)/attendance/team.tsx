'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import {
  Alert,
  Avatar,
  Card,
  CardTitle,
  Empty,
  Skeleton,
  Table,
  Td,
  Th,
} from '@/components/ui/display';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { useAuth } from '@/components/auth';
import { useList, useOne, useSave } from '@/hooks/api';
import { useDepartments } from '@/hooks/lookups';
import { api } from '@/lib/api';
import type { Correction, DayRow, TeamToday } from '@/lib/types';
import { cn, formatDate, formatTime } from '@/lib/utils';
import { CAL, dayKey, shortDate } from './lib';

type Req = Correction & {
  employee?: { firstName: string; lastName: string; employeeCode: string };
};

export function TeamSection({
  today,
  tz,
  selfId,
  onDetail,
}: {
  today: string;
  tz: string;
  selfId?: string;
  onDetail: (id: string) => void;
}) {
  const { can } = useAuth();
  const [date, setDate] = useState(today);
  const [departmentId, setDepartmentId] = useState('');
  const depts = useDepartments();
  const teamToday = useOne<TeamToday>('team-today', '/team/today');
  const days = useList<DayRow>('team-days', '/attendance/days', {
    from: date,
    to: date,
    departmentId,
    limit: 100,
  });
  const deptName = depts.items.find((d) => d.id === departmentId)?.name;
  const isToday = date === today;

  const dayBy = new Map(
    (days.data?.data ?? []).map((d) => [d.employee?.employeeCode ?? d.employeeId, d]),
  );
  const members = (teamToday.data?.data.members ?? []).filter(
    (m) => !deptName || m.department === deptName,
  );

  const rows = members.map((m) => {
    const day = dayBy.get(m.employeeCode);
    let status = day ? CAL[dayKey(day)] : undefined;
    if (!day && isToday) {
      if (m.status === 'ON_LEAVE') status = CAL.ON_LEAVE;
      else if (m.status === 'WORKING' || m.status === 'ON_BREAK') status = CAL.WORKING;
    }
    return { m, day, status };
  });
  const countOf = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  const inKeys = ['PRESENT', 'LATE', 'HALF_DAY', 'WORKING', 'INCOMPLETE'];
  const stat = [
    ['Team size', rows.length],
    [
      'Present',
      countOf((r) => (r.day ? inKeys.includes(dayKey(r.day)) : r.status === CAL.WORKING)),
    ],
    ['Late', countOf((r) => !!r.day && dayKey(r.day) === 'LATE')],
    ['On leave', countOf((r) => r.status === CAL.ON_LEAVE)],
    ['Not punched in', countOf((r) => !r.day && r.status === undefined)],
  ] as const;
  const loading = teamToday.isPending || days.isPending;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">
              Team attendance · {isToday ? 'today' : formatDate(date)}
            </h2>
            <p className="text-xs text-muted">
              {can('attendance:read:all')
                ? 'HR view, everyone you can see'
                : 'Manager view, your direct reports'}
            </p>
          </div>
          <div className="flex gap-2">
            <Field label="Team">
              {(id) => (
                <Select
                  id={id}
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                >
                  <option value="">All teams</option>
                  {depts.items.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Date">
              {(id) => (
                <Input
                  id={id}
                  type="date"
                  max={today}
                  value={date}
                  onChange={(e) => setDate(e.target.value || today)}
                />
              )}
            </Field>
          </div>
        </div>
        {loading ? (
          <Skeleton className="h-64" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {stat.map(([k, v]) => (
                <Card key={k} className="p-4">
                  <p className="text-xs font-medium text-muted">{k}</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums">{v}</p>
                </Card>
              ))}
            </div>
            <Table aria-label="Team attendance">
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>Role</Th>
                  <Th>Punch in</Th>
                  <Th>Status</Th>
                  <Th>
                    <span className="sr-only">Details</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ m, day, status }) => (
                  <tr key={m.id}>
                    <Td>
                      <span className="flex items-center gap-2.5">
                        <Avatar name={m.name} size="sm" />
                        <span className="font-medium">{m.name}</span>
                      </span>
                    </Td>
                    <Td>{m.designation ?? '—'}</Td>
                    <Td className="tabular-nums">{formatTime(day?.firstCheckIn, tz)}</Td>
                    <Td>
                      {status ? (
                        <span
                          className={cn(
                            'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
                            status.chip,
                          )}
                        >
                          {status.label}
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-subtle px-2.5 py-0.5 text-xs font-semibold text-muted">
                          Not punched in
                        </span>
                      )}
                    </Td>
                    <Td className="text-right">
                      {day && can('attendance:events:read') ? (
                        <Button size="sm" variant="ghost" onClick={() => onDetail(day.id)}>
                          Details
                        </Button>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {rows.length === 0 ? <Empty>No team members to show.</Empty> : null}
          </>
        )}
      </div>
      {can('attendance:review:all', 'attendance:review:team') ? (
        <PendingApprovals selfId={selfId} />
      ) : null}
    </div>
  );
}

function PendingApprovals({ selfId }: { selfId?: string }) {
  const q = useList<Req>('approvals', '/attendance/corrections', { status: 'PENDING', limit: 20 });
  const [rejecting, setRejecting] = useState<Req>();
  const [comment, setComment] = useState('');
  const refresh = ['approvals', 'my-requests', 'my-days', 'my-days-recent', 'team-days'];
  const approve = useSave(
    (r: Req) => api.post(`/attendance/corrections/${r.id}/approve`, {}),
    refresh,
  );
  const reject = useSave(
    (r: Req) => api.post(`/attendance/corrections/${r.id}/reject`, { comment: comment.trim() }),
    refresh,
    () => {
      setRejecting(undefined);
      setComment('');
    },
  );
  // You cannot approve your own request, so those are not waiting on you.
  const items = (q.data?.data ?? []).filter((r) => r.employeeId !== selfId);
  const type = (r: string) => /^\[(.+?)\]/.exec(r)?.[1] ?? 'Correction';
  return (
    <Card className="self-start">
      <CardTitle className="text-base text-foreground">Pending approvals</CardTitle>
      <p className="mb-3 text-xs text-muted">
        {items.length} request{items.length === 1 ? '' : 's'} need your action
      </p>
      {q.isPending ? (
        <Skeleton className="h-32" />
      ) : items.length === 0 ? (
        <Empty>Nothing waiting for you.</Empty>
      ) : (
        <ul className="space-y-3">
          {items.slice(0, 8).map((r) => (
            <li key={r.id} className="rounded-xl border border-border p-3">
              <p className="text-sm font-semibold">
                {r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : 'Employee'}
              </p>
              <p className="text-xs text-muted">
                {type(r.reason)} · {shortDate(r.workDate)}
              </p>
              <p className="mt-1 line-clamp-2 text-xs">{r.reason.replace(/^\[.+?\]\s*/, '')}</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  loading={approve.isPending && approve.variables?.id === r.id}
                  onClick={() => approve.mutate(r)}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    reject.clearError();
                    setRejecting(r);
                  }}
                >
                  Reject
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {approve.error ? (
        <div className="mt-3">
          <Alert tone="danger">{approve.error}</Alert>
        </div>
      ) : null}
      {rejecting ? (
        <Modal
          open
          onOpenChange={(o) => !o && setRejecting(undefined)}
          title="Reject request"
          description="Tell the employee why. They will see this comment."
        >
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              reject.mutate(rejecting);
            }}
          >
            <Field label="Comment">
              {(id) => (
                <Textarea
                  id={id}
                  required
                  minLength={3}
                  maxLength={1000}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              )}
            </Field>
            {reject.error ? <Alert tone="danger">{reject.error}</Alert> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setRejecting(undefined)}>
                Cancel
              </Button>
              <Button type="submit" variant="danger" loading={reject.isPending}>
                Reject
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </Card>
  );
}
