'use client';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/components/auth';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Alert, Badge, Empty, Skeleton } from '@/components/ui/display';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { useList, useSave } from '@/hooks/api';
import { useDepartments, useDesignations } from '@/hooks/lookups';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import type { Employee, EmploymentChange } from '@/lib/types';
import { formatDate, isEnded } from '@/lib/utils';
import { DateTime } from 'luxon';

const TYPE_LABEL: Record<string, string> = {
  PROMOTION: 'Promotion',
  TRANSFER: 'Transfer',
  SALARY_REVISION: 'Salary revision',
};

function summary(c: EmploymentChange): string[] {
  const out: string[] = [];
  if (c.after?.designation !== undefined || c.before?.designation !== undefined)
    out.push(`Designation: ${c.before?.designation ?? '—'} → ${c.after?.designation ?? '—'}`);
  if (c.after?.department !== undefined || c.before?.department !== undefined)
    out.push(`Department: ${c.before?.department ?? '—'} → ${c.after?.department ?? '—'}`);
  if (c.after && 'manager' in c.after || c.before && 'manager' in c.before)
    out.push(`Manager: ${c.before?.manager ?? 'none'} → ${c.after?.manager ?? 'none'}`);
  if (c.after?.workLocationIds)
    out.push(`Work locations: ${c.before?.workLocationIds?.length ?? 0} → ${c.after.workLocationIds.length}`);
  return out;
}

/** Promotions, transfers and salary revisions. HR records them; the change applies to the employee at once. */
export function ChangesTab({ emp }: { emp: Employee }) {
  const { can, active } = useAuth();
  const canRecord = can('employee:change') && active?.employeeId !== emp.id;
  const q = useList<EmploymentChange>('employment-changes', `/employees/${emp.id}/changes`, {});
  const [adding, setAdding] = useState(false);
  if (q.isError) return <Alert tone="danger">{userMessage(q.error)}</Alert>;
  if (!q.data) return <Skeleton className="h-32" />;
  return (
    <div className="space-y-4">
      {canRecord && !isEnded(emp.employmentStatus) ? (
        <div className="flex justify-end">
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" aria-hidden /> Record change
          </Button>
        </div>
      ) : null}
      {q.data.data.length === 0 ? (
        <Empty>No promotions, transfers or salary revisions recorded.</Empty>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border text-sm">
          {q.data.data.map((c) => (
            <li key={c.id} className="space-y-1 p-3">
              <div className="flex items-center justify-between gap-2">
                <Badge tone="neutral">{TYPE_LABEL[c.type] ?? c.type}</Badge>
                <span className="text-xs text-muted">Effective {formatDate(c.effectiveDate)}</span>
              </div>
              {summary(c).map((l) => (
                <p key={l}>{l}</p>
              ))}
              <p className="text-muted">{c.reason}</p>
            </li>
          ))}
        </ul>
      )}
      {adding ? <ChangeForm emp={emp} onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

function ChangeForm({ emp, onClose }: { emp: Employee; onClose: () => void }) {
  const [type, setType] = useState<'PROMOTION' | 'TRANSFER' | 'SALARY_REVISION'>('PROMOTION');
  const [date, setDate] = useState(DateTime.now().toISODate()!);
  const [reason, setReason] = useState('');
  const [designationId, setDesignationId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [managerId, setManagerId] = useState('keep'); // keep | none | an employee id
  const [localError, setLocalError] = useState<string>();
  const desigs = useDesignations();
  const depts = useDepartments();
  const people = useList<Employee>('employees-lookup', '/employees', { limit: 100, status: 'ACTIVE' });
  const save = useSave(
    () =>
      api.post(`/employees/${emp.id}/changes`, {
        type,
        effectiveDate: date,
        reason: reason.trim(),
        ...(type === 'PROMOTION' ? { designationId } : {}),
        ...(type === 'TRANSFER' && departmentId ? { departmentId } : {}),
        ...(type === 'TRANSFER' && managerId !== 'keep'
          ? { managerId: managerId === 'none' ? null : managerId }
          : {}),
      }),
    ['employment-changes', 'employees', 'employees-lookup', 'audit'],
    onClose,
  );
  const submit = () => {
    setLocalError(undefined);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setLocalError('Pick the effective date.');
    if (reason.trim().length < 3) return setLocalError('Give a reason.');
    if (type === 'PROMOTION' && !designationId) return setLocalError('Choose the new designation.');
    if (type === 'TRANSFER' && !departmentId && managerId === 'keep')
      return setLocalError('Choose a new department or manager.');
    save.mutate(undefined);
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Record change · ${emp.firstName} ${emp.lastName}`}
      description="The change applies to the employee record immediately and stays in their history."
    >
      <div className="space-y-3">
        {localError || save.error ? <Alert tone="danger">{localError ?? save.error}</Alert> : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            {(id) => (
              <Select id={id} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                {Object.entries(TYPE_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Effective date" hint="Today or earlier">
            {(id) => <Input id={id} type="date" value={date} max={DateTime.now().toISODate()!} onChange={(e) => setDate(e.target.value)} />}
          </Field>
        </div>
        {type === 'PROMOTION' ? (
          <Field label={`New designation (now: ${emp.designation ?? 'none'})`}>
            {(id) => (
              <Select id={id} value={designationId} onChange={(e) => setDesignationId(e.target.value)}>
                <option value="">Choose…</option>
                {desigs.items.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        {type === 'TRANSFER' ? (
          <>
            <Field label="New department">
              {(id) => (
                <Select id={id} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                  <option value="">No change</option>
                  {depts.items.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Manager">
              {(id) => (
                <Select id={id} value={managerId} onChange={(e) => setManagerId(e.target.value)}>
                  <option value="keep">No change</option>
                  <option value="none">No manager</option>
                  {(people.data?.data ?? [])
                    .filter((p) => p.id !== emp.id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.firstName} {p.lastName} ({p.employeeCode})
                      </option>
                    ))}
                </Select>
              )}
            </Field>
          </>
        ) : null}
        {type === 'SALARY_REVISION' ? (
          <Alert tone="info">
            This records that a revision happened. Set the new pay as a new salary structure under
            Payroll, with the same effective date.
          </Alert>
        ) : null}
        <Field label="Reason">
          {(id) => <Textarea id={id} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={submit}>
            Record
          </Button>
        </div>
      </div>
    </Modal>
  );
}
