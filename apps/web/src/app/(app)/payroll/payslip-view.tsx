'use client';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Alert, Badge, Skeleton, Table, Td, Th } from '@/components/ui/display';
import { useOne } from '@/hooks/api';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/money';
import type { PayslipDetail } from '@/lib/types';
import { downloadBlob } from '../attendance/lib';

const SOURCE: Record<string, string> = { ADJUSTMENT: 'One-off', STATUTORY: 'Statutory' };

/** One payslip: lines, employer contributions and a PDF download. Used by employees and by payroll staff. */
export function PayslipView({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useOne<PayslipDetail>('payslip', `/payroll/payslips/${id}`);
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const p = q.data?.data;

  async function pdf() {
    setErr(undefined);
    setBusy(true);
    try {
      const { blob, filename } = await api.download(`/payroll/payslips/${id}/pdf`, {});
      downloadBlob(blob, filename);
    } catch (e) {
      setErr(userMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const section = (kind: 'EARNING' | 'DEDUCTION', title: string) => {
    const rows = (p?.lines ?? []).filter((l) => l.kind === kind && l.amountMinor !== 0);
    return (
      <div>
        <h3 className="mb-1 text-sm font-semibold">{title}</h3>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">None</p>
        ) : (
          <Table aria-label={title}>
            <thead>
              <tr>
                <Th>Item</Th>
                <Th>Amount</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l, i) => (
                <tr key={`${l.code}-${i}`}>
                  <Td>
                    {l.name}
                    {l.source && SOURCE[l.source] ? (
                      <span className="ml-2 text-xs text-muted">{SOURCE[l.source]}</span>
                    ) : null}
                  </Td>
                  <Td className="tabular-nums">{formatMoney(l.amountMinor, p!.currency)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    );
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={p ? `Payslip · ${p.month}` : 'Payslip'}
      description={p ? `${p.employee?.name ?? ''} (${p.employee?.code ?? ''})` : undefined}
    >
      {!p ? (
        q.isError ? (
          <Alert tone="danger">{userMessage(q.error)}</Alert>
        ) : (
          <Skeleton className="h-40" />
        )
      ) : (
        <div className="space-y-4">
          {err ? <Alert tone="danger">{err}</Alert> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={p.status === 'PUBLISHED' ? 'success' : 'warn'}>
              {p.status === 'PUBLISHED' ? 'Published' : 'Draft'}
            </Badge>
            {p.attendance ? (
              <span className="text-sm text-muted">
                {p.attendance.payableDays} payable of {p.attendance.daysInMonth} days · loss of pay{' '}
                {p.attendance.lopDays}
              </span>
            ) : null}
          </div>
          {section('EARNING', 'Earnings')}
          {section('DEDUCTION', 'Deductions')}
          <dl className="space-y-1 rounded-xl border border-border p-3 text-sm">
            <div className="flex justify-between">
              <dt>Gross earnings</dt>
              <dd className="tabular-nums">{formatMoney(p.grossMinor, p.currency)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Total deductions</dt>
              <dd className="tabular-nums">{formatMoney(p.deductionsMinor, p.currency)}</dd>
            </div>
            <div className="flex justify-between font-semibold">
              <dt>Net pay</dt>
              <dd className="tabular-nums">{formatMoney(p.netMinor, p.currency)}</dd>
            </div>
          </dl>
          {p.employerLines.some((l) => l.amountMinor !== 0) ? (
            <div>
              <h3 className="mb-1 text-sm font-semibold">Employer contributions</h3>
              <p className="mb-1 text-xs text-muted">Paid by the company; not deducted from net pay.</p>
              <ul className="divide-y divide-border text-sm">
                {p.employerLines
                  .filter((l) => l.amountMinor !== 0)
                  .map((l, i) => (
                    <li key={`${l.code}-${i}`} className="flex justify-between py-1.5">
                      <span>{l.name}</span>
                      <span className="tabular-nums">{formatMoney(l.amountMinor, p.currency)}</span>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
          <div className="flex justify-end">
            <Button variant="secondary" loading={busy} onClick={pdf}>
              <Download className="h-4 w-4" aria-hidden /> Download PDF
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
