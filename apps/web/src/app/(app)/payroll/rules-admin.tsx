'use client';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Alert, Badge, Empty, Skeleton, Table, Td, Th } from '@/components/ui/display';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { useList, useSave } from '@/hooks/api';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import type { Employee, PayrollAdjustment, StatutoryRule } from '@/lib/types';
import { formatDate } from '@/lib/utils';
import { DateTime } from 'luxon';

const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
const rupees = (n?: number) =>
  n == null ? '' : n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/* ------------------------------ rules ------------------------------ */

export function Rules() {
  const q = useList<StatutoryRule>('payroll-rules', '/payroll/statutory-rules', { limit: 100 });
  const [form, setForm] = useState<{ base?: StatutoryRule } | null>(null);
  const toggle = useSave(
    (r: StatutoryRule) =>
      api.patch(`/payroll/statutory-rules/${r.id}`, {
        status: r.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
      }),
    ['payroll-rules'],
  );
  return (
    <div className="space-y-4">
      <Alert tone="info">
        The product supplies no rates. Enter the rules your company must follow, with their source
        in the reference field, and have them checked by a qualified professional. Rules apply to
        payroll months from their effective date; published payslips never change.
      </Alert>
      {toggle.error ? <Alert tone="danger">{toggle.error}</Alert> : null}
      <div className="flex justify-end">
        <Button onClick={() => setForm({})}>
          <Plus className="h-4 w-4" aria-hidden /> Add rule
        </Button>
      </div>
      {q.isError ? (
        <Alert tone="danger">{userMessage(q.error)}</Alert>
      ) : !q.data ? (
        <Skeleton className="h-32" />
      ) : q.data.data.length === 0 ? (
        <Empty>No rules configured. Payslips contain only salary structure lines and adjustments.</Empty>
      ) : (
        <Table aria-label="Statutory rules">
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Paid by</Th>
              <Th>Method</Th>
              <Th>From</Th>
              <Th>Status</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {q.data.data.map((r) => (
              <tr key={r.id}>
                <Td className="font-mono text-xs">{r.code}</Td>
                <Td>
                  <span className="font-medium">{r.name}</span>
                  {r.reference ? <span className="block text-xs text-muted">{r.reference}</span> : null}
                </Td>
                <Td>{r.party === 'EMPLOYEE' ? 'Employee (deducted)' : 'Employer (not deducted)'}</Td>
                <Td>
                  {r.method === 'PERCENT'
                    ? `${r.percent}% of wage`
                    : r.method === 'FIXED'
                      ? `Fixed ${rupees(r.fixed)}`
                      : `${r.slabs.length} slabs`}
                </Td>
                <Td>
                  {formatDate(r.effectiveFrom)}
                  {r.effectiveTo ? ` to ${formatDate(r.effectiveTo)}` : ''}
                </Td>
                <Td>
                  <Badge tone={r.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {r.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                  </Badge>
                </Td>
                <Td className="space-x-1 whitespace-nowrap">
                  <Button size="sm" variant="secondary" onClick={() => setForm({ base: r })}>
                    New version
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => toggle.mutate(r)}>
                    {r.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {form ? <RuleForm base={form.base} onClose={() => setForm(null)} /> : null}
    </div>
  );
}

interface SlabRow {
  from: string;
  to: string;
  amount: string;
}

function RuleForm({ base, onClose }: { base?: StatutoryRule; onClose: () => void }) {
  const [code, setCode] = useState(base?.code ?? '');
  const [name, setName] = useState(base?.name ?? '');
  const [party, setParty] = useState<'EMPLOYEE' | 'EMPLOYER'>(base?.party ?? 'EMPLOYEE');
  const [method, setMethod] = useState<'PERCENT' | 'SLAB' | 'FIXED'>(base?.method ?? 'PERCENT');
  const [components, setComponents] = useState((base?.wageComponents ?? []).join(', '));
  const [percent, setPercent] = useState(base?.percent != null ? String(base.percent) : '');
  const [ceiling, setCeiling] = useState(base?.wageCeiling != null ? String(base.wageCeiling) : '');
  const [cap, setCap] = useState(base?.cap != null ? String(base.cap) : '');
  const [fixed, setFixed] = useState(base?.fixed != null ? String(base.fixed) : '');
  const [slabs, setSlabs] = useState<SlabRow[]>(
    base?.slabs.length
      ? base.slabs.map((s) => ({ from: String(s.from), to: s.to != null ? String(s.to) : '', amount: String(s.amount) }))
      : [{ from: '0', to: '', amount: '' }],
  );
  const [from, setFrom] = useState(DateTime.now().startOf('month').toISODate()!);
  const [reference, setReference] = useState(base?.reference ?? '');
  const [localError, setLocalError] = useState<string>();

  const save = useSave(
    () =>
      api.post('/payroll/statutory-rules', {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        party,
        method,
        wageComponents: components
          .split(',')
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean),
        effectiveFrom: from,
        reference: reference.trim(),
        ...(method === 'PERCENT'
          ? {
              percent: Number(percent),
              ...(num(ceiling) !== undefined ? { wageCeiling: num(ceiling) } : {}),
              ...(num(cap) !== undefined ? { cap: num(cap) } : {}),
            }
          : method === 'FIXED'
            ? { fixed: Number(fixed) }
            : {
                slabs: slabs.map((s) => ({
                  from: Number(s.from),
                  ...(num(s.to) !== undefined ? { to: num(s.to) } : {}),
                  amount: Number(s.amount),
                })),
              }),
      }),
    ['payroll-rules'],
    onClose,
  );
  const submit = () => {
    setLocalError(undefined);
    if (!code.trim() || !name.trim()) return setLocalError('Enter a code and a name.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return setLocalError('Pick an effective date.');
    if (method === 'PERCENT' && !(Number(percent) > 0)) return setLocalError('Enter a percentage above 0.');
    if (method === 'FIXED' && (fixed.trim() === '' || Number.isNaN(Number(fixed))))
      return setLocalError('Enter the fixed amount.');
    if (method === 'SLAB' && slabs.some((s) => s.from === '' || s.amount === ''))
      return setLocalError('Every slab needs a start and an amount.');
    save.mutate(undefined);
  };
  const patchSlab = (i: number, p: Partial<SlabRow>) =>
    setSlabs((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={base ? `New version of ${base.code}` : 'Add rule'}
      description="Amounts in whole currency units. Versions share a code and differ by effective date."
    >
      <div className="space-y-3">
        {localError || save.error ? <Alert tone="danger">{localError ?? save.error}</Alert> : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code">
            {(id) => (
              <Input id={id} value={code} disabled={!!base} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            )}
          </Field>
          <Field label="Name">
            {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Paid by">
            {(id) => (
              <Select id={id} value={party} onChange={(e) => setParty(e.target.value as typeof party)}>
                <option value="EMPLOYEE">Employee (deducted from pay)</option>
                <option value="EMPLOYER">Employer (shown, not deducted)</option>
              </Select>
            )}
          </Field>
          <Field label="Method">
            {(id) => (
              <Select id={id} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                <option value="PERCENT">Percentage of wage</option>
                <option value="SLAB">Slabs by wage</option>
                <option value="FIXED">Fixed amount</option>
              </Select>
            )}
          </Field>
        </div>
        <Field
          label="Wage components"
          hint="Codes of salary components the rule is measured on, comma separated (e.g. BASIC). Leave empty for all earnings."
        >
          {(id) => <Input id={id} value={components} onChange={(e) => setComponents(e.target.value)} />}
        </Field>
        {method === 'PERCENT' ? (
          <div className="grid grid-cols-3 gap-3">
            <Field label="Percent">
              {(id) => <Input id={id} inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} />}
            </Field>
            <Field label="Wage ceiling">
              {(id) => <Input id={id} inputMode="decimal" value={ceiling} onChange={(e) => setCeiling(e.target.value)} />}
            </Field>
            <Field label="Cap on amount">
              {(id) => <Input id={id} inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} />}
            </Field>
          </div>
        ) : method === 'FIXED' ? (
          <Field label="Amount">
            {(id) => <Input id={id} inputMode="decimal" value={fixed} onChange={(e) => setFixed(e.target.value)} />}
          </Field>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted">A slab starts at its "from" wage (inclusive) and ends before "to" (leave empty for no upper limit).</p>
            {slabs.map((s, i) => (
              <div key={i} className="grid grid-cols-12 items-end gap-2">
                <div className="col-span-4">
                  <Field label="From">
                    {(id) => <Input id={id} inputMode="decimal" value={s.from} onChange={(e) => patchSlab(i, { from: e.target.value })} />}
                  </Field>
                </div>
                <div className="col-span-4">
                  <Field label="To">
                    {(id) => <Input id={id} inputMode="decimal" value={s.to} onChange={(e) => patchSlab(i, { to: e.target.value })} />}
                  </Field>
                </div>
                <div className="col-span-3">
                  <Field label="Amount">
                    {(id) => <Input id={id} inputMode="decimal" value={s.amount} onChange={(e) => patchSlab(i, { amount: e.target.value })} />}
                  </Field>
                </div>
                <div className="col-span-1 pb-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Remove slab"
                    disabled={slabs.length === 1}
                    onClick={() => setSlabs((r) => r.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
            <Button variant="secondary" size="sm" onClick={() => setSlabs((r) => [...r, { from: '', to: '', amount: '' }])}>
              <Plus className="h-4 w-4" aria-hidden /> Add slab
            </Button>
          </div>
        )}
        <Field label="Effective from">
          {(id) => <Input id={id} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}
        </Field>
        <Field label="Source reference" hint="Where these figures come from (notification, policy, advice received).">
          {(id) => <Textarea id={id} rows={2} maxLength={300} value={reference} onChange={(e) => setReference(e.target.value)} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={submit}>
            Save rule
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------------------- adjustments ---------------------------- */

export function Adjustments() {
  const [month, setMonth] = useState(DateTime.now().minus({ months: 1 }).toFormat('yyyy-MM'));
  const [adding, setAdding] = useState(false);
  const people = useList<Employee>('employees-lookup', '/employees', { limit: 100, status: 'ACTIVE' });
  const q = useList<PayrollAdjustment>('payroll-adjustments', '/payroll/adjustments', { month, limit: 100 });
  const name = (id: string) => {
    const e = people.data?.data.find((x) => x.id === id);
    return e ? `${e.firstName} ${e.lastName} (${e.employeeCode})` : id;
  };
  const voidIt = useSave(
    (a: PayrollAdjustment) => api.post(`/payroll/adjustments/${a.id}/void`),
    ['payroll-adjustments'],
  );
  return (
    <div className="space-y-4">
      <Alert tone="info">
        One-off earnings or deductions for a single month, such as a bonus, a recovery or income
        tax deducted at source (entered by you; the product does not calculate income tax). They are
        not reduced for loss of pay. Adjustments take effect when the month is generated, and
        cannot be changed once it is published.
      </Alert>
      {voidIt.error ? <Alert tone="danger">{voidIt.error}</Alert> : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-[12rem]">
          <Field label="Month">
            {(id) => <Input id={id} type="month" value={month} onChange={(e) => setMonth(e.target.value)} />}
          </Field>
        </div>
        <Button onClick={() => setAdding(true)} disabled={!/^\d{4}-\d{2}$/.test(month)}>
          <Plus className="h-4 w-4" aria-hidden /> Add adjustment
        </Button>
      </div>
      {q.isError ? (
        <Alert tone="danger">{userMessage(q.error)}</Alert>
      ) : !q.data ? (
        <Skeleton className="h-32" />
      ) : q.data.data.length === 0 ? (
        <Empty>No adjustments for this month.</Empty>
      ) : (
        <Table aria-label="Adjustments">
          <thead>
            <tr>
              <Th>Employee</Th>
              <Th>Item</Th>
              <Th>Amount</Th>
              <Th>Reason</Th>
              <Th>Status</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {q.data.data.map((a) => (
              <tr key={a.id}>
                <Td>{name(a.employeeId)}</Td>
                <Td>
                  {a.label}
                  <span className="block text-xs text-muted">{a.kind === 'EARNING' ? 'Earning' : 'Deduction'}</span>
                </Td>
                <Td className="tabular-nums">{rupees(a.amount)}</Td>
                <Td className="max-w-xs text-sm">{a.reason}</Td>
                <Td>
                  <Badge tone={a.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {a.status === 'ACTIVE' ? 'Active' : 'Voided'}
                  </Badge>
                </Td>
                <Td>
                  {a.status === 'ACTIVE' ? (
                    <Button size="sm" variant="ghost" loading={voidIt.isPending} onClick={() => voidIt.mutate(a)}>
                      Void
                    </Button>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {adding ? <AdjustmentForm month={month} people={people.data?.data ?? []} onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

function AdjustmentForm({ month, people, onClose }: { month: string; people: Employee[]; onClose: () => void }) {
  const [employeeId, setEmployeeId] = useState('');
  const [kind, setKind] = useState<'EARNING' | 'DEDUCTION'>('EARNING');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [localError, setLocalError] = useState<string>();
  const save = useSave(
    () =>
      api.post('/payroll/adjustments', {
        employeeId,
        month,
        kind,
        label: label.trim(),
        amount: Number(amount),
        reason: reason.trim(),
      }),
    ['payroll-adjustments'],
    onClose,
  );
  const submit = () => {
    setLocalError(undefined);
    if (!employeeId) return setLocalError('Choose an employee.');
    if (!label.trim()) return setLocalError('Enter a label for the payslip line.');
    if (!(Number(amount) > 0)) return setLocalError('Enter an amount above 0.');
    if (reason.trim().length < 3) return setLocalError('Give a reason.');
    save.mutate(undefined);
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Add adjustment · ${month}`}>
      <div className="space-y-3">
        {localError || save.error ? <Alert tone="danger">{localError ?? save.error}</Alert> : null}
        <Field label="Employee">
          {(id) => (
            <Select id={id} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Choose an employee…</option>
              {people.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.firstName} {e.lastName} ({e.employeeCode})
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            {(id) => (
              <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                <option value="EARNING">Earning</option>
                <option value="DEDUCTION">Deduction</option>
              </Select>
            )}
          </Field>
          <Field label="Amount">
            {(id) => <Input id={id} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
          </Field>
        </div>
        <Field label="Label on payslip">
          {(id) => <Input id={id} value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} />}
        </Field>
        <Field label="Reason (kept in the audit trail)">
          {(id) => <Textarea id={id} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={submit}>
            Add
          </Button>
        </div>
      </div>
    </Modal>
  );
}
