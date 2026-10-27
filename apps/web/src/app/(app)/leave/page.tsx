'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAuth } from '@/components/auth';
import { Pager } from '@/components/pager';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import {
  Alert,
  Badge,
  Card,
  CardTitle,
  Empty,
  PageHeader,
  Skeleton,
  TabBar,
  Table,
  Td,
  Th,
  statusTone,
} from '@/components/ui/display';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { useList, useOne, useSave } from '@/hooks/api';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import type { LeaveBalance, LeaveRequest, LeaveType } from '@/lib/types';
import { compact, formatDate, label } from '@/lib/utils';

const LIMIT = 20;
type Tab = 'mine' | 'review' | 'types';
const INVALIDATE = ['leave-requests', 'leave-balances', 'days', 'dashboard'];

export default function LeavePage() {
  const { can, active } = useAuth();
  const canReview = can('leave:review:all', 'leave:review:team');
  const canManage = can('leave:manage');
  const hasEmployee = !!active?.employeeId;
  const tabs: [Tab, string, boolean][] = [
    ['mine', 'My leave', hasEmployee],
    ['review', 'To review', canReview],
    ['types', 'Leave types', canManage],
  ];
  const visible = tabs.filter(([, , ok]) => ok);
  const [tab, setTab] = useState<Tab>(visible[0]?.[0] ?? 'review');
  return (
    <>
      <PageHeader
        title="Leave"
        description="Requests, approvals and balances. Approved leave is reflected in attendance."
      />
      <TabBar
        label="Leave sections"
        value={tab}
        onChange={setTab}
        tabs={visible.map(([key, name]) => ({ key, label: name }))}
      />
      {tab === 'mine' ? <Mine /> : null}
      {tab === 'review' ? <Review /> : null}
      {tab === 'types' ? <Types /> : null}
    </>
  );
}

