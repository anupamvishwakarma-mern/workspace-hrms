'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Alert, Badge, Empty, Table, Td, Th, statusTone } from '@/components/ui/display';
import { Field, Input } from '@/components/ui/form';
import { useList, useSave } from '@/hooks/api';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import type { LeaveType } from '@/lib/types';
import { label } from '@/lib/utils';

const typeSchema = z.object({
  name: z.string().trim().min(1, 'Required').max(80),
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,20}$/, 'Letters, digits, - and _ only'),
  paid: z.boolean(),
  allowHalfDay: z.boolean(),
  annualAllowanceDays: z.coerce.number().min(0).max(366).multipleOf(0.5, 'Use whole or half days'),
});
type TForm = z.input<typeof typeSchema>;

export function LeaveTypes() {
  const [editing, setEditing] = useState<LeaveType | 'new'>();
  const q = useList<LeaveType>('leave-types', '/leave-types', {});
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}>Add leave type</Button>
      </div>
      {q.isError ? <Alert tone="danger">{userMessage(q.error)}</Alert> : null}
      {q.data ? (
        <Table aria-label="Leave types">
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Code</Th>
              <Th>Per year</Th>
              <Th>Paid</Th>
              <Th>Half day</Th>
              <Th>Status</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {q.data.data.map((t) => (
              <tr key={t.id}>
                <Td className="font-medium">{t.name}</Td>
                <Td>{t.code}</Td>
                <Td>
                  {t.annualAllowanceDays === 0 ? 'Unlimited' : `${t.annualAllowanceDays} days`}
                </Td>
                <Td>{t.paid ? 'Yes' : 'No'}</Td>
                <Td>{t.allowHalfDay ? 'Yes' : 'No'}</Td>
                <Td>
                  <Badge tone={statusTone(t.status)}>{label(t.status)}</Badge>
                </Td>
                <Td>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(t)}>
                    Edit
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
      {q.data?.data.length === 0 ? (
        <Empty>No leave types yet. Add one so employees can request leave.</Empty>
      ) : null}
      {editing ? (
        <TypeForm
          type={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </div>
  );
}

function TypeForm({ type, onClose }: { type?: LeaveType; onClose: () => void }) {
  const f = useForm<TForm, unknown, z.output<typeof typeSchema>>({
    resolver: zodResolver(typeSchema),
    defaultValues: {
      name: type?.name ?? '',
      code: type?.code ?? '',
      paid: type?.paid ?? true,
      allowHalfDay: type?.allowHalfDay ?? true,
      annualAllowanceDays: type?.annualAllowanceDays ?? 0,
    },
  });
  const save = useSave(
    (v: z.output<typeof typeSchema>) =>
      type ? api.patch(`/leave-types/${type.id}`, v) : api.post('/leave-types', v),
    ['leave-types', 'leave-balances'],
    onClose,
  );
  const toggle = useSave(
    () =>
      api.patch(`/leave-types/${type!.id}`, {
        status: type!.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
      }),
    ['leave-types', 'leave-balances'],
    onClose,
  );
  const e = f.formState.errors;
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={type ? 'Edit leave type' : 'Add leave type'}
    >
      <form onSubmit={f.handleSubmit((v) => save.mutate(v))} className="space-y-3" noValidate>
        {save.error || toggle.error ? (
          <Alert tone="danger">{save.error ?? toggle.error}</Alert>
        ) : null}
        <Field label="Name" error={e.name?.message}>
          {(id, inv) => <Input id={id} invalid={inv} {...f.register('name')} />}
        </Field>
        <Field label="Code" error={e.code?.message}>
          {(id, inv) => <Input id={id} invalid={inv} {...f.register('code')} />}
        </Field>
        <Field
          label="Days per calendar year"
          hint="0 means no limit."
          error={e.annualAllowanceDays?.message}
        >
          {(id, inv) => (
            <Input
              id={id}
              type="number"
              step="0.5"
              min="0"
              invalid={inv}
              {...f.register('annualAllowanceDays')}
            />
          )}
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...f.register('paid')} /> Paid leave
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...f.register('allowHalfDay')} /> Allow half days
        </label>
        <div className="flex justify-between gap-2">
          {type ? (
            <Button
              type="button"
              variant="secondary"
              loading={toggle.isPending}
              onClick={() => toggle.mutate(undefined)}
            >
              {type.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              Save
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
