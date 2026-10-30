'use client';
import { useMemo, useState } from 'react';
import { Pager } from '@/components/pager';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Alert, Card, CardTitle, Empty, Skeleton, Table, Td, Th } from '@/components/ui/display';
import { Field, Input, Select } from '@/components/ui/form';
import { useAuth } from '@/components/auth';
import { useList } from '@/hooks/api';
import { useDepartments } from '@/hooks/lookups';
import { userMessage } from '@/lib/errors';
import type { DayRow, SummaryRow } from '@/lib/types';
import { cn, formatMinutes, formatTime } from '@/lib/utils';
import { CAL, dayKey, monthEnd, monthLabel, monthStart, weekdayDate } from './lib';
import { MONTH_OPTIONS } from './shared';

const LIMIT = 25;

export function EmployeeRegister({
  currentMonth,
  today,
  tz,
  onDetail,
}: {
  currentMonth: string;
  today: string;
  tz: string;
  onDetail: (id: string) => void;
}) {
  const [month, setMonth] = useState(currentMonth);
  const [departmentId, setDepartmentId] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<SummaryRow>();
  const depts = useDepartments();
  const to = monthEnd(month) < today ? monthEnd(month) : today;
  const q = useList<SummaryRow>(
    'register',
    '/reports/attendance/summary',
    { from: monthStart(month), to, departmentId, page, limit: LIMIT },
    to >= monthStart(month),
  );
  const rows = useMemo(() => {
    const t = search.trim().toLowerCase();
    return (q.data?.data ?? []).filter(
      (r) => !t || r.name.toLowerCase().includes(t) || r.employeeCode.toLowerCase().includes(t),
    );
  }, [q.data, search]);
  const total = q.data?.meta?.total ?? 0;
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <CardTitle className="text-base text-foreground">Employee attendance register</CardTitle>
          <p className="text-xs text-muted">
            {monthLabel(month)} · totals per employee, up to today
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Field label="Search this page">
            {(id) => (
              <Input
                id={id}
                placeholder="Name or employee ID"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
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
          <Field label="Month">
            {(id) => (
              <Select
                id={id}
                value={month}
                onChange={(e) => {
                  setMonth(e.target.value);
                  setPage(1);
                }}
              >
                {MONTH_OPTIONS(currentMonth).map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </div>
      {q.isPending ? (
        <Skeleton className="h-64" />
      ) : q.error ? (
        <Alert tone="danger">{userMessage(q.error)}</Alert>
      ) : (
        <>
          <Table aria-label="Employee attendance register">
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Department</Th>
                <Th>Present</Th>
                <Th>Half day</Th>
                <Th>Absent</Th>
                <Th>Leave</Th>
                <Th>Late</Th>
                <Th>Overtime</Th>
                <Th>LOP days</Th>
                <Th>
                  <span className="sr-only">Open</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employeeId}>
                  <Td>
                    <span className="font-medium">{r.name}</span>
                    <span className="ml-1 text-xs text-muted">{r.employeeCode}</span>
                  </Td>
                  <Td>{r.department ?? '—'}</Td>
                  <Td>{r.present}</Td>
                  <Td>{r.halfDay}</Td>
                  <Td>{r.absent}</Td>
                  <Td>{r.onLeave}</Td>
                  <Td>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-semibold',
                        r.lateDays >= 3
                          ? 'bg-warn-bg text-warn'
                          : r.lateDays
                            ? 'bg-subtle'
                            : 'text-muted',
                      )}
                    >
                      {r.lateDays || 'None'}
                    </span>
                  </Td>
                  <Td>{formatMinutes(r.overtimeMinutes)}</Td>
                  <Td>{r.absent + r.halfDay * 0.5}</Td>
                  <Td className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setOpen(r)}>
                      View
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {rows.length === 0 ? <Empty>No employees match.</Empty> : null}
          <Pager page={page} limit={LIMIT} total={total} onPage={setPage} />
          <p className="mt-1 text-xs text-muted">
            LOP (loss of pay) days = absent days plus half of each half day. Confirm against your
            payroll policy.
          </p>
        </>
      )}
      {open ? (
        <EmployeeDays
          row={open}
          from={monthStart(month)}
          to={to}
          tz={tz}
          onClose={() => setOpen(undefined)}
          onDetail={onDetail}
        />
      ) : null}
    </Card>
  );
}

function EmployeeDays({
  row,
  from,
  to,
  tz,
  onClose,
  onDetail,
}: {
  row: SummaryRow;
  from: string;
  to: string;
  tz: string;
  onClose: () => void;
  onDetail: (id: string) => void;
}) {
  const { can } = useAuth();
  const q = useList<DayRow>('emp-days', '/attendance/days', {
    employeeId: row.employeeId,
    from,
    to,
    limit: 100,
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${row.name} · ${row.employeeCode}`}
      description="Day by day for the selected month."
    >
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : (
        <ul className="divide-y divide-border text-sm">
          {[...(q.data?.data ?? [])]
            .sort((a, b) => b.workDate.localeCompare(a.workDate))
            .map((d) => {
              const k = dayKey(d);
              return (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="w-28">{weekdayDate(d.workDate)}</span>
                  <span className="tabular-nums text-muted">
                    {formatTime(d.firstCheckIn, tz)} –{' '}
                    {d.isOpen ? 'working' : formatTime(d.lastCheckOut, tz)}
                  </span>
                  <span
                    className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', CAL[k].chip)}
                  >
                    {CAL[k].label}
                  </span>
                  {can('attendance:events:read') ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        onClose();
                        onDetail(d.id);
                      }}
                    >
                      Details
                    </Button>
                  ) : null}
                </li>
              );
            })}
        </ul>
      )}
    </Modal>
  );
}
