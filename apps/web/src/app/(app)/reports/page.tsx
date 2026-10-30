'use client';
import { ExportButtons } from '@/components/export-buttons';
import type { ExportFormat } from '@/lib/export';
import { useState } from 'react';
import { Pager } from '@/components/pager';
import { PageTop } from '@/components/page-top';
import { Alert, Card, Empty, Skeleton, Table, Td, Th } from '@/components/ui/display';
import { Field, Input, Select } from '@/components/ui/form';
import { useList } from '@/hooks/api';
import { useDepartments, useTenant } from '@/hooks/lookups';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import type { SummaryRow } from '@/lib/types';
import { addDaysIso, formatMinutes, todayIso } from '@/lib/utils';

const LIMIT = 25;

export default function ReportsPage() {
  const tenant = useTenant();
  const tz = tenant.data?.data.timezone;
  const [from, setFrom] = useState<string>();
  const [to, setTo] = useState<string>();
  const [departmentId, setDepartmentId] = useState('');
  const [page, setPage] = useState(1);
  const [exportError, setExportError] = useState<string>();
  const depts = useDepartments();

  const end = to ?? (tz ? addDaysIso(todayIso(tz), -1) : undefined); // today is still in progress
  const start = from ?? (end ? addDaysIso(end, -29) : undefined);
  const q = useList<SummaryRow>(
    'summary',
    '/reports/attendance/summary',
    { from: start, to: end, departmentId, page, limit: LIMIT },
    !!start && !!end,
  );

  async function download(type: 'summary' | 'daily', format: ExportFormat) {
    setExportError(undefined);
    try {
      const { blob, filename } = await api.download('/reports/attendance/export', {
        from: start,
        to: end,
        departmentId,
        type,
        format,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setExportError(userMessage(e));
    }
  }

  const rows = q.data?.data ?? [];
  const sum = (k: 'present' | 'halfDay' | 'absent' | 'onLeave' | 'lateDays' | 'overtimeMinutes') =>
    rows.reduce((n, r) => n + r[k], 0);
  const days =
    start && end ? Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1 : 0;
  return (
    <>
      <PageTop
        scope="reports and exports"
        stats={[
          { label: 'People in scope', value: q.data?.meta?.total ?? '…' },
          {
            label: 'Period',
            value: `${days} days`,
            sub: start && end ? `${start} to ${end}` : undefined,
          },
          { label: 'Present days', value: sum('present'), sub: 'On this page', tone: 'success' },
          {
            label: 'Absent days',
            value: sum('absent'),
            sub: 'On this page',
            tone: sum('absent') ? 'danger' : 'neutral',
          },
          {
            label: 'Late days',
            value: sum('lateDays'),
            sub: 'On this page',
            tone: sum('lateDays') ? 'warn' : 'neutral',
          },
        ]}
        guide={[
          'Pick a date range (up to 93 days) and optionally a department. The table lists one row per person.',
          'Summary downloads one row per person. Daily downloads one row per person per day. Each comes as CSV or Excel.',
          'Today is left out of the default range because it is still in progress.',
          'Every export is recorded in the audit log.',
        ]}
        title="Reports"

        description="Attendance totals per employee. Range up to 93 days. Every export is recorded in the audit log."
        actions={
          <>
            <ExportButtons size="md" prefix="Summary" onExport={(f) => download('summary', f)} />
            <ExportButtons size="md" prefix="Daily" onExport={(f) => download('daily', f)} />
          </>
        }
      />
      <Card className="mb-4 grid gap-3 sm:grid-cols-3">
        <Field label="From">
          {(id) => (
            <Input
              id={id}
              type="date"
              value={start ?? ''}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
          )}
        </Field>
        <Field label="To">
          {(id) => (
            <Input
              id={id}
              type="date"
              value={end ?? ''}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
          )}
        </Field>
        <Field label="Department">
          {(id) => (
            <Select
              id={id}
              value={departmentId}
              onChange={(e) => {
                setDepartmentId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              {depts.items.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </Card>
      {exportError ? (
        <div className="mb-3">
          <Alert tone="danger">{exportError}</Alert>
        </div>
      ) : null}
      {q.isError ? <Alert tone="danger">{userMessage(q.error)}</Alert> : null}
      {q.isPending ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <Table aria-label="Attendance summary">
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Present</Th>
                <Th>Half</Th>
                <Th>Absent</Th>
                <Th>Leave</Th>
                <Th>Holiday</Th>
                <Th>Late days</Th>
                <Th>Late</Th>
                <Th>Worked</Th>
                <Th>Overtime</Th>
              </tr>
            </thead>
            <tbody>
              {q.data?.data.map((r) => (
                <tr key={r.employeeId}>
                  <Td>
                    {r.name}
                    <span className="ml-1 text-xs text-muted">
                      {r.employeeCode}
                      {r.department ? ` · ${r.department}` : ''}
                    </span>
                  </Td>
                  <Td>{r.present}</Td>
                  <Td>{r.halfDay}</Td>
                  <Td>{r.absent}</Td>
                  <Td>{r.onLeave}</Td>
                  <Td>{r.holiday}</Td>
                  <Td>{r.lateDays}</Td>
                  <Td>{formatMinutes(r.lateMinutes)}</Td>
                  <Td>{formatMinutes(r.workedMinutes)}</Td>
                  <Td>{formatMinutes(r.overtimeMinutes)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {q.data?.data.length === 0 ? <Empty>No employees in this scope.</Empty> : null}
          <Pager page={page} limit={LIMIT} total={q.data?.meta?.total ?? 0} onPage={setPage} />
        </>
      )}
    </>
  );
}
