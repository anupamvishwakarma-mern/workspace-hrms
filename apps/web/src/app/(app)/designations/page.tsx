'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { Briefcase } from 'lucide-react';
import { PageTop } from '@/components/page-top';
import { BreakdownPanel } from '../dashboard/charts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Alert, Badge, Empty, Skeleton, Table, Td, Th, statusTone } from '@/components/ui/display';
import { Field, Input, Select } from '@/components/ui/form';
import { useList, useSave } from '@/hooks/api';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import type { Designation } from '@/lib/types';
import { label } from '@/lib/utils';

const schema = z.object({
  title: z.string().trim().min(1, 'Required').max(120),
  code: z.string().trim().max(20),
  level: z
    .string()
    .trim()
    .refine(
      (s) => s === '' || (/^\d{1,3}$/.test(s) && Number(s) <= 100),
      'Enter a number from 0 to 100',
    ),
  description: z.string().max(1000),
  status: z.enum(['ACTIVE', 'INACTIVE']),
});
type Form = z.infer<typeof schema>;

export default function DesignationsPage() {
  const [editing, setEditing] = useState<Designation | 'new'>();
  const q = useList<Designation>('designations', '/designations', { limit: 100 });
  const items = q.data?.data ?? [];

  return (
    <>
      <PageTop
        scope="company structure"
        stats={[
          { label: 'Designations', value: q.data ? items.length : '…' },
          {
            label: 'Active',
            value: q.data ? items.filter((d) => d.status === 'ACTIVE').length : '…',
            tone: 'success',
          },
        ]}
        guide={[
          'A designation is a job title you define once and assign to employees.',
          'Choosing one copies its title onto the employee, so letters and payslips keep the title they had when issued.',
          'Deactivate a designation to stop new assignments; people who already hold it keep it.',
        ]}
        title="Designations"
        actions={<Button onClick={() => setEditing('new')}>Add designation</Button>}
      />
      {q.data ? (
        <BreakdownPanel
          title="Designations by status"
          icon={Briefcase}
          unit="Designations"
          data={Object.entries(
            items.reduce<Record<string, number>>(
              (m, d) => ({ ...m, [d.status]: (m[d.status] ?? 0) + 1 }),
              {},
            ),
          ).map(([name, value]) => ({ name: label(name), value }))}
        />
      ) : null}
      {q.isError ? <Alert tone="danger">{userMessage(q.error)}</Alert> : null}
      {!q.data ? (
        q.isError ? null : (
          <Skeleton className="h-40" />
        )
      ) : (
        <>
          <Table aria-label="Designations">
            <thead>
              <tr>
                <Th>Title</Th>
                <Th>Code</Th>
                <Th>Level</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id}>
                  <Td className="font-medium">{d.title}</Td>
                  <Td>{d.code ?? '—'}</Td>
                  <Td>{d.level ?? '—'}</Td>
                  <Td>
                    <Badge tone={statusTone(d.status)}>{label(d.status)}</Badge>
                  </Td>
                  <Td>
                    <Button size="sm" variant="secondary" onClick={() => setEditing(d)}>
                      Edit
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {items.length === 0 ? <Empty>No designations yet.</Empty> : null}
        </>
      )}
      {editing ? (
        <DesignationForm
          item={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </>
  );
}

function DesignationForm({ item, onClose }: { item?: Designation; onClose: () => void }) {
  const f = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: item?.title ?? '',
      code: item?.code ?? '',
      level: item?.level === undefined ? '' : String(item.level),
      description: item?.description ?? '',
      status: (item?.status as Form['status']) ?? 'ACTIVE',
    },
  });
  const save = useSave(
    (v: Form) => {
      const body = {
        title: v.title,
        description: v.description,
        ...(v.level !== '' ? { level: Number(v.level) } : {}),
      };
      if (!item) return api.post('/designations', { ...body, ...(v.code ? { code: v.code } : {}) });
      // An emptied code is sent as null so the server clears it.
      return api.patch(`/designations/${item.id}`, {
        ...body,
        code: v.code || null,
        status: v.status,
      });
    },
    ['designations', 'employees', 'employees-lookup'],
    onClose,
  );
  const e = f.formState.errors;
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={item ? 'Edit designation' : 'Add designation'}
    >
      <form onSubmit={f.handleSubmit((v) => save.mutate(v))} className="space-y-3" noValidate>
        {save.error ? <Alert tone="danger">{save.error}</Alert> : null}
        <Field label="Title" error={e.title?.message}>
          {(id, inv) => <Input id={id} invalid={inv} {...f.register('title')} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code (optional)" error={e.code?.message}>
            {(id, inv) => <Input id={id} invalid={inv} {...f.register('code')} />}
          </Field>
          <Field label="Level (optional)" error={e.level?.message}>
            {(id, inv) => (
              <Input id={id} invalid={inv} inputMode="numeric" {...f.register('level')} />
            )}
          </Field>
        </div>
        <Field label="Description (optional)">
          {(id) => <Input id={id} {...f.register('description')} />}
        </Field>
        {item ? (
          <Field label="Status">
            {(id) => (
              <Select id={id} {...f.register('status')}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </Select>
            )}
          </Field>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
