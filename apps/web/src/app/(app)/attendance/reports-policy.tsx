'use client';
import { ExportButtons } from '@/components/export-buttons';
import type { ExportFormat } from '@/lib/export';
import { useState } from 'react';
import { Alert, Badge, Card, CardTitle, Skeleton } from '@/components/ui/display';
import { useAuth } from '@/components/auth';
import { useList } from '@/hooks/api';
import { useTenant } from '@/hooks/lookups';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import type { Shift, WorkLocation } from '@/lib/types';
import { downloadBlob } from './lib';

const REPORTS = [
  {
    type: 'daily',
    title: 'Monthly attendance sheet',
    text: 'Day-wise status for every employee in the selected month.',
  },
  {
    type: 'summary',
    title: 'Muster roll',
    text: 'Days present, absent, on leave, late and worked for every employee, for payroll.',
  },
] as const;

export function ReportsCards({ from, to }: { from: string; to: string }) {
  const [error, setError] = useState<string>();
  async function run(type: 'daily' | 'summary', format: ExportFormat) {
    setError(undefined);
    try {
      const { blob, filename } = await api.download('/reports/attendance/export', {
        from,
        to,
        type,
        format,
      });
      downloadBlob(blob, filename);
    } catch (e) {
      setError(userMessage(e));
    }
  }
  return (
    <section aria-label="Reports">
      <h2 className="text-base font-semibold">Reports</h2>
      <p className="mb-3 text-xs text-muted">
        Download attendance records for payroll, audit and compliance. Exports cover the month shown
        above and are recorded in the audit log.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => (
          <Card key={r.type} className="flex flex-col gap-3 p-4">
            <div>
              <p className="text-sm font-semibold">{r.title}</p>
              <p className="text-xs text-muted">{r.text}</p>
            </div>
            <ExportButtons className="inline-flex items-center gap-1.5 self-start" onExport={(f) => run(r.type, f)} />
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

const mins = (n?: number) =>
  n === undefined ? '—' : n % 60 === 0 && n >= 60 ? `${n / 60}h` : `${n} min`;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function PolicyCard({ shiftId }: { shiftId?: string }) {
  const { can } = useAuth();
  const shifts = useList<Shift>('shifts', '/shifts', { limit: 100 }, can('shift:read'));
  const s = shifts.data?.data.find((x) => x.id === shiftId);
  const tenant = useTenant().data?.data;
  const a = tenant?.settings?.attendance;
  const rows: [string, string][] = s
    ? [
        ['Shift', `${s.name} · ${s.startTime} – ${s.endTime}`],
        ['Grace period', mins(s.graceMinutes)],
        ['Early-departure grace', mins(s.earlyDepartureGraceMinutes)],
        ['Full day', s.minFullDayMinutes ? `${mins(s.minFullDayMinutes)} net work or more` : '—'],
        ['Half day', s.minHalfDayMinutes ? `${mins(s.minHalfDayMinutes)} net work or more` : '—'],
        [
          'Break',
          s.breakPolicy?.autoDeductMinutes
            ? `${s.breakPolicy.autoDeductMinutes} min deducted`
            : s.breakPolicy?.paidAllowanceMinutes
              ? `${s.breakPolicy.paidAllowanceMinutes} min paid allowance`
              : 'No deduction',
        ],
        ['Weekly off', s.weeklyOffDays.map((d) => DAYS[d]).join(' and ') || 'None'],
      ]
    : [];
  return (
    <Card>
      <CardTitle className="mb-2 text-base text-foreground">Attendance policy</CardTitle>
      {shifts.isPending && can('shift:read') ? (
        <Skeleton className="h-32" />
      ) : rows.length ? (
        <dl className="divide-y divide-border text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 py-2">
              <dt className="text-muted">{k}</dt>
              <dd className="text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-muted">You do not have a shift assigned yet.</p>
      )}
      {a ? (
        <p className="mt-3 text-xs text-muted">
          Location check {a.requireGeofence ? 'is required' : 'is not required'} · Photo{' '}
          {a.requirePhoto ? 'is required' : 'is not required'} · Open sessions close after{' '}
          {a.maxOpenSessionHours ?? '—'}h.
        </p>
      ) : null}
    </Card>
  );
}

export function PunchSourcesCard() {
  const { can } = useAuth();
  const locs = useList<WorkLocation>(
    'work-locations',
    '/work-locations',
    { limit: 20 },
    can('location:read'),
  );
  const a = useTenant().data?.data.settings?.attendance;
  return (
    <Card>
      <CardTitle className="mb-2 text-base text-foreground">Punch sources</CardTitle>
      <ul className="divide-y divide-border text-sm">
        <li className="flex items-center justify-between gap-3 py-2">
          <span>
            <span className="font-medium">Mobile app</span>
            <span className="block text-xs text-muted">
              {a?.requireGeofence ? 'Geo-fence enforced' : 'Geo-fence not enforced'}
            </span>
          </span>
          <Badge tone="success">Active</Badge>
        </li>
        <li className="flex items-center justify-between gap-3 py-2">
          <span>
            <span className="font-medium">Web portal</span>
            <span className="block text-xs text-muted">Punch from this page</span>
          </span>
          <Badge tone="success">Active</Badge>
        </li>
        {(locs.data?.data ?? [])
          .filter((l) => l.status === 'ACTIVE')
          .map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 py-2">
              <span>
                <span className="font-medium">{l.name}</span>
                <span className="block text-xs text-muted">
                  {l.radiusMeters} m radius{l.address ? ` · ${l.address}` : ''}
                </span>
              </span>
              <Badge tone="info">Site</Badge>
            </li>
          ))}
      </ul>
    </Card>
  );
}

export function AlertsCard({
  items,
}: {
  items: { tone: 'warn' | 'danger' | 'info'; title: string; text: string }[];
}) {
  return (
    <Card>
      <CardTitle className="mb-2 text-base text-foreground">Alerts</CardTitle>
      {items.length === 0 ? (
        <p className="text-sm text-muted">Nothing needs your attention.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.title + i.text}>
              <Alert tone={i.tone}>
                <span className="font-semibold">{i.title}.</span> {i.text}
              </Alert>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
