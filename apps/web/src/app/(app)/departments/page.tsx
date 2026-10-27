'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAuth } from '@/components/auth';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import {
  Alert,
  Badge,
  Empty,
  PageHeader,
  Skeleton,
  Table,
  Td,
  Th,
  statusTone,
} from '@/components/ui/display';
import { Field, Input, Select } from '@/components/ui/form';
import { useList, useSave } from '@/hooks/api';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import type { Department, Employee } from '@/lib/types';
import { compact, label } from '@/lib/utils';

const schema = z.object({
  name: z.string().trim().min(1, 'Required').max(120),
  headEmployeeId: z.string(),
  status: z.enum(['ACTIVE', 'INACTIVE']),
});
type Form = z.infer<typeof schema>;

export default function DepartmentsPage() {
  const { can } = useAuth();
  const [editing, setEditing] = useState<Department | 'new'>();
  const q = useList<Department>('departments', '/departments', { limit: 100 });
  const people = useList<Employee>(
    'employees-lookup',
    '/employees',
    { limit: 100, status: 'ACTIVE' },
    can('employee:read:all'),
  );
  const nameOf = (id?: string) => people.data?.data.find((p) => p.id === id);

  return (
    <>
      <PageHeader
        title="Departments"
        actions={<Button onClick={() => setEditing('new')}>Add department</Button>}
      />
      {q.isError ? <Alert tone="danger">{userMessage(q.error)}</Alert> : null}
      {!q.data ? (
        q.isError ? null : (
          <Skeleton className="h-40" />
        )
      ) : (
        <>
          <Table aria-label="Departments">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Head</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {q.data.data.map((d) => (
                <tr key={d.id}>
                  <Td className="font-medium">{d.name}</Td>
                  <Td>
                    {nameOf(d.headEmployeeId)
                      ? `${nameOf(d.headEmployeeId)!.firstName} ${nameOf(d.headEmployeeId)!.lastName}`
                      : '—'}
                  </Td>
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
          {q.data.data.length === 0 ? <Empty>No departments yet.</Empty> : null}
        </>
      )}
      {editing ? (
        <DeptForm
          dept={editing === 'new' ? undefined : editing}
          people={people.data?.data ?? []}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </>
  );
}

function DeptForm({
  dept,
  people,
  onClose,
}: {
  dept?: Department;
  people: Employee[];
  onClose: () => void;
}) {
  const f = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: dept?.name ?? '',
      headEmployeeId: dept?.headEmployeeId ?? '',
      status: (dept?.status as Form['status']) ?? 'ACTIVE',
    },
  });
  const save = useSave(
    (v: Form) => {
      if (!dept)
        return api.post(
          '/departments',
          compact({ name: v.name, headEmployeeId: v.headEmployeeId }),
        );
      return api.patch(
        `/departments/${dept.id}`,
        compact({ name: v.name, headEmployeeId: v.headEmployeeId, status: v.status }),
      );
    },
    ['departments'],
    onClose,
  );
  const e = f.formState.errors;
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={dept ? 'Edit department' : 'Add department'}
    >
      <form onSubmit={f.handleSubmit((v) => save.mutate(v))} className="space-y-3" noValidate>
        {save.error ? <Alert tone="danger">{save.error}</Alert> : null}
        <Field label="Name" error={e.name?.message}>
          {(id, inv) => <Input id={id} invalid={inv} {...f.register('name')} />}
        </Field>
        <Field label="Department head">
          {(id) => (
            <Select id={id} {...f.register('headEmployeeId')}>
              <option value="">None</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.firstName} {p.lastName} ({p.employeeCode})
                </option>
              ))}
            </Select>
          )}
        </Field>
        {dept ? (
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
