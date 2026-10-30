'use client';
import { Plus, Trash2 } from 'lucide-react';
import { PageTop } from '@/components/page-top';
import { Columns, Panel } from '../dashboard/charts';
import { StatStrip } from '@/components/page-top';
import { useState } from 'react';
import { Pager } from '@/components/pager';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Alert, Badge, Empty, Skeleton, TabBar, Table, Td, Th } from '@/components/ui/display';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { useList, useOne, useSave } from '@/hooks/api';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import { useI18n } from '@/lib/i18n';
import { componentAmountMinor, formatMoney } from '@/lib/money';
import type { Employee, PayComponent, PayrollRun, SalaryStructure } from '@/lib/types';
import { formatDate } from '@/lib/utils';
import { DateTime } from 'luxon';
import { PayslipView } from './payslip-view';
import { Adjustments, Rules } from './rules-admin';

type Tab = 'runs' | 'structures' | 'rules' | 'adjustments';

export default function PayrollPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('runs');
  return (
    <>
      <PageTop
        scope="runs and salary structures"
        title={t('pay.title')}
        description={t('pay.desc')}
      />
      {tab === 'runs' ? <PayrollSummary /> : null}
      <TabBar
        label="Payroll sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'runs', label: t('pay.runs') },
          { key: 'structures', label: t('pay.structures') },
          { key: 'rules', label: t('pay.rules') },
          { key: 'adjustments', label: t('pay.adjustments') },
        ]}
      />
      {tab === 'runs' ? (
        <Runs />
      ) : tab === 'structures' ? (
        <Structures />
      ) : tab === 'rules' ? (
        <Rules />
      ) : (
        <Adjustments />
      )}
    </>
  );
}

/* ------------------------------ runs ------------------------------ */

const lastFinishedMonth = () => DateTime.now().minus({ months: 1 }).toFormat('yyyy-MM');

