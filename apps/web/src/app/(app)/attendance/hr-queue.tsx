'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import {
  Alert,
  Badge,
  Card,
  CardTitle,
  Empty,
  Skeleton,
  Table,
  Td,
  Th,
} from '@/components/ui/display';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { useList, useSave } from '@/hooks/api';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import type { Employee } from '@/lib/types';
import { cn, formatDate } from '@/lib/utils';
import { at } from './requests';
import { useApprovalQueue, useExceptionItems, type QueueItem } from './hr-data';
import { shortDate } from './lib';

const PATH = {
  correction: 'attendance/corrections',
  location: 'attendance/exceptions',
  leave: 'leave/requests',
} as const;
const KIND_LABEL = {
  correction: 'Corrections',
  location: 'Location approvals',
  leave: 'Leave',
} as const;
const waiting = (iso?: string) => {
  if (!iso) return '—';
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return d <= 0 ? 'Today' : `${d} day${d === 1 ? '' : 's'}`;
};

/* ----------------------------- exceptions to resolve ----------------------------- */

export function ExceptionsList({
  from,
  to,
  onFix,
}: {
  from: string;
  to: string;
  onFix: (v: { employeeId: string; name: string; date: string }) => void;
}) {
  const q = useExceptionItems(from, to);
  return (
    <Card>
      <CardTitle className="text-base text-foreground">Exceptions to resolve</CardTitle>
      <p className="mb-3 text-xs text-muted">
        Missing punches and unexplained absences from {formatDate(from)} to {formatDate(to)}.
        Showing {Math.min(q.items.length, 50)} of {q.total}.
      </p>
      {q.isPending ? (
        <Skeleton className="h-48" />
      ) : q.error ? (
        <Alert tone="danger">{userMessage(q.error)}</Alert>
      ) : q.items.length === 0 ? (
        <Empty>Nothing to resolve. Every day this period is complete.</Empty>
      ) : (
        <Table aria-label="Exceptions to resolve">
          <thead>
            <tr>
              <Th>Employee</Th>
              <Th>Issue</Th>
              <Th>Date</Th>
              <Th>
                <span className="sr-only">Action</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {q.items.slice(0, 50).map(({ day, issue }) => {
              const pending = day.correctionStatus === 'PENDING';
              const name = day.employee
                ? `${day.employee.firstName} ${day.employee.lastName}`
                : 'Employee';
              return (
                <tr key={`${day.id}${issue}`}>
                  <Td>
                    <span className="font-medium">{name}</span>
                    <span className="ml-1 text-xs text-muted">{day.employee?.employeeCode}</span>
                  </Td>
                  <Td>
                    <span
                      className={cn(
                        'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
                        issue === 'ABSENT' ? 'bg-danger-bg text-danger' : 'bg-warn-bg text-warn',
                      )}
                    >
                      {issue === 'ABSENT' ? 'Absent, no leave applied' : 'Missing punch'}
                    </span>
                    {pending ? (
                      <span className="ml-1">
                        <Badge tone="info">Fix awaiting approval</Badge>
                      </span>
                    ) : null}
                  </Td>
                  <Td className="whitespace-nowrap">{shortDate(day.workDate)}</Td>
                  <Td className="text-right">
                    {!pending ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          onFix({ employeeId: day.employeeId, name, date: day.workDate })
                        }
                      >
                        Fix punch
                      </Button>
                    ) : null}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

/* --------------------------------- manual entry --------------------------------- */

export function ManualEntryModal({
  tz,
  today,
  preset,
  onClose,
}: {
  tz: string;
  today: string;
  preset?: { employeeId: string; name: string; date: string };
  onClose: () => void;
}) {
  const [term, setTerm] = useState('');
  const [empId, setEmpId] = useState(preset?.employeeId ?? '');
  const [date, setDate] = useState(preset?.date ?? '');
  const [pin, setPin] = useState('');
  const [pout, setPout] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string>();
  const found = useList<Employee>(
    'emp-search',
    '/employees',
    { search: term, limit: 8 },
    !preset && term.trim().length >= 2,
  );
  const save = useSave(
    () =>
      api.post('/attendance/corrections', {
        employeeId: empId,
        workDate: date,
        ...(pin ? { checkIn: at(date, pin, tz) } : {}),
        ...(pout ? { checkOut: at(date, pout, tz, !!pin && pout <= pin) } : {}),
        reason: `[Manual entry by HR] ${reason.trim()}`,
      }),
    ['approvals', 'exception-days', 'team-days', 'register'],
    onClose,
  );
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!empId) return setErr('Choose an employee.');
    if (!date || date > today) return setErr('Choose a date that is not in the future.');
    if (!pin && !pout) return setErr('Enter a punch-in and/or punch-out time.');
    if (reason.trim().length < 5) return setErr('Add a reason of at least 5 characters.');
    setErr(undefined);
    save.mutate(undefined);
  }
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add manual entry"
      description="Creates a correction for the employee. Original punches are never edited, and another approver reviews it."
    >
      <form onSubmit={submit} className="space-y-3" noValidate>
        {preset ? (
          <p className="text-sm">
            <span className="text-muted">Employee: </span>
            <span className="font-semibold">{preset.name}</span>
          </p>
        ) : (
          <>
            <Field label="Search employee">
              {(id) => (
                <Input
                  id={id}
                  placeholder="Name or employee ID"
                  value={term}
                  onChange={(e) => {
                    setTerm(e.target.value);
                    setEmpId('');
                  }}
                />
              )}
            </Field>
            {term.trim().length >= 2 ? (
              <Select
                aria-label="Matching employees"
                value={empId}
                onChange={(e) => setEmpId(e.target.value)}
              >
                <option value="">
                  {found.isPending
                    ? 'Searching…'
                    : `${found.data?.data.length ?? 0} match(es), choose one`}
                </option>
                {(found.data?.data ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.firstName} {e.lastName} · {e.employeeCode}
                  </option>
                ))}
              </Select>
            ) : null}
          </>
        )}
        <Field label="Date">
          {(id) => (
            <Input
              id={id}
              type="date"
              max={today}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Punch in">
            {(id) => (
              <Input id={id} type="time" value={pin} onChange={(e) => setPin(e.target.value)} />
            )}
          </Field>
          <Field label="Punch out">
            {(id) => (
              <Input id={id} type="time" value={pout} onChange={(e) => setPout(e.target.value)} />
            )}
          </Field>
        </div>
        <Field label="Reason">
          {(id) => (
            <Textarea
              id={id}
              maxLength={900}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
        {err ? <Alert tone="danger">{err}</Alert> : null}
        {save.error ? <Alert tone="danger">{save.error}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Submit
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------------------------- approval queue ---------------------------------- */

export function ApprovalQueue({ selfId }: { selfId?: string }) {
  const q = useApprovalQueue(selfId);
  const [filter, setFilter] = useState<'' | QueueItem['kind']>('');
  const [rejecting, setRejecting] = useState<QueueItem>();
  const [comment, setComment] = useState('');
  const refresh = [
    'approvals',
    'my-requests',
    'team-days',
    'exception-days',
    'register',
    'my-days',
  ];
  const approve = useSave(
    (i: QueueItem) => api.post(`/${PATH[i.kind]}/${i.id}/approve`, {}),
    refresh,
  );
  const reject = useSave(
    (i: QueueItem) => api.post(`/${PATH[i.kind]}/${i.id}/reject`, { comment: comment.trim() }),
    refresh,
    () => {
      setRejecting(undefined);
      setComment('');
    },
  );
  const shown = q.items.filter((i) => !filter || i.kind === filter);
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <CardTitle className="text-base text-foreground">Approval queue</CardTitle>
          <p className="text-xs text-muted">
            Regularization, location and leave requests · {shown.length} waiting. You cannot approve
            your own.
          </p>
        </div>
        <Field label="Filter">
          {(id) => (
            <Select
              id={id}
              value={filter}
              onChange={(e) => setFilter(e.target.value as typeof filter)}
            >
              <option value="">All requests</option>
              {(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {q.isPending ? (
        <Skeleton className="h-48" />
      ) : q.error ? (
        <Alert tone="danger">{userMessage(q.error)}</Alert>
      ) : shown.length === 0 ? (
        <Empty>Nothing waiting for a decision.</Empty>
      ) : (
        <Table aria-label="Approval queue">
          <thead>
            <tr>
              <Th>Employee</Th>
              <Th>Request</Th>
              <Th>For date</Th>
              <Th>Waiting</Th>
              <Th>Decision</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <tr key={i.key}>
                <Td>
                  <span className="font-medium">{i.name}</span>
                  <span className="ml-1 text-xs text-muted">{i.code}</span>
                </Td>
                <Td className="max-w-64">
                  <span className="block font-medium">{i.title}</span>
                  {i.detail ? (
                    <span className="block truncate text-xs text-muted" title={i.detail}>
                      {i.detail}
                    </span>
                  ) : null}
                </Td>
                <Td className="whitespace-nowrap">{shortDate(i.date)}</Td>
                <Td className="whitespace-nowrap">{waiting(i.createdAt)}</Td>
                <Td className="whitespace-nowrap">
                  <span className="flex gap-2">
                    <Button
                      size="sm"
                      loading={approve.isPending && approve.variables?.key === i.key}
                      onClick={() => approve.mutate(i)}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        reject.clearError();
                        setRejecting(i);
                      }}
                    >
                      Reject
                    </Button>
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
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
