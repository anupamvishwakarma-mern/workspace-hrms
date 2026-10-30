'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Alert, Card, CardTitle, Empty, Table, Td, Th } from '@/components/ui/display';
import { Field, Input } from '@/components/ui/form';
import { useList, useSave } from '@/hooks/api';
import { api } from '@/lib/api';
import type { LeaveBalance, LeaveLedgerEntry } from '@/lib/types';
import { label } from '@/lib/utils';

/** Year-end and month-end runs. Nothing runs these automatically, so HR triggers them here. */
export function LedgerRuns({ today }: { today: string }) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [fromYear, setFromYear] = useState(String(Number(today.slice(0, 4)) - 1));
  const [msg, setMsg] = useState<string>();
  const accrue = useSave(
    () => api.post<{ entriesCreated: number }>('/leave/ledger/accrue', { month }),
    ['leave-balances', 'leave-ledger'],
    (r) => {
      const n = (r as { data: { entriesCreated: number } }).data.entriesCreated;
      setMsg(n ? `Credited ${n} entr${n === 1 ? 'y' : 'ies'} for ${month}.` : `Nothing new to credit for ${month}.`);
    },
  );
  const carry = useSave(
    () => api.post<{ entriesCreated: number; daysCarried: number }>('/leave/ledger/carry-forward', { fromYear: Number(fromYear) }),
    ['leave-balances', 'leave-ledger'],
    (r) => {
      const d = (r as { data: { entriesCreated: number; daysCarried: number } }).data;
      setMsg(d.entriesCreated ? `Carried ${d.daysCarried} days across ${d.entriesCreated} entries into ${Number(fromYear) + 1}.` : `Nothing new to carry from ${fromYear}.`);
    },
  );
  const err = accrue.error ?? carry.error;
  return (
    <Card className="space-y-3 p-4">
      <CardTitle>Accrual and year-end</CardTitle>
      <p className="text-sm text-muted">
        These run by hand unless the owner switched on automatic leave in Settings. Running one again is safe: people already credited are skipped.
      </p>
      {err ? <Alert tone="danger">{err}</Alert> : null}
      {msg && !err ? <Alert tone="success">{msg}</Alert> : null}
      <div className="flex flex-wrap items-end gap-6">
        <div className="flex items-end gap-2">
          <Field label="Credit month (monthly types)">
            {(id) => <Input id={id} type="month" value={month} onChange={(e) => { setMonth(e.target.value); setMsg(undefined); }} />}
          </Field>
          <Button loading={accrue.isPending} disabled={!month} onClick={() => accrue.mutate(undefined)}>
            Run accrual
          </Button>
        </div>
        <div className="flex items-end gap-2">
          <Field label="Carry forward from year">
            {(id) => <Input id={id} inputMode="numeric" className="w-24" value={fromYear} onChange={(e) => { setFromYear(e.target.value); setMsg(undefined); }} />}
          </Field>
          <Button variant="secondary" loading={carry.isPending} disabled={!/^\d{4}$/.test(fromYear)} onClick={() => carry.mutate(undefined)}>
            Run carry-forward
          </Button>
        </div>
      </div>
    </Card>
  );
}

const adjSchema = z.object({
  days: z.coerce
    .number({ message: 'Enter a number' })
    .min(-366)
    .max(366)
    .multipleOf(0.5, 'Use whole or half days')
    .refine((n) => n !== 0, 'Cannot be zero'),
  reason: z.string().trim().min(3, 'Give a reason (3+ characters)').max(500),
});

export function AdjustDialog({
  employeeId,
  balance,
  year,
  onClose,
}: {
  employeeId: string;
  balance: LeaveBalance;
  year: number;
  onClose: () => void;
}) {
  const f = useForm<z.input<typeof adjSchema>, unknown, z.output<typeof adjSchema>>({
    resolver: zodResolver(adjSchema),
    defaultValues: { days: '' as never, reason: '' },
  });
  const save = useSave(
    (v: z.output<typeof adjSchema>) =>
      api.post('/leave/ledger/adjustments', { employeeId, leaveTypeId: balance.leaveTypeId, year, ...v }),
    ['leave-balances', 'leave-ledger'],
    onClose,
  );
  const e = f.formState.errors;
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Adjust ${balance.name} (${year})`}>
      <form onSubmit={f.handleSubmit((v) => save.mutate(v))} className="space-y-3" noValidate>
        {save.error ? <Alert tone="danger">{save.error}</Alert> : null}
        <p className="text-sm text-muted">
          Entries are permanent and visible to the employee. To undo one, add an opposite adjustment.
        </p>
        <Field label="Days to add (negative to take back)" error={e.days?.message}>
          {(id, inv) => <Input id={id} type="number" step="0.5" invalid={inv} {...f.register('days')} />}
        </Field>
        <Field label="Reason" error={e.reason?.message}>
          {(id, inv) => <Input id={id} invalid={inv} {...f.register('reason')} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Save adjustment
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function LedgerList({ employeeId, year, typeName }: { employeeId: string; year: number; typeName: (id: string) => string }) {
  const q = useList<LeaveLedgerEntry>('leave-ledger', '/leave/ledger', { employeeId, year, limit: 50 });
  const rows = q.data?.data ?? [];
  if (!q.data) return null;
  return rows.length === 0 ? (
    <Empty>No credits or adjustments recorded for {year}.</Empty>
  ) : (
    <Table aria-label="Leave ledger">
      <thead>
        <tr>
          <Th>Date</Th>
          <Th>Leave type</Th>
          <Th>Kind</Th>
          <Th>Days</Th>
          <Th>Note</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <Td>{new Date(r.createdAt).toLocaleDateString()}</Td>
            <Td>{typeName(r.leaveTypeId)}</Td>
            <Td>{label(r.kind)}</Td>
            <Td>{r.days > 0 ? `+${r.days}` : r.days}</Td>
            <Td>{r.reason ?? r.period ?? '—'}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
