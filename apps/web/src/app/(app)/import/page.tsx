'use client';
import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { PageTop } from '@/components/page-top';
import { useAuth } from '@/components/auth';
import { ExportButtons } from '@/components/export-buttons';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, CardTitle, TabBar, Table, Td, Th } from '@/components/ui/display';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import { downloadTable, type ExportFormat } from '@/lib/export';
import {
  BALANCE_COLUMNS,
  EMPLOYEE_COLUMNS,
  MAX_ROWS,
  instructionRows,
  mapRows,
  readSpreadsheet,
  templateRows,
  type ColumnDef,
  type Mapped,
} from '@/lib/import-file';

interface RowResult {
  row: number;
  name?: string;
  email?: string;
  status: 'OK' | 'CREATED' | 'ERROR';
  errors: string[];
  warnings: string[];
  employeeCode?: string;
}
interface Outcome {
  dryRun: boolean;
  summary: Record<string, number | string[] | undefined> & { total: number; valid: number; failed: number; created: number };
  rows: RowResult[];
}
type Kind = 'employees' | 'balances';

const KINDS = {
  employees: {
    title: 'Employees',
    path: '/employees/import',
    cols: EMPLOYEE_COLUMNS,
    file: 'employee-import-template',
    blurb: 'Add everyone at once. People are created as invited records; they can sign in once you send invitations (tick the box below, or do it later from Employees).',
  },
  balances: {
    title: 'Opening leave balances',
    path: '/leave/balances/import',
    cols: BALANCE_COLUMNS,
    file: 'leave-balance-import-template',
    blurb: 'Bring over leave days people already have. Each person, leave type and year can be imported once; import employees first.',
  },
} as const;

export default function ImportPage() {
  const { can, hasModule } = useAuth();
  const tabs = [
    ...(can('employee:create') ? [{ key: 'employees' as Kind, label: 'Employees' }] : []),
    ...(can('leave:manage') && hasModule('LEAVE') ? [{ key: 'balances' as Kind, label: 'Opening leave balances' }] : []),
  ];
  const [kind, setKind] = useState<Kind>(tabs[0]?.key ?? 'employees');
  return (
    <>
      <PageTop
        scope="company data"
        title="Bulk import"
        guide={[
          'Download the template (CSV or Excel), fill it in, then upload it here. Nothing is saved until you press Import.',
          'The file is checked first. Rows with problems are listed with the reason; fix them and upload again, or import the good rows now.',
          'Up to 1000 rows per file. Every import is recorded in the audit log.',
        ]}
      />
      {tabs.length > 1 ? <TabBar tabs={tabs} value={kind} onChange={setKind} label="What to import" /> : null}
      {tabs.length === 0 ? <Alert tone="info">You do not have access to any import.</Alert> : <Importer key={kind} kind={kind} />}
    </>
  );
}

