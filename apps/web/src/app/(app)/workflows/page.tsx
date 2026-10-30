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
    condOn: z.boolean(),
    condField: z.string(),
    condOp: z.enum(['GT', 'GTE', 'LT', 'LTE', 'EQ', 'NE']),
    condValue: z.string(),
    mode: z.enum(['ANY', 'ALL', 'QUORUM']),
    quorum: z.string(),
    escOn: z.boolean(),
    escHours: z.string(),
    escTo: z.string(),
    escEmployeeId: z.string(),
  })
  .superRefine((s, ctx) => {
    if (s.mode === 'QUORUM') {
      const n = Number(s.quorum);
      if (!Number.isInteger(n) || n < 2 || n > 20)
        ctx.addIssue({ code: 'custom', path: ['quorum'], message: 'Whole number, 2 to 20' });
    }
    if (s.escOn) {
      const h = Number(s.escHours);
      if (!Number.isInteger(h) || h < 1 || h > 720)
        ctx.addIssue({ code: 'custom', path: ['escHours'], message: 'Whole hours, 1 to 720' });
    }
    if (s.condOn) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(s.condField.trim()))
        ctx.addIssue({ code: 'custom', path: ['condField'], message: 'Use letters, digits and _' });
      const numeric = ['GT', 'GTE', 'LT', 'LTE'].includes(s.condOp);
      if (s.condValue.trim() === '' || (numeric && Number.isNaN(Number(s.condValue))))
        ctx.addIssue({ code: 'custom', path: ['condValue'], message: numeric ? 'Enter a number' : 'Enter a value' });
    }
    if (s.approverType === 'ROLE' && !s.role) ctx.addIssue({ code: 'custom', path: ['role'], message: 'Choose a role' });
    if (s.approverType === 'EMPLOYEE' && !s.employeeId)
      ctx.addIssue({ code: 'custom', path: ['employeeId'], message: 'Choose a person' });
  });
const schema = z.object({
  name: z.string().trim().min(1, 'Required').max(120),
  requestType: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_]{1,39}$/, 'Letters, digits and _ only (2-40)'),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  steps: z.array(stepSchema).min(1, 'Add at least one step').max(8),
}).superRefine((v, ctx) => {
  if (v.steps.every((s) => s.condOn))
    ctx.addIssue({ code: 'custom', path: ['steps'], message: 'At least one step must apply to every request (no condition)' });
});
type Form = z.infer<typeof schema>;
const BLANK_STEP = {
  approverType: 'MANAGER' as const,
  level: '1',
  role: '',
  employeeId: '',
  condOn: false,
  condField: '',
  condOp: 'GT' as const,
  condValue: '',
  mode: 'ANY' as 'ANY' | 'ALL' | 'QUORUM',
  quorum: '2',
  escOn: false,
  escHours: '24',
  escTo: 'HR_ADMIN',
  escEmployeeId: '',
};
/** Who an overdue step is escalated to, as offered in the editor. */
const ESC_TARGETS: Record<string, string> = {
  MANAGER2: 'The manager’s manager',
  HR_ADMIN: 'HR admin',
  COMPANY_OWNER: 'Company owner',
  PAYROLL_ADMIN: 'Payroll admin',
  EMP: 'The named person already set',
};
const escToBody = (s: { escTo: string; escEmployeeId: string; escHours: string }) => {
  const afterHours = Number(s.escHours);
  if (s.escTo === 'MANAGER2') return { afterHours, approverType: 'MANAGER' as const, level: 2 };
  if (s.escTo === 'EMP') return { afterHours, approverType: 'EMPLOYEE' as const, employeeId: s.escEmployeeId };
  return { afterHours, approverType: 'ROLE' as const, role: s.escTo };
};

const OPS: Record<string, string> = { GT: '>', GTE: '>=', LT: '<', LTE: '<=', EQ: '=', NE: '!=' };
const describe = (s: ApprovalWorkflowStep, names: Map<string, string>) =>
  describeBase(s, names) +
  (s.mode === 'ALL' ? ' (all must approve)' : s.mode === 'QUORUM' ? ` (${s.quorum} must approve)` : '') +
  (s.escalation ? ` (escalates after ${s.escalation.afterHours}h)` : '') +
  (s.condition ? ` (only if ${s.condition.field} ${OPS[s.condition.op]} ${s.condition.value})` : '');