function Runs() {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string>();
  const [generating, setGenerating] = useState(false);
  const q = useList<PayrollRun>('payroll-runs', '/payroll/runs', { page, limit: 12 });
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setGenerating(true)}>
          <Plus className="h-4 w-4" aria-hidden /> {t('pay.generate')}
        </Button>
      </div>
      {q.isError ? <Alert tone="danger">{userMessage(q.error)}</Alert> : null}
      {!q.data ? (
        q.isError ? null : (
          <Skeleton className="h-40" />
        )
      ) : (
        <>
          <Table aria-label="Payroll runs">
            <thead>
              <tr>
                <Th>Month</Th>
                <Th>Status</Th>
                <Th>Employees</Th>
                <Th>Gross</Th>
                <Th>Deductions</Th>
                <Th>Net pay</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {q.data.data.map((r) => (
                <tr key={r.id}>
                  <Td className="font-medium">
                    {DateTime.fromISO(`${r.month}-01`).toFormat('LLLL yyyy')}
                  </Td>
                  <Td>
                    <Badge tone={r.status === 'PUBLISHED' ? 'success' : 'warn'}>
                      {r.status === 'PUBLISHED' ? 'Published' : 'Draft'}
                    </Badge>
                  </Td>
                  <Td>{r.totals?.employees ?? 0}</Td>
                  <Td>{formatMoney(r.totals?.grossMinor ?? 0, 'INR')}</Td>
                  <Td>{formatMoney(r.totals?.deductionsMinor ?? 0, 'INR')}</Td>
                  <Td className="font-semibold">{formatMoney(r.totals?.netMinor ?? 0, 'INR')}</Td>
                  <Td>
                    <Button size="sm" variant="secondary" onClick={() => setOpen(r.id)}>
                      Review
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {q.data.data.length === 0 ? <Empty>No payroll has been generated yet.</Empty> : null}
          <Pager page={page} limit={12} total={q.data.meta?.total ?? 0} onPage={setPage} />
        </>
      )}
      {generating ? (
        <Generate
          onClose={(id) => {
            setGenerating(false);
            if (id) setOpen(id);
          }}
        />
      ) : null}
      {open ? <RunDetail id={open} onClose={() => setOpen(undefined)} /> : null}
    </>
  );
}

function Generate({ onClose }: { onClose: (createdId?: string) => void }) {
  const [month, setMonth] = useState(lastFinishedMonth());
  const save = useSave(
    () => api.post<PayrollRun>('/payroll/runs', { month }),
    ['payroll-runs'],
    (r) => onClose((r as { data: PayrollRun }).data.id),
  );
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Generate payroll"
      description="Only fully finished months can be generated. Regenerating a draft replaces it; a published run is final."
    >
      <div className="space-y-3">
        {save.error ? <Alert tone="danger">{save.error}</Alert> : null}
        <Field
          label="Month"
          hint="Calculated from salary structures, attendance and approved unpaid leave."
        >
          {(id) => (
            <Input
              id={id}
              type="month"
              value={month}
              max={lastFinishedMonth()}
              onChange={(e) => setMonth(e.target.value)}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onClose()}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={!/^\d{4}-\d{2}$/.test(month)}
            onClick={() => save.mutate(undefined)}
          >
            Generate
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const WARNING_TEXT: Record<string, string> = {
  NEGATIVE_NET: 'Net pay is negative: fix the salary structure before publishing.',
  INCOMPLETE_DAYS: 'Some days have missing punches and were treated as paid. Check attendance.',
};

function RunDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useI18n();
  const q = useOne<PayrollRun>('payroll-run', `/payroll/runs/${id}`);
  const publish = useSave(
    () => api.post(`/payroll/runs/${id}/publish`),
    ['payroll-runs', 'payroll-run'],
    () => undefined,
  );
  const [slip, setSlip] = useState<string>();
  const run = q.data?.data;
  const blocked = run?.payslips?.some((p) => p.warnings.includes('NEGATIVE_NET'));
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={
        run ? `Payroll · ${DateTime.fromISO(`${run.month}-01`).toFormat('LLLL yyyy')}` : 'Payroll'
      }
    >
      {!run ? (
        q.isError ? (
          <Alert tone="danger">{userMessage(q.error)}</Alert>
        ) : (
          <Skeleton className="h-32" />
        )
      ) : (
        <div className="space-y-4">
          {publish.error ? <Alert tone="danger">{publish.error}</Alert> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={run.status === 'PUBLISHED' ? 'success' : 'warn'}>
              {run.status === 'PUBLISHED' ? `Published ${formatDate(run.publishedAt)}` : 'Draft'}
            </Badge>
            <span className="text-sm text-muted">
              {run.totals?.employees ?? 0} payslips · net{' '}
              {formatMoney(run.totals?.netMinor ?? 0, 'INR')}
            </span>
          </div>
          {run.skipped.length ? (
            <Alert tone="warn">
              <p className="font-medium">Skipped ({run.skipped.length})</p>
              <ul className="list-disc pl-5">
                {run.skipped.map((s) => (
                  <li key={s.employeeId}>
                    {s.name}:{' '}
                    {s.reason === 'NO_SALARY_STRUCTURE' ? 'no salary structure yet' : s.reason}
                  </li>
                ))}
              </ul>
            </Alert>
          ) : null}
          <Table aria-label="Payslips">
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Gross</Th>
                <Th>Net</Th>
                <Th>Employer cost</Th>
                <Th>Notes</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {(run.payslips ?? []).map((p) => (
                <tr key={p.id}>
                  <Td>
                    <span className="font-medium">{p.employee?.name}</span>
                    <span className="block text-xs text-muted">{p.employee?.code}</span>
                  </Td>
                  <Td>{formatMoney(p.grossMinor, p.currency)}</Td>
                  <Td className="font-semibold">{formatMoney(p.netMinor, p.currency)}</Td>
                  <Td>{formatMoney(p.employerMinor ?? 0, p.currency)}</Td>
                  <Td>
                    {p.warnings.map((w) => (
                      <span key={w} className="block text-xs text-warn">
                        {WARNING_TEXT[w] ?? w}
                      </span>
                    ))}
                  </Td>
                  <Td>
                    <Button size="sm" variant="secondary" onClick={() => setSlip(p.id)}>
                      View
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {slip ? <PayslipView id={slip} onClose={() => setSlip(undefined)} /> : null}
          {run.status === 'DRAFT' ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted">
                Publishing makes payslips visible to employees and freezes this month.
              </p>
              <Button
                loading={publish.isPending}
                disabled={!!blocked || (run.payslips?.length ?? 0) === 0}
                onClick={() => {
                  if (
                    window.confirm(
                      'Publish this payroll? Employees will see their payslips and it cannot be changed.',
                    )
                  )
                    publish.mutate(undefined);
                }}
              >
                {t('pay.publish')}
              </Button>
            </div>
          ) : null}
          {blocked ? <Alert tone="danger">{WARNING_TEXT.NEGATIVE_NET}</Alert> : null}
        </div>
      )}
    </Modal>
  );
}

/* --------------------------- salary structures --------------------------- */

function Structures() {
  const people = useList<Employee>('employees-lookup', '/employees', {
    limit: 100,
    status: 'ACTIVE',
  });
  const [empId, setEmpId] = useState('');
  const [editing, setEditing] = useState(false);
  const versions = useList<SalaryStructure>(
    'payroll-structures',
    '/payroll/structures',
    { employeeId: empId },
    !!empId,
  );
  const emp = people.data?.data.find((e) => e.id === empId);
  return (
    <div className="space-y-4">
      <div className="max-w-sm">
        <Field label="Employee">
          {(id) => (
            <Select id={id} value={empId} onChange={(e) => setEmpId(e.target.value)}>
              <option value="">Choose an employee…</option>
              {(people.data?.data ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.firstName} {e.lastName} ({e.employeeCode})
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {!empId ? (
        <Empty>Choose an employee to see or set their salary structure.</Empty>
      ) : versions.isError ? (
        <Alert tone="danger">{userMessage(versions.error)}</Alert>
      ) : !versions.data ? (
        <Skeleton className="h-32" />
      ) : (
        <>
          <div className="flex justify-end">
            <Button onClick={() => setEditing(true)}>
              <Plus className="h-4 w-4" aria-hidden /> New version
            </Button>
          </div>
          {versions.data.data.length === 0 ? <Empty>No salary structure yet.</Empty> : null}
          {versions.data.data.map((s, i) => (
            <StructureCard key={s.id} s={s} current={i === 0} />
          ))}
          <p className="text-xs text-muted">
            Versions are never edited: a change is a new version from its effective date, so past
            payslips stay explainable.
          </p>
        </>
      )}
      {editing && emp ? (
        <StructureForm
          employee={emp}
          previous={versions.data?.data[0]}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </div>
  );
}

function StructureCard({ s, current }: { s: SalaryStructure; current: boolean }) {
  const basic = s.components.find((c) => c.code === 'BASIC')?.value ?? 0;
  const amt = (c: PayComponent) => componentAmountMinor(c, basic);
  const gross = s.components.filter((c) => c.kind === 'EARNING').reduce((n, c) => n + amt(c), 0);
  const ded = s.components.filter((c) => c.kind === 'DEDUCTION').reduce((n, c) => n + amt(c), 0);
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-card">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">From {formatDate(s.effectiveFrom)}</h3>
        {current ? <Badge tone="success">Latest</Badge> : null}
        <span className="ml-auto text-sm text-muted">
          Gross {formatMoney(gross, s.currency)} · Net {formatMoney(gross - ded, s.currency)} /
          month
        </span>
      </div>
      <Table aria-label={`Structure from ${s.effectiveFrom}`}>
        <thead>
          <tr>
            <Th>Component</Th>
            <Th>Type</Th>
            <Th>Basis</Th>
            <Th>Full month</Th>
          </tr>
        </thead>
        <tbody>
          {s.components.map((c) => (
            <tr key={c.code}>
              <Td className="font-medium">{c.name}</Td>
              <Td>
                <Badge tone={c.kind === 'EARNING' ? 'success' : 'warn'}>
                  {c.kind === 'EARNING' ? 'Earning' : 'Deduction'}
                </Badge>
              </Td>
              <Td>{c.calc === 'FIXED' ? 'Fixed' : `${c.value / 100}% of basic`}</Td>
              <Td>{formatMoney(amt(c), s.currency)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {s.note ? <p className="mt-2 text-sm text-muted">{s.note}</p> : null}
    </section>
  );
}

interface Row {
  code: string;
  name: string;
  kind: 'EARNING' | 'DEDUCTION';
  calc: 'FIXED' | 'PERCENT_OF_BASIC';
  amount: string;
  prorate: boolean;
}
const fromComponent = (c: PayComponent): Row => ({
  code: c.code,
  name: c.name,
  kind: c.kind,
  calc: c.calc,
  amount: String(c.value / 100),
  prorate: c.prorate ?? c.kind === 'EARNING',
});

function StructureForm({
  employee,
  previous,
  onClose,
}: {
  employee: Employee;
  previous?: SalaryStructure;
  onClose: () => void;
}) {
  const [from, setFrom] = useState(DateTime.now().startOf('month').toISODate()!);
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<Row[]>(
    previous?.components.length
      ? previous.components.map(fromComponent)
      : [
          {
            code: 'BASIC',
            name: 'Basic',
            kind: 'EARNING',
            calc: 'FIXED',
            amount: '',
            prorate: true,
          },
        ],
  );
  const [localError, setLocalError] = useState<string>();
  const patch = (i: number, p: Partial<Row>) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const save = useSave(
    () =>
      api.post('/payroll/structures', {
        employeeId: employee.id,
        effectiveFrom: from,
        currency: previous?.currency ?? 'INR',
        ...(note.trim() ? { note: note.trim() } : {}),
        components: rows.map((r) => ({
          code: r.code.trim().toUpperCase(),
          name: r.name.trim(),
          kind: r.kind,
          calc: r.calc,
          ...(r.calc === 'FIXED' ? { amount: Number(r.amount) } : { percent: Number(r.amount) }),
          prorate: r.prorate,
        })),
      }),
    ['payroll-structures'],
    onClose,
  );
  const submit = () => {
    setLocalError(undefined);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return setLocalError('Pick an effective date.');
    if (
      rows.some(
        (r) =>
          !r.code.trim() || !r.name.trim() || r.amount === '' || Number.isNaN(Number(r.amount)),
      )
    )
      return setLocalError('Every component needs a code, a name and an amount.');
    save.mutate(undefined);
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Salary structure · ${employee.firstName} ${employee.lastName}`}
      description="Amounts are per full month. Earnings are reduced for loss-of-pay days; deductions are not."
    >
      <div className="space-y-3">
        {localError || save.error ? <Alert tone="danger">{localError ?? save.error}</Alert> : null}
        <Field label="Effective from">
          {(id) => (
            <Input id={id} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          )}
        </Field>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div
              key={i}
              className="grid grid-cols-12 items-end gap-2 rounded-xl border border-border p-2"
            >
              <div className="col-span-4">
                <Field label="Code">
                  {(id) => (
                    <Input
                      id={id}
                      value={r.code}
                      onChange={(e) => patch(i, { code: e.target.value.toUpperCase() })}
                    />
                  )}
                </Field>
              </div>
              <div className="col-span-8">
                <Field label="Name">
                  {(id) => (
                    <Input
                      id={id}
                      value={r.name}
                      onChange={(e) => patch(i, { name: e.target.value })}
                    />
                  )}
                </Field>
              </div>
              <div className="col-span-4">
                <Field label="Type">
                  {(id) => (
                    <Select
                      id={id}
                      value={r.kind}
                      onChange={(e) =>
                        patch(i, {
                          kind: e.target.value as Row['kind'],
                          prorate: e.target.value === 'EARNING',
                        })
                      }
                    >
                      <option value="EARNING">Earning</option>
                      <option value="DEDUCTION">Deduction</option>
                    </Select>
                  )}
                </Field>
              </div>
              <div className="col-span-4">
                <Field label="Basis">
                  {(id) => (
                    <Select
                      id={id}
                      value={r.calc}
                      onChange={(e) => patch(i, { calc: e.target.value as Row['calc'] })}
                    >
                      <option value="FIXED">Fixed amount</option>
                      <option value="PERCENT_OF_BASIC">% of basic</option>
                    </Select>
                  )}
                </Field>
              </div>
              <div className="col-span-3">
                <Field label={r.calc === 'FIXED' ? 'Amount' : 'Percent'}>
                  {(id) => (
                    <Input
                      id={id}
                      inputMode="decimal"
                      value={r.amount}
                      onChange={(e) => patch(i, { amount: e.target.value })}
                    />
                  )}
                </Field>
              </div>
              <div className="col-span-1 pb-1">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove ${r.name || 'component'}`}
                  onClick={() => setRows((x) => x.filter((_, j) => j !== i))}
                  disabled={rows.length === 1}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            setRows((r) => [
              ...r,
              { code: '', name: '', kind: 'EARNING', calc: 'FIXED', amount: '', prorate: true },
            ])
          }
        >
          <Plus className="h-4 w-4" aria-hidden /> Add component
        </Button>
        <Field label="Note (optional)">
          {(id) => (
            <Textarea
              id={id}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={300}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={submit}>
            Save new version
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Headline numbers and a net-pay trend from the latest runs. */
function PayrollSummary() {
  const q = useList<PayrollRun>('payroll-runs', '/payroll/runs', { page: 1, limit: 12 });
  const runs = [...(q.data?.data ?? [])].sort((a, b) => a.month.localeCompare(b.month));
  const last = runs[runs.length - 1];
  const drafts = runs.filter((r) => r.status === 'DRAFT').length;
  return (
    <>
      <StatStrip
        stats={[
          {
            label: 'Latest run',
            value: last ? last.month : '—',
            sub: last ? last.status.toLowerCase() : 'No run yet',
          },
          {
            label: 'Net pay, latest',
            value: last?.totals ? formatMoney(last.totals.netMinor, 'INR') : '—',
          },
          { label: 'People paid', value: last?.totals?.employees ?? '—' },
          {
            label: 'Drafts to publish',
            value: drafts,
            tone: drafts ? 'warn' : 'success',
            sub: 'Employees see payslips once published',
          },
        ]}
      />
      {runs.length > 1 ? (
        <Panel title="Net pay by month" sub="Latest runs, in rupees" className="mb-5">
          <Columns
            label="Net pay for each of the latest payroll runs"
            height={190}
            data={runs.map((r) => ({
              label: r.month.slice(2),
              value: Math.round((r.totals?.netMinor ?? 0) / 100),
            }))}
            format={(n) => n.toLocaleString('en-IN')}
          />
        </Panel>
      ) : null}
    </>
  );
}
