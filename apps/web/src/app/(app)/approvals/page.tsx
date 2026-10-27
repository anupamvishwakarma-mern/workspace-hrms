'use client';
import { useState } from 'react';
import { Pager } from '@/components/pager';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import {
  Alert,
  Badge,
  Empty,
  PageHeader,
  Skeleton,
  TabBar,
  Table,
  Td,
  Th,
  statusTone,
} from '@/components/ui/display';
import { Field, Select, Textarea } from '@/components/ui/form';
import { useList, useSave } from '@/hooks/api';
import { useTenant } from '@/hooks/lookups';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import type { Correction, ExceptionReq } from '@/lib/types';
import { formatDate, formatTime, label } from '@/lib/utils';

type Kind = 'corrections' | 'exceptions';
type Row = (Correction | ExceptionReq) & {
  employee?: { firstName: string; lastName: string; employeeCode: string };
};
const LIMIT = 20;

export default function ApprovalsPage() {
  const [kind, setKind] = useState<Kind>('corrections');
  const [status, setStatus] = useState('PENDING');
  const [page, setPage] = useState(1);
  const [deciding, setDeciding] = useState<{ row: Row; action: 'approve' | 'reject' }>();
  const tz = useTenant().data?.data.timezone ?? 'UTC';
  const q = useList<Row>('approvals', `/attendance/${kind}`, { status, page, limit: LIMIT });

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Review correction and location-approval requests. You cannot approve your own."
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <TabBar
          label="Request type"
          className="mb-0.5"
          value={kind}
          onChange={(k) => {
            setKind(k);
            setPage(1);
          }}
          tabs={[
            { key: 'corrections', label: 'Corrections' },
            { key: 'exceptions', label: 'Location approvals' },
          ]}
        />
        <Field label="Status">
          {(id) => (
            <Select
              id={id}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              {['PENDING', 'APPROVED', 'REJECTED'].map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {q.isError ? <Alert tone="danger">{userMessage(q.error)}</Alert> : null}
      {q.isPending ? (
        <Skeleton className="h-48" />
      ) : (
        <>
          <Table aria-label={kind}>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>{kind === 'corrections' ? 'Date' : 'When'}</Th>
                <Th>Request</Th>
                <Th>Reason</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {q.data?.data.map((r) => {
                const c = r as Correction;
                const x = r as ExceptionReq;
                return (
                  <tr key={r.id}>
                    <Td>
                      {r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : '—'}
                      <span className="ml-1 text-xs text-muted">{r.employee?.employeeCode}</span>
                    </Td>
                    <Td>
                      {kind === 'corrections'
                        ? formatDate(c.workDate)
                        : `${formatDate(x.occurredAt)} ${formatTime(x.occurredAt, tz)}`}
                    </Td>
                    <Td>
                      {kind === 'corrections' ? (
                        `In ${formatTime(c.requestedChanges?.checkIn, tz)} · Out ${formatTime(c.requestedChanges?.checkOut, tz)}`
                      ) : (
                        <span>
                          {label(x.eventType)}
                          {x.failure ? (
                            <span className="ml-1 text-xs text-muted">
                              ({label(x.failure)}
                              {x.distanceMeters ? `, ${Math.round(x.distanceMeters)} m` : ''})
                            </span>
                          ) : null}
                          {x.mockLocationDetected ? (
                            <span className="ml-1">
                              <Badge tone="danger">Mock location reported</Badge>
                            </span>
                          ) : null}
                        </span>
                      )}
                    </Td>
                    <Td className="max-w-xs">
                      {kind === 'corrections' ? c.reason : x.employeeReason}
                      {r.reviewComment ? (
                        <span className="block text-xs text-muted">
                          Reviewer: {r.reviewComment}
                        </span>
                      ) : null}
                    </Td>
                    <Td>
                      <Badge tone={statusTone(r.status)}>{label(r.status)}</Badge>
                    </Td>
                    <Td>
                      {r.status === 'PENDING' ? (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => setDeciding({ row: r, action: 'approve' })}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setDeciding({ row: r, action: 'reject' })}
                          >
                            Reject
                          </Button>
                        </div>
                      ) : null}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          {q.data?.data.length === 0 ? <Empty>Nothing here.</Empty> : null}
          <Pager page={page} limit={LIMIT} total={q.data?.meta?.total ?? 0} onPage={setPage} />
        </>
      )}
      {deciding ? (
        <Decide kind={kind} {...deciding} onClose={() => setDeciding(undefined)} />
      ) : null}
    </>
  );
}

function Decide({
  kind,
  row,
  action,
  onClose,
}: {
  kind: Kind;
  row: Row;
  action: 'approve' | 'reject';
  onClose: () => void;
}) {
  const [comment, setComment] = useState('');
  const save = useSave(
    () =>
      api.post(
        `/attendance/${kind}/${row.id}/${action}`,
        comment.trim() ? { comment: comment.trim() } : {},
      ),
    ['approvals', 'dashboard', 'days'],
    onClose,
  );
  const need = action === 'reject' && comment.trim().length < 3;
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${action === 'approve' ? 'Approve' : 'Reject'} request`}
      description={
        action === 'approve'
          ? kind === 'exceptions'
            ? 'The punch is recorded with the original time of the attempt.'
            : 'The approved times replace the day’s first check-in / last check-out.'
          : 'The employee sees your comment.'
      }
    >
      <div className="space-y-3">
        {save.error ? <Alert tone="danger">{save.error}</Alert> : null}
        <Field
          label={action === 'reject' ? 'Comment (required)' : 'Comment (optional)'}
          error={need && comment ? 'Add at least 3 characters' : undefined}
        >
          {(id, invalid) => (
            <Textarea
              id={id}
              value={comment}
              maxLength={1000}
              invalid={invalid}
              onChange={(e) => setComment(e.target.value)}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={action === 'reject' ? 'danger' : 'primary'}
            loading={save.isPending}
            disabled={need}
            onClick={() => save.mutate(undefined)}
          >
            {action === 'approve' ? 'Approve' : 'Reject'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
