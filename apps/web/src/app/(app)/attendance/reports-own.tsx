'use client';
import { ExportButtons } from '@/components/export-buttons';
import { downloadTable, type ExportFormat } from '@/lib/export';
import { useState } from 'react';
import { Alert, Card } from '@/components/ui/display';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import type { Correction, DayRow, LeaveBalance, LeaveRequest } from '@/lib/types';
import { monthLabel } from './lib';

/** Downloads of the signed-in person's own records. Built from what the API already returns to them. */
export function OwnReports({
  month,
  from,
  to,
  employeeId,
}: {
  month: string;
  from: string;
  to: string;
  employeeId: string;
}) {
  const [error, setError] = useState<string>();
  const run = (key: string, fn: (format: ExportFormat) => Promise<void>) => async (format: ExportFormat) => {
    setError(undefined);
    try {
      await fn(format);
    } catch (e) {
      setError(userMessage(e));
    }
  };
  const cards = [
    {
      key: 'sheet',
      title: 'My attendance sheet',
      text: `Day-wise status, punches and hours for ${monthLabel(month)}.`,
      go: run('sheet', async (fmt) => {
        const r = await api.get<DayRow[]>('/attendance/me/history', { from, to, limit: 100 });
        await downloadTable(`my-attendance-${month}`, [
          [
            'Date',
            'Status',
            'First in',
            'Last out',
            'Worked min',
            'Break min',
            'Late min',
            'Overtime min',
          ],
          ...[...r.data]
            .sort((a, b) => a.workDate.localeCompare(b.workDate))
            .map((d) => [
              d.workDate,
              d.status,
              d.firstCheckIn,
              d.lastCheckOut,
              d.workedMinutes,
              d.breakMinutes,
              d.lateMinutes,
              d.overtimeMinutes,
            ]),
        ], fmt);
      }),
    },
    {
      key: 'leave',
      title: 'My leave ledger',
      text: 'Opening balance, leave taken and closing balance this leave year.',
      go: run('leave', async (fmt) => {
        const [b, l] = await Promise.all([
          api.get<LeaveBalance[]>('/leave/balances', {}),
          api.get<LeaveRequest[]>('/leave/requests', { scope: 'mine', limit: 100 }),
        ]);
        await downloadTable('my-leave-ledger', [
          ['Leave type', 'Allowance', 'Approved days', 'Pending days', 'Remaining'],
          ...b.data.map((x) => [
            x.name,
            x.allowanceDays,
            x.approvedDays,
            x.pendingDays,
            x.remainingDays,
          ]),
          [],
          ['Leave type', 'From', 'To', 'Days', 'Status'],
          ...l.data.map((x) => [x.leaveType?.name, x.startDate, x.endDate, x.days, x.status]),
        ], fmt);
      }),
    },
    {
      key: 'reg',
      title: 'My regularization history',
      text: 'Every request, approver comment and outcome.',
      go: run('reg', async (fmt) => {
        const r = await api.get<Correction[]>('/attendance/corrections', {
          employeeId,
          limit: 100,
        });
        await downloadTable('my-regularization-history', [
          ['Date', 'Reason', 'Applied on', 'Status', 'Reviewer comment'],
          ...r.data.map((c) => [
            c.workDate,
            c.reason,
            c.createdAt?.slice(0, 10),
            c.status,
            c.reviewComment,
          ]),
        ], fmt);
      }),
    },
  ];
  return (
    <section aria-label="My reports">
      <h2 className="text-base font-semibold">Reports</h2>
      <p className="mb-3 text-xs text-muted">Download your own attendance records.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.key} className="flex flex-col gap-3 p-4">
            <div>
              <p className="text-sm font-semibold">{c.title}</p>
              <p className="text-xs text-muted">{c.text}</p>
            </div>
            <ExportButtons className="inline-flex items-center gap-1.5 self-start" onExport={(f) => c.go(f)} />
          </Card>
        ))}
      </div>
      {error ? (
        <div className="mt-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}
    </section>
  );
}
