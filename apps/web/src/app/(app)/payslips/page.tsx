'use client';
import { useState } from 'react';
import { PageTop } from '@/components/page-top';
import { Pager } from '@/components/pager';
import { Button } from '@/components/ui/button';
import { Alert, Empty, Skeleton, Table, Td, Th } from '@/components/ui/display';
import { useList } from '@/hooks/api';
import { userMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/money';
import type { PayslipRow } from '@/lib/types';
import { DateTime } from 'luxon';
import { PayslipView } from '../payroll/payslip-view';

export default function MyPayslipsPage() {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string>();
  const q = useList<PayslipRow>('my-payslips', '/payroll/my/payslips', { page, limit: 12 });
  return (
    <>
      <PageTop
        scope="your payslips"
        title="My payslips"
        description="Payslips appear here once your company publishes them."
      />
      {q.isError ? <Alert tone="danger">{userMessage(q.error)}</Alert> : null}
      {!q.data ? (
        q.isError ? null : (
          <Skeleton className="h-40" />
        )
      ) : q.data.data.length === 0 ? (
        <Empty>No payslip has been published yet.</Empty>
      ) : (
        <>
          <Table aria-label="My payslips">
            <thead>
              <tr>
                <Th>Month</Th>
                <Th>Gross</Th>
                <Th>Deductions</Th>
                <Th>Net pay</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {q.data.data.map((p) => (
                <tr key={p.id}>
                  <Td className="font-medium">
                    {DateTime.fromISO(`${p.month}-01`).toFormat('LLLL yyyy')}
                  </Td>
                  <Td>{formatMoney(p.grossMinor, p.currency)}</Td>
                  <Td>{formatMoney(p.deductionsMinor, p.currency)}</Td>
                  <Td className="font-semibold">{formatMoney(p.netMinor, p.currency)}</Td>
                  <Td>
                    <Button size="sm" variant="secondary" onClick={() => setOpen(p.id)}>
                      View
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pager page={page} limit={12} total={q.data.meta?.total ?? 0} onPage={setPage} />
        </>
      )}
      {open ? <PayslipView id={open} onClose={() => setOpen(undefined)} /> : null}
    </>
  );
}