/** Free text from the form to the typed value the API compares against. */
const parseValue = (raw: string): string | number | boolean => {
  const t = raw.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  return t !== '' && !Number.isNaN(Number(t)) ? Number(t) : t;
};
const describeBase = (s: ApprovalWorkflowStep, names: Map<string, string>) =>
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
        condOn: !!s.condition,
        condField: s.condition?.field ?? '',
        condOp: s.condition?.op ?? 'GT',
        condValue: s.condition ? String(s.condition.value) : '',
        mode: s.mode ?? 'ANY',
        quorum: String(s.quorum ?? 2),
        escOn: !!s.escalation,
        escHours: String(s.escalation?.afterHours ?? 24),
        escTo: !s.escalation
          ? 'HR_ADMIN'
          : s.escalation.approverType === 'MANAGER'
            ? 'MANAGER2'
            : s.escalation.approverType === 'EMPLOYEE'
              ? 'EMP'
              : (s.escalation.role ?? 'HR_ADMIN'),
        escEmployeeId: s.escalation?.employeeId ?? '',
      })) ?? [BLANK_STEP],
    },
  });
  const steps = useFieldArray({ control: f.control, name: 'steps' });
  const save = useSave(
    (v: Form) => {
      const body = {
        name: v.name,
        steps: v.steps.map((s) => ({
          ...(s.approverType === 'MANAGER'
            ? { approverType: s.approverType, level: Number(s.level) }
            : s.approverType === 'ROLE'
              ? { approverType: s.approverType, role: s.role }
              : { approverType: s.approverType, employeeId: s.employeeId }),
          ...(s.mode !== 'ANY' ? { mode: s.mode } : {}),
          ...(s.mode === 'QUORUM' ? { quorum: Number(s.quorum) } : {}),
          ...(s.escOn ? { escalation: escToBody(s) } : {}),
          ...(s.condOn
            ? {
                condition: {
                  field: s.condField.trim(),
                  op: s.condOp,
                  value: ['GT', 'GTE', 'LT', 'LTE'].includes(s.condOp) ? Number(s.condValue) : parseValue(s.condValue),
                },
              }
            : {}),
        })),
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
                <div className="col-start-2 col-end-5 space-y-1">
                  <label className="flex items-center gap-1.5 text-xs text-muted">
                    <input type="checkbox" {...f.register(`steps.${i}.condOn`)} />
                    Only when the request details match
                  </label>
                  {type !== 'EMPLOYEE' ? (
                    <div className="grid grid-cols-[1fr_6rem] items-center gap-2">
                      <Select aria-label={`Step ${i + 1} how many must approve`} {...f.register(`steps.${i}.mode`)}>
                        <option value="ANY">Any one approver decides</option>
                        <option value="ALL">Every approver must approve</option>
                        <option value="QUORUM">At least a number of approvers</option>
                      </Select>
                      {f.watch(`steps.${i}.mode`) === 'QUORUM' ? (
                        <Input
                          aria-label={`Step ${i + 1} how many approvers`}
                          inputMode="numeric"
                          placeholder="How many"
                          invalid={!!e.steps?.[i]?.quorum}
                          {...f.register(`steps.${i}.quorum`)}
                        />
                      ) : null}
                    </div>
                  ) : null}
                  <label className="flex items-center gap-1.5 text-xs text-muted">
                    <input type="checkbox" {...f.register(`steps.${i}.escOn`)} />
                    Escalate if nobody decides in time (adds approvers; the first ones can still act)
                  </label>
                  {f.watch(`steps.${i}.escOn`) ? (
                    <div className="grid grid-cols-[6rem_1fr] items-center gap-2">
                      <Input
                        aria-label={`Step ${i + 1} escalate after hours`}
                        inputMode="numeric"
                        placeholder="Hours"
                        invalid={!!e.steps?.[i]?.escHours}
                        {...f.register(`steps.${i}.escHours`)}
                      />
                      <Select aria-label={`Step ${i + 1} escalate to`} {...f.register(`steps.${i}.escTo`)}>
                        {Object.entries(ESC_TARGETS)
                          .filter(([k]) => k !== 'EMP' || f.watch(`steps.${i}.escEmployeeId`))
                          .map(([k, v]) => (
                            <option key={k} value={k}>
                              hours, then ask: {v}
                            </option>
                          ))}
                      </Select>
                    </div>
                  ) : null}
                  {f.watch(`steps.${i}.condOn`) ? (
                    <div className="grid grid-cols-3 gap-2">
                      <Input
                        aria-label={`Step ${i + 1} detail name`}
                        placeholder="Detail, e.g. days"
                        invalid={!!e.steps?.[i]?.condField}
                        {...f.register(`steps.${i}.condField`)}
                      />
                      <Select aria-label={`Step ${i + 1} comparison`} {...f.register(`steps.${i}.condOp`)}>
                        <option value="GT">is more than</option>
                        <option value="GTE">is at least</option>
                        <option value="LT">is less than</option>
                        <option value="LTE">is at most</option>
                        <option value="EQ">equals</option>
                        <option value="NE">does not equal</option>
                      </Select>
                      <Input
                        aria-label={`Step ${i + 1} value`}
                        placeholder="Value, e.g. 3"
                        invalid={!!e.steps?.[i]?.condValue}
                        {...f.register(`steps.${i}.condValue`)}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={steps.fields.length >= 8}
            onClick={() => steps.append(BLANK_STEP)}
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