function Importer({ kind }: { kind: Kind }) {
  const cfg = KINDS[kind];
  const cols: ColumnDef[] = cfg.cols;
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string>();
  const [mapped, setMapped] = useState<Mapped>();
  const [error, setError] = useState<string>();
  const [checked, setChecked] = useState<Outcome>();
  const [done, setDone] = useState<Outcome>();
  const [busy, setBusy] = useState<'check' | 'import'>();
  const [createMissing, setCreateMissing] = useState(false);
  const [invite, setInvite] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(false);

  const reset = () => {
    setMapped(undefined);
    setChecked(undefined);
    setDone(undefined);
    setError(undefined);
    setFileName(undefined);
    if (input.current) input.current.value = '';
  };

  async function pick(file: File | undefined) {
    reset();
    if (!file) return;
    try {
      const table = await readSpreadsheet(file);
      const m = mapRows(table, cols);
      setFileName(file.name);
      if (m.missing.length) throw new Error(`The file is missing the column${m.missing.length > 1 ? 's' : ''}: ${m.missing.join(', ')}. Download the template to see the headings.`);
      if (!m.rows.length) throw new Error('The file has a heading row but no data rows.');
      if (m.rows.length > MAX_ROWS) throw new Error(`The file has ${m.rows.length} rows. The limit is ${MAX_ROWS} per file; split it and import in parts.`);
      setMapped(m);
    } catch (e) {
      setFileName(undefined);
      setError(e instanceof Error ? e.message : userMessage(e));
    }
  }

  async function send(dryRun: boolean) {
    if (!mapped) return;
    setBusy(dryRun ? 'check' : 'import');
    setError(undefined);
    try {
      const body = kind === 'employees' ? { rows: mapped.rows, createMissing, invite, dryRun } : { rows: mapped.rows, dryRun };
      const res = await api.post<Outcome>(cfg.path, body);
      if (dryRun) {
        setChecked(res.data);
        setDone(undefined);
      } else {
        setDone(res.data);
        setChecked(undefined);
      }
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setBusy(undefined);
    }
  }

  const template = (f: ExportFormat) =>
    downloadTable(cfg.file, templateRows(cols), f, { sheet: cfg.title, extraSheets: [{ name: 'Instructions', rows: instructionRows(cols) }] });
  const outcome = done ?? checked;
  const report = (f: ExportFormat) =>
    downloadTable(
      `${kind}-import-report`,
      [
        ['Row', 'Name', 'Email', 'Result', 'Employee code', 'Problems', 'Notes'],
        ...(outcome?.rows ?? []).map((r) => [r.row, r.name, r.email, r.status === 'ERROR' ? 'Not imported' : r.status === 'CREATED' ? 'Imported' : 'Ready', r.employeeCode, r.errors.join('; '), r.warnings.join('; ')]),
      ],
      f,
    );
  const shown = (outcome?.rows ?? []).filter((r) => !onlyProblems || r.status === 'ERROR' || r.warnings.length);
  const s = outcome?.summary;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{cfg.blurb}</p>
      <Card className="space-y-3">
        <CardTitle className="text-base text-foreground">1. Get the template</CardTitle>
        <p className="text-sm text-muted">
          The Excel template has an Instructions sheet. Keep the heading row; delete the two sample rows. Dates: YYYY-MM-DD or DD/MM/YYYY (day first).
        </p>
        <ExportButtons size="md" prefix="Template" onExport={template} />
      </Card>

      <Card className="space-y-3">
        <CardTitle className="text-base text-foreground">2. Upload your file</CardTitle>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={input}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            aria-label="Choose a CSV or Excel file"
            className="text-sm"
            onChange={(e) => void pick(e.target.files?.[0])}
          />
          {fileName ? (
            <Button variant="secondary" size="sm" onClick={reset}>
              Clear
            </Button>
          ) : null}
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {mapped ? (
          <p className="text-sm">
            <b>{fileName}</b>: {mapped.rows.length} row{mapped.rows.length === 1 ? '' : 's'}, {mapped.matched} column{mapped.matched === 1 ? '' : 's'} recognised.
            {mapped.ignored.length ? <span className="text-muted"> Ignored columns: {mapped.ignored.join(', ')}.</span> : null}
          </p>
        ) : null}
        {mapped && kind === 'employees' ? (
          <div className="space-y-2 text-sm">
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={createMissing} onChange={(e) => { setCreateMissing(e.target.checked); setChecked(undefined); }} />
              <span>Create missing departments and designations<span className="block text-xs text-muted">Otherwise a row naming one that does not exist is rejected.</span></span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={invite} onChange={(e) => setInvite(e.target.checked)} />
              <span>Send each person an activation email now<span className="block text-xs text-muted">They get a login with the Role from the file (Employee or Manager). Leave unticked to invite later.</span></span>
            </label>
          </div>
        ) : null}
        {mapped ? (
          <div>
            <Button loading={busy === 'check'} onClick={() => void send(true)}>
              Check file
            </Button>
          </div>
        ) : null}
      </Card>

      {s ? (
        <Card className="space-y-3">
          <CardTitle className="text-base text-foreground">3. {done ? 'Result' : 'Check result'}</CardTitle>
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge tone="info">{s.total} rows</Badge>
            <Badge tone="success">{done ? `${s.created} imported` : `${s.valid} ready`}</Badge>
            <Badge tone={s.failed ? 'danger' : 'neutral'}>{s.failed} with problems</Badge>
            {done && typeof s.invited === 'number' && s.invited > 0 ? <Badge tone="info">{s.invited} invited</Badge> : null}
            {done && typeof s.departmentsCreated === 'number' && s.departmentsCreated > 0 ? <Badge tone="neutral">{s.departmentsCreated} departments added</Badge> : null}
            {done && typeof s.designationsCreated === 'number' && s.designationsCreated > 0 ? <Badge tone="neutral">{s.designationsCreated} designations added</Badge> : null}
          </div>
          {Array.isArray(s.newDepartments) && s.newDepartments.length ? <p className="text-sm text-muted">Will add departments: {s.newDepartments.join(', ')}.</p> : null}
          {Array.isArray(s.newDesignations) && s.newDesignations.length ? <p className="text-sm text-muted">Will add designations: {s.newDesignations.join(', ')}.</p> : null}
          {!done && s.valid > 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button loading={busy === 'import'} onClick={() => void send(false)}>
                Import {s.valid} row{s.valid === 1 ? '' : 's'}
              </Button>
              {s.failed ? <span className="text-xs text-muted">The {s.failed} row{s.failed === 1 ? '' : 's'} with problems will be skipped.</span> : null}
            </div>
          ) : null}
          {!done && s.valid === 0 ? <Alert tone="danger">No row can be imported. Fix the problems below and upload the file again.</Alert> : null}
          {done && s.failed ? <Alert tone="info">Rows with problems were not imported. Download the report, fix those rows in your file, and upload only those.</Alert> : null}
          <div className="flex flex-wrap items-center gap-4">
            <ExportButtons prefix="Report" onExport={report} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Only rows with problems
            </label>
          </div>
          <Table aria-label="Import rows">
            <thead>
              <tr>
                <Th>Row</Th>
                <Th>Person</Th>
                <Th>Result</Th>
                <Th>Problems</Th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 300).map((r) => (
                <tr key={r.row}>
                  <Td className="tabular-nums">{r.row}</Td>
                  <Td>
                    {r.name ?? '—'}
                    <span className="block text-xs text-muted">{r.email}{r.employeeCode ? ` · ${r.employeeCode}` : ''}</span>
                  </Td>
                  <Td>
                    <Badge tone={r.status === 'ERROR' ? 'danger' : 'success'}>{r.status === 'ERROR' ? 'Not imported' : r.status === 'CREATED' ? 'Imported' : 'Ready'}</Badge>
                  </Td>
                  <Td className="text-sm">
                    {r.errors.map((e) => <span key={e} className="block text-danger">{e}</span>)}
                    {r.warnings.map((e) => <span key={e} className="block text-warn">{e}</span>)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {shown.length > 300 ? <p className="text-xs text-muted">Showing the first 300 rows. The report has all of them.</p> : null}
          {!shown.length ? <p className="text-sm text-muted">No rows to show.</p> : null}
          {done ? (
            <div>
              <Button variant="secondary" onClick={reset}>
                <Upload className="h-4 w-4" aria-hidden /> Import another file
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
