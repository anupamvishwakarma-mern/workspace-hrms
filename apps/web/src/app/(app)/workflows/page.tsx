'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';
import { PageTop } from '@/components/page-top';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Alert, Badge, Empty, Skeleton, Table, Td, Th, statusTone } from '@/components/ui/display';
import { Field, Input, Select } from '@/components/ui/form';
import { useList, useSave } from '@/hooks/api';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import type { ApprovalWorkflow, ApprovalWorkflowStep, Employee } from '@/lib/types';
import { label } from '@/lib/utils';

const ROLES = ['COMPANY_OWNER', 'HR_ADMIN', 'MANAGER', 'PAYROLL_ADMIN'] as const;
const stepSchema = z
  .object({
    approverType: z.enum(['MANAGER', 'ROLE', 'EMPLOYEE']),
    level: z.string(),
    role: z.string(),
    employeeId: z.string(),
  })
  .superRefine((s, ctx) => {
    if (s.approverType === 'ROLE' && !s.role) ctx.addIssue({ code: 'custom', path: ['role'], message: 'Choose a role' });
    if (s.approverType === 'EMPLOYEE' && !s.employeeId)
      ctx.addIssue({ code: 'custom', path: ['employeeId'], message: 'Choose a person' });
  });
const schema = z.object({
  name: z.string().trim().min(1, 'Required').max(120),
  requestType: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_]{1,39}$/, 'Letters, digits and _ only (2-40)'),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  steps: z.array(stepSchema).min(1, 'Add at least one step').max(8),
});
type Form = z.infer<typeof schema>;

const describe = (s: ApprovalWorkflowStep, names: Map<string, string>) =>
  s.approverType === 'MANAGER'
    ? (s.level ?? 1) > 1
      ? `Manager ${s.level} levels up`
      : 'Direct manager (owner if none)'
    : s.approverType === 'ROLE'
      ? label(s.role ?? '')
      : (names.get(s.employeeId ?? '') ?? 'Named person');