const applySchema = z.object({
  leaveTypeId: z.string().min(1, 'Choose a type'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
  halfDay: z.boolean(),
  halfDaySession: z.enum(['', 'FIRST', 'SECOND']),
  reason: z.string().max(1000),
});
type AForm = z.infer<typeof applySchema>;

function Mine() {
  const [page, setPage] = useState(1);
  const [applying, setApplying] = useState(false);
  const bal = useOne<LeaveBalance[]>('leave-balances', '/leave/balances');
  const q = useList<LeaveRequest>('leave-requests', '/leave/requests', {
    scope: 'mine',
    page,
    limit: LIMIT,
  });
  const cancel = useSave((id: string) => api.post(`/leave/requests/${id}/cancel`, {}), INVALIDATE);
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {!bal.data ? (
            <Skeleton className="h-20" />
          ) : (
            bal.data.data.map((b) => (
              <Card key={b.leaveTypeId}>
                <CardTitle>{b.name}</CardTitle>
                <p className="text-2xl font-bold">
                  {b.remainingDays === null ? 'Unlimited' : `${b.remainingDays} left`}
                </p>
                <p className="text-xs text-muted">
                  {b.approvedDays} used · {b.pendingDays} pending
                  {b.allowanceDays !== null ? ` · ${b.allowanceDays} per year` : ''}
                </p>
              </Card>
            ))
          )}
        </div>
        <Button onClick={() => setApplying(true)}>Request leave</Button>
      </div>
      {cancel.error ? <Alert tone="danger">{cancel.error}</Alert> : null}
      {q.isError ? <Alert tone="danger">{userMessage(q.error)}</Alert> : null}
      {q.data ? (
        <>
          <Table aria-label="My leave requests">
            <thead>
              <tr>
                <Th>Type</Th>
                <Th>Dates</Th>
                <Th>Days</Th>
                <Th>Status</Th>
                <Th>Comment</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {q.data.data.map((r) => (
                <tr key={r.id}>
                  <Td>{r.leaveType?.name}</Td>
                  <Td>
                    {r.startDate === r.endDate
                      ? formatDate(r.startDate)
                      : `${formatDate(r.startDate)} – ${formatDate(r.endDate)}`}
                  </Td>
                  <Td>{r.days}</Td>
                  <Td>
                    <Badge tone={statusTone(r.status)}>{label(r.status)}</Badge>
                  </Td>
                  <Td>{r.reviewComment ?? ''}</Td>
                  <Td>
                    {r.status === 'PENDING' || r.status === 'APPROVED' ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={cancel.isPending}
                        onClick={() => cancel.mutate(r.id)}
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {q.data.data.length === 0 ? <Empty>No leave requests yet.</Empty> : null}
          <Pager page={page} limit={LIMIT} total={q.data.meta?.total ?? 0} onPage={setPage} />
        </>
      ) : null}
      {applying ? <ApplyForm onClose={() => setApplying(false)} /> : null}
    </div>
  );
}

function ApplyForm({ onClose }: { onClose: () => void }) {
  const types = useList<LeaveType>('leave-types', '/leave-types', {});
  const f = useForm<AForm>({
    resolver: zodResolver(applySchema),
    defaultValues: {
      leaveTypeId: '',
      startDate: '',
      endDate: '',
      halfDay: false,
      halfDaySession: '',
      reason: '',
    },
  });
  const halfDay = f.watch('halfDay');
  const typeId = f.watch('leaveTypeId');
  const type = types.data?.data.find((t) => t.id === typeId);
  const save = useSave(
    (v: AForm) =>
      api.post('/leave/requests', {
        leaveTypeId: v.leaveTypeId,
        startDate: v.startDate,
        endDate: v.halfDay ? v.startDate : v.endDate,
        halfDay: v.halfDay,
        ...compact({ halfDaySession: v.halfDay ? v.halfDaySession : '', reason: v.reason.trim() }),
      }),
    INVALIDATE,
    onClose,
  );
  const e = f.formState.errors;
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Request leave">
      <form onSubmit={f.handleSubmit((v) => save.mutate(v))} className="space-y-3" noValidate>
        {save.error ? <Alert tone="danger">{save.error}</Alert> : null}
        <Field label="Leave type" error={e.leaveTypeId?.message}>
          {(id, inv) => (
            <Select id={id} invalid={inv} {...f.register('leaveTypeId')}>
              <option value="">Choose…</option>
              {(types.data?.data ?? [])
                .filter((t) => t.status === 'ACTIVE')
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" error={e.startDate?.message}>
            {(id, inv) => <Input id={id} type="date" invalid={inv} {...f.register('startDate')} />}
          </Field>
          {!halfDay ? (
            <Field label="To" error={e.endDate?.message}>
              {(id, inv) => <Input id={id} type="date" invalid={inv} {...f.register('endDate')} />}
            </Field>
          ) : null}
        </div>
        {type?.allowHalfDay ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...f.register('halfDay')} /> Half day
          </label>
        ) : null}
        {halfDay ? (
          <Field label="Which half">
            {(id) => (
              <Select id={id} {...f.register('halfDaySession')}>
                <option value="">Not specified</option>
                <option value="FIRST">First half</option>
                <option value="SECOND">Second half</option>
              </Select>
            )}
          </Field>
        ) : null}
        <Field label="Reason (optional)">
          {(id) => <Textarea id={id} maxLength={1000} {...f.register('reason')} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Submit
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Review() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('PENDING');
  const [deciding, setDeciding] = useState<{ r: LeaveRequest; action: 'approve' | 'reject' }>();
  const q = useList<LeaveRequest>('leave-requests', '/leave/requests', {
    scope: 'review',
    page,
    limit: LIMIT,
    ...compact({ status }),
  });
  const { can } = useAuth();
  const mayDecide = can('leave:review:all', 'leave:review:team');
  return (
    <div className="space-y-3">
      <div className="max-w-xs">
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
              <option value="">All</option>
              {['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {q.isError ? <Alert tone="danger">{userMessage(q.error)}</Alert> : null}
      {q.data ? (
        <>
          <Table aria-label="Leave requests to review">
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Type</Th>
                <Th>Dates</Th>
                <Th>Days</Th>
                <Th>Reason</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {q.data.data.map((r) => (
                <tr key={r.id}>
                  <Td className="font-medium">
                    {r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : '—'}
                  </Td>
                  <Td>{r.leaveType?.name}</Td>
                  <Td>
                    {r.startDate === r.endDate
                      ? formatDate(r.startDate)
                      : `${formatDate(r.startDate)} – ${formatDate(r.endDate)}`}
                  </Td>
                  <Td>{r.days}</Td>
                  <Td>{r.reason ?? ''}</Td>
                  <Td>
                    <Badge tone={statusTone(r.status)}>{label(r.status)}</Badge>
                  </Td>
                  <Td>
                    {r.status === 'PENDING' && mayDecide ? (
                      <span className="flex gap-2">
                        <Button size="sm" onClick={() => setDeciding({ r, action: 'approve' })}>
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setDeciding({ r, action: 'reject' })}
                        >
                          Reject
                        </Button>
                      </span>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {q.data.data.length === 0 ? <Empty>Nothing to review.</Empty> : null}
          <Pager page={page} limit={LIMIT} total={q.data.meta?.total ?? 0} onPage={setPage} />
        </>
      ) : null}
      {deciding ? <Decide {...deciding} onClose={() => setDeciding(undefined)} /> : null}
    </div>
  );
}

function Decide({
  r,
  action,
  onClose,
}: {
  r: LeaveRequest;
  action: 'approve' | 'reject';
  onClose: () => void;
}) {
  const [comment, setComment] = useState('');
  const save = useSave(
    () =>
      api.post(
        `/leave/requests/${r.id}/${action}`,
        comment.trim() ? { comment: comment.trim() } : {},
      ),
    INVALIDATE,
    onClose,
  );
  const needs = action === 'reject' && comment.trim().length < 3;
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={action === 'approve' ? 'Approve leave' : 'Reject leave'}
      description={`${r.employee?.firstName ?? ''} ${r.employee?.lastName ?? ''} · ${r.days} day(s)`}
    >
      <div className="space-y-3">
        {save.error ? <Alert tone="danger">{save.error}</Alert> : null}
        <Field label={action === 'reject' ? 'Reason (required)' : 'Comment (optional)'}>
          {(id) => (
            <Textarea
              id={id}
              maxLength={1000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={needs} loading={save.isPending} onClick={() => save.mutate(undefined)}>
            {action === 'approve' ? 'Approve' : 'Reject'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const typeSchema = z.object({
  name: z.string().trim().min(1, 'Required').max(80),
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,20}$/, 'Letters, digits, - and _ only'),
  paid: z.boolean(),
  allowHalfDay: z.boolean(),
  annualAllowanceDays: z.coerce.number().min(0).max(366).multipleOf(0.5, 'Use whole or half days'),
});
type TForm = z.input<typeof typeSchema>;

function Types() {
  const [editing, setEditing] = useState<LeaveType | 'new'>();
  const q = useList<LeaveType>('leave-types', '/leave-types', {});
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}>Add leave type</Button>
      </div>
      {q.isError ? <Alert tone="danger">{userMessage(q.error)}</Alert> : null}
      {q.data ? (
        <Table aria-label="Leave types">
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Code</Th>
              <Th>Per year</Th>
              <Th>Paid</Th>
              <Th>Half day</Th>
              <Th>Status</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {q.data.data.map((t) => (
              <tr key={t.id}>
                <Td className="font-medium">{t.name}</Td>
                <Td>{t.code}</Td>
                <Td>
                  {t.annualAllowanceDays === 0 ? 'Unlimited' : `${t.annualAllowanceDays} days`}
                </Td>
                <Td>{t.paid ? 'Yes' : 'No'}</Td>
                <Td>{t.allowHalfDay ? 'Yes' : 'No'}</Td>
                <Td>
                  <Badge tone={statusTone(t.status)}>{label(t.status)}</Badge>
                </Td>
                <Td>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(t)}>
                    Edit
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
      {q.data?.data.length === 0 ? (
        <Empty>No leave types yet. Add one so employees can request leave.</Empty>
      ) : null}
      {editing ? (
        <TypeForm
          type={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </div>
  );
}

function TypeForm({ type, onClose }: { type?: LeaveType; onClose: () => void }) {
  const f = useForm<TForm, unknown, z.output<typeof typeSchema>>({
    resolver: zodResolver(typeSchema),
    defaultValues: {
      name: type?.name ?? '',
      code: type?.code ?? '',
      paid: type?.paid ?? true,
      allowHalfDay: type?.allowHalfDay ?? true,
      annualAllowanceDays: type?.annualAllowanceDays ?? 0,
    },
  });
  const save = useSave(
    (v: z.output<typeof typeSchema>) =>
      type ? api.patch(`/leave-types/${type.id}`, v) : api.post('/leave-types', v),
    ['leave-types', 'leave-balances'],
    onClose,
  );
  const toggle = useSave(
    () =>
      api.patch(`/leave-types/${type!.id}`, {
        status: type!.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
      }),
    ['leave-types', 'leave-balances'],
    onClose,
  );
  const e = f.formState.errors;
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={type ? 'Edit leave type' : 'Add leave type'}
    >
      <form onSubmit={f.handleSubmit((v) => save.mutate(v))} className="space-y-3" noValidate>
        {save.error || toggle.error ? (
          <Alert tone="danger">{save.error ?? toggle.error}</Alert>
        ) : null}
        <Field label="Name" error={e.name?.message}>
          {(id, inv) => <Input id={id} invalid={inv} {...f.register('name')} />}
        </Field>
        <Field label="Code" error={e.code?.message}>
          {(id, inv) => <Input id={id} invalid={inv} {...f.register('code')} />}
        </Field>
        <Field
          label="Days per calendar year"
          hint="0 means no limit."
          error={e.annualAllowanceDays?.message}
        >
          {(id, inv) => (
            <Input
              id={id}
              type="number"
              step="0.5"
              min="0"
              invalid={inv}
              {...f.register('annualAllowanceDays')}
            />
          )}
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...f.register('paid')} /> Paid leave
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...f.register('allowHalfDay')} /> Allow half days
        </label>
        <div className="flex justify-between gap-2">
          {type ? (
            <Button
              type="button"
              variant="secondary"
              loading={toggle.isPending}
              onClick={() => toggle.mutate(undefined)}
            >
              {type.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              Save
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
