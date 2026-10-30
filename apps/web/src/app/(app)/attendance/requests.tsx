'use client';
import { DateTime } from 'luxon';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
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
  statusTone,
} from '@/components/ui/display';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { useList, useSave } from '@/hooks/api';
import { api } from '@/lib/api';
import type { Correction } from '@/lib/types';
import { formatDate, label } from '@/lib/utils';

export const REQUEST_TYPES = [
  { key: 'MISSED_IN', label: 'Missed punch-in', needs: 'in' },
  { key: 'MISSED_OUT', label: 'Missed punch-out', needs: 'out' },
  { key: 'WRONG', label: 'Wrong punch (in and out)', needs: 'both' },
  { key: 'ON_DUTY', label: 'On-duty / client visit', needs: 'both' },
] as const;

/** Local wall-clock time in the company timezone to a UTC instant for the API. */
export function at(date: string, time: string, tz: string, nextDay = false): string {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone: tz });
  return (nextDay ? dt.plus({ days: 1 }) : dt).toUTC().toISO()!;
}

export function RequestForm({
  tz,
  today,
  presetDate,
  presetNonce,
  approver,
}: {
  tz: string;
  today: string;
  presetDate?: string;
  presetNonce: number;
  approver?: string;
}) {
  const [date, setDate] = useState('');
  const [type, setType] = useState<(typeof REQUEST_TYPES)[number]['key']>('MISSED_IN');
  const [pin, setPin] = useState('');
  const [pout, setPout] = useState('');
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (presetDate) setDate(presetDate);
  }, [presetDate, presetNonce]);

  const t = REQUEST_TYPES.find((r) => r.key === type)!;
  const needsIn = t.needs !== 'out';
  const needsOut = t.needs !== 'in';
  const save = useSave(
    () => {
      const body: Record<string, unknown> = {
        workDate: date,
        reason: `[${t.label}] ${reason.trim()}`,
      };
      if (needsIn) body.checkIn = at(date, pin, tz);
      if (needsOut) body.checkOut = at(date, pout, tz, needsIn && pout <= pin);
      return api.post('/attendance/corrections', body);
    },
    ['my-requests', 'my-days', 'my-days-recent', 'approvals', 'team-days'],
    () => {
      setSent(true);
      setReason('');
      setPin('');
      setPout('');
    },
  );
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSent(false);
    save.clearError();
    if (!date) return setFieldError('Choose the date this applies to.');
    if (date > today) return setFieldError('The date cannot be in the future.');
    if ((needsIn && !pin) || (needsOut && !pout)) return setFieldError('Enter the punch time.');
    if (reason.trim().length < 5)
      return setFieldError('Describe what happened (at least 5 characters).');
    setFieldError(undefined);
    save.mutate(undefined);
  }

  return (
    <Card>
      <CardTitle className="text-base text-foreground">Raise a request</CardTitle>
      <p className="mb-3 text-xs text-muted">
        Correct a missed or wrong punch, or record on-duty time. Original punches are never edited.
      </p>
      <form onSubmit={submit} className="space-y-3" noValidate>
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
        <Field label="Request type">
          {(id) => (
            <Select id={id} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              {REQUEST_TYPES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          {needsIn ? (
            <Field label="Punch in">
              {(id) => (
                <Input id={id} type="time" value={pin} onChange={(e) => setPin(e.target.value)} />
              )}
            </Field>
          ) : null}
          {needsOut ? (
            <Field label="Punch out">
              {(id) => (
                <Input id={id} type="time" value={pout} onChange={(e) => setPout(e.target.value)} />
              )}
            </Field>
          ) : null}
        </div>
        <Field label="Reason">
          {(id) => (
            <Textarea
              id={id}
              placeholder="Describe what happened"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
        <p className="text-xs text-muted">
          Approver: {approver ?? 'your reporting manager or HR'} (auto-assigned). Requests are
          accepted for recent days only; your company policy sets the window.
        </p>
        {fieldError ? <Alert tone="danger">{fieldError}</Alert> : null}
        {save.error ? <Alert tone="danger">{save.error}</Alert> : null}
        {sent ? (
          <Alert tone="success">Request submitted. You will be notified when it is reviewed.</Alert>
        ) : null}
        <Button type="submit" className="w-full" loading={save.isPending}>
          Submit request
        </Button>
      </form>
    </Card>
  );
}

const typeOf = (reason: string) => /^\[(.+?)\]\s*/.exec(reason)?.[1] ?? 'Correction';
const plainReason = (reason: string) => reason.replace(/^\[.+?\]\s*/, '');

export function MyRequests({
  employeeId,
  absentDates,
}: {
  employeeId?: string;
  absentDates: string[];
}) {
  const q = useList<Correction>(
    'my-requests',
    '/attendance/corrections',
    { employeeId, limit: 20 },
    !!employeeId,
  );
  const rows = q.data?.data ?? [];
  const pending = rows.filter((r) => r.status === 'PENDING');
  const waiting = absentDates.filter((d) => pending.some((p) => p.workDate === d));
  return (
    <Card>
      <CardTitle className="text-base text-foreground">My requests</CardTitle>
      <p className="mb-3 text-xs text-muted">Regularization and on-duty history</p>
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : rows.length === 0 ? (
        <Empty>You have not raised any requests.</Empty>
      ) : (
        <Table aria-label="My requests">
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Type</Th>
              <Th>Reason</Th>
              <Th>Applied</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap">{formatDate(r.workDate)}</Td>
                <Td>{typeOf(r.reason)}</Td>
                <Td className="max-w-56 truncate" title={plainReason(r.reason)}>
                  {plainReason(r.reason)}
                </Td>
                <Td className="whitespace-nowrap">{formatDate(r.createdAt)}</Td>
                <Td>
                  <Badge tone={statusTone(r.status)}>{label(r.status)}</Badge>
                  {r.reviewComment ? (
                    <span className="mt-1 block text-xs text-muted">{r.reviewComment}</span>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {waiting.length ? (
        <div className="mt-3">
          <Alert tone="warn">
            {waiting.map((d) => formatDate(d)).join(', ')} {waiting.length > 1 ? 'are' : 'is'}{' '}
            marked absent. Your pending request is waiting for manager approval; attendance updates
            once it is approved.
          </Alert>
        </div>
      ) : null}
    </Card>
  );
}