export default function WorkflowsPage() {
  const [editing, setEditing] = useState<ApprovalWorkflow | 'new'>();
  const q = useList<ApprovalWorkflow>('approval-workflows', '/approval-workflows');
  const emps = useList<Employee>('employees-lookup', '/employees', { limit: 100 });
  const names = new Map((emps.data?.data ?? []).map((e) => [e.id, `${e.firstName} ${e.lastName}`]));
  const items = q.data?.data ?? [];
  return (
    <>
      <PageTop
        scope="company approvals"
        stats={[{ label: 'Workflows', value: q.data ? items.length : '…' }]}
        guide={[
          'A workflow is the chain of approvers for one request type, for example EXPENSE.',
          'Steps run in order. The person raising a request is never one of its approvers.',
          'Editing a workflow affects new requests only; requests already raised keep the chain they started with.',
          'Leave and attendance still use the built-in manager rule; they are not connected to these workflows yet.',
        ]}
        title="Approval workflows"
        actions={<Button onClick={() => setEditing('new')}>Add workflow</Button>}
      />
      {q.isError ? <Alert tone="danger">{userMessage(q.error)}</Alert> : null}
      {!q.data ? (
        q.isError ? null : <Skeleton className="h-40" />
      ) : (
        <>
          <Table aria-label="Approval workflows">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>Steps</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {items.map((w) => (
                <tr key={w.id}>
                  <Td className="font-medium">{w.name}</Td>
                  <Td>{w.requestType}</Td>
                  <Td>{w.steps.map((s) => describe(s, names)).join(' → ')}</Td>
                  <Td>
                    <Badge tone={statusTone(w.status)}>{label(w.status)}</Badge>
                  </Td>
                  <Td>
                    <Button size="sm" variant="secondary" onClick={() => setEditing(w)}>
                      Edit
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {items.length === 0 ? <Empty>No workflows yet.</Empty> : null}
        </>
      )}
      {editing ? (
        <WorkflowForm
          item={editing === 'new' ? undefined : editing}
          employees={emps.data?.data ?? []}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </>
  );
}

function WorkflowForm({
  item,
  employees,
  onClose,
}: {
  item?: ApprovalWorkflow;
  employees: Employee[];
  onClose: () => void;
}) {
  const f = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: item?.name ?? '',
      requestType: item?.requestType ?? '',
      status: item?.status ?? 'ACTIVE',
      steps: item?.steps.map((s) => ({
        approverType: s.approverType,
        level: String(s.level ?? 1),
        role: s.role ?? '',
        employeeId: s.employeeId ?? '',
      })) ?? [{ approverType: 'MANAGER', level: '1', role: '', employeeId: '' }],
    },
  });
  const steps = useFieldArray({ control: f.control, name: 'steps' });
  const save = useSave(
    (v: Form) => {
      const body = {
        name: v.name,
        steps: v.steps.map((s) =>
          s.approverType === 'MANAGER'
            ? { approverType: s.approverType, level: Number(s.level) }
            : s.approverType === 'ROLE'
              ? { approverType: s.approverType, role: s.role }
              : { approverType: s.approverType, employeeId: s.employeeId },
        ),
      };
      return item
        ? api.patch(`/approval-workflows/${item.id}`, { ...body, status: v.status })
        : api.post('/approval-workflows', { ...body, requestType: v.requestType });
    },
    ['approval-workflows'],
    onClose,
  );
  const e = f.formState.errors;
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={item ? 'Edit workflow' : 'Add workflow'}>
      <form onSubmit={f.handleSubmit((v) => save.mutate(v))} className="space-y-3" noValidate>
        {save.error ? <Alert tone="danger">{save.error}</Alert> : null}
        <Field label="Name" error={e.name?.message}>
          {(id, inv) => <Input id={id} invalid={inv} {...f.register('name')} />}
        </Field>
        <Field label="Request type" error={e.requestType?.message}>
          {(id, inv) => (
            <Input id={id} invalid={inv} disabled={!!item} placeholder="EXPENSE" {...f.register('requestType')} />
          )}
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
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Approval steps (in order)</legend>
          {e.steps?.message ? <p className="text-sm text-danger">{e.steps.message}</p> : null}
          {steps.fields.map((s, i) => {
            const type = f.watch(`steps.${i}.approverType`);
            return (
              <div key={s.id} className="grid grid-cols-[auto_1fr_1fr_auto] items-start gap-2">
                <span className="pt-2 text-sm text-muted">{i + 1}.</span>
                <Select aria-label={`Step ${i + 1} approver type`} {...f.register(`steps.${i}.approverType`)}>
                  <option value="MANAGER">Manager</option>
                  <option value="ROLE">Anyone with a role</option>
                  <option value="EMPLOYEE">A named person</option>
                </Select>
                {type === 'MANAGER' ? (
                  <Select aria-label={`Step ${i + 1} level`} {...f.register(`steps.${i}.level`)}>
                    {[1, 2, 3].map((n) => (
                      <option key={n} value={n}>
                        {n === 1 ? 'Direct manager' : `${n} levels up`}
                      </option>
                    ))}
                  </Select>
                ) : type === 'ROLE' ? (
                  <Select
                    aria-label={`Step ${i + 1} role`}
                    invalid={!!e.steps?.[i]?.role}
                    {...f.register(`steps.${i}.role`)}
                  >
                    <option value="">Select role…</option>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {label(r)}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Select
                    aria-label={`Step ${i + 1} person`}
                    invalid={!!e.steps?.[i]?.employeeId}
                    {...f.register(`steps.${i}.employeeId`)}
                  >
                    <option value="">Select person…</option>
                    {employees.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.firstName} {p.lastName}
                      </option>
                    ))}
                  </Select>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={steps.fields.length === 1}
                  onClick={() => steps.remove(i)}
                  aria-label={`Remove step ${i + 1}`}
                >
                  ×
                </Button>
              </div>
            );
          })}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={steps.fields.length >= 8}
            onClick={() => steps.append({ approverType: 'MANAGER', level: '1', role: '', employeeId: '' })}
          >
            Add step
          </Button>
        </fieldset>
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
