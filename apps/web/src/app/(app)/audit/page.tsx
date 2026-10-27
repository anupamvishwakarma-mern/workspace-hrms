'use client';
import { useState } from 'react';
import { Pager } from '@/components/pager';
import { Alert, Empty, PageHeader, Skeleton, Table, Td, Th } from '@/components/ui/display';
import { Field, Input } from '@/components/ui/form';
import { useList } from '@/hooks/api';
import { userMessage } from '@/lib/errors';
import type { AuditEntry } from '@/lib/types';
import { compact } from '@/lib/utils';

const LIMIT = 50;

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const q = useList<AuditEntry>('audit', '/audit-logs', {
    page,
    limit: LIMIT,
    ...compact({
      action: action.trim(),
      from: from ? new Date(`${from}T00:00:00`).toISOString() : '',
      to: to ? new Date(`${to}T23:59:59.999`).toISOString() : '',
    }),
  });
  const reset =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(1);
    };
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Who changed what, newest first. Passwords, tokens and coordinates are never recorded."
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Action">
          {(id) => (
            <Input
              id={id}
              placeholder="e.g. employee.deactivate"
              value={action}
              maxLength={80}
              onChange={(e) => reset(setAction)(e.target.value)}
            />
          )}
        </Field>
        <Field label="From">
          {(id) => (
            <Input
              id={id}
              type="date"
              value={from}
              onChange={(e) => reset(setFrom)(e.target.value)}
            />
          )}
        </Field>
        <Field label="To">
          {(id) => (
            <Input id={id} type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} />
          )}
        </Field>
      </div>
      {q.isError ? <Alert tone="danger">{userMessage(q.error)}</Alert> : null}
      {!q.data ? (
        q.isError ? null : (
          <Skeleton className="h-40" />
        )
      ) : (
        <>
          <Table aria-label="Audit log">
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>Action</Th>
                <Th>Target</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody>
              {q.data.data.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap">{new Date(r.createdAt).toLocaleString()}</Td>
                  <Td>{r.actorEmail ?? 'System'}</Td>
                  <Td className="font-mono text-xs">{r.action}</Td>
                  <Td className="text-xs">{r.entityType}</Td>
                  <Td className="max-w-xs text-xs">
                    {r.reason ? <p>{r.reason}</p> : null}
                    {r.after || r.before ? (
                      <details>
                        <summary className="cursor-pointer text-primary">Changes</summary>
                        <pre className="mt-1 whitespace-pre-wrap break-all">
                          {JSON.stringify({ before: r.before, after: r.after }, null, 1)}
                        </pre>
                      </details>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {q.data.data.length === 0 ? <Empty>No matching entries.</Empty> : null}
          <Pager page={page} limit={LIMIT} total={q.data.meta?.total ?? 0} onPage={setPage} />
        </>
      )}
    </>
  );
}
