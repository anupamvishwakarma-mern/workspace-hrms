'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAuth } from '@/components/auth';
import { PageTop } from '@/components/page-top';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Alert, Badge, Empty, Skeleton, TabBar, statusTone } from '@/components/ui/display';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { useList, useSave } from '@/hooks/api';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import type { ApprovalRequest, ApprovalWorkflow } from '@/lib/types';
import { label } from '@/lib/utils';

type Scope = 'inbox' | 'mine' | 'all';
const KEYS = ['approvals', 'approvals-inbox'];

export default function RequestsPage() {
  const { can } = useAuth();
  const [scope, setScope] = useState<Scope>('inbox');
  const [raising, setRaising] = useState(false);
  const [acting, setActing] = useState<{ r: ApprovalRequest; decision: 'APPROVE' | 'REJECT' }>();
  const q = useList<ApprovalRequest>('approvals', '/approvals', { scope, limit: 50 });
  const items = q.data?.data ?? [];
  const tabs: { key: Scope; label: string }[] = [
    { key: 'inbox', label: 'Waiting on me' },
    { key: 'mine', label: 'My requests' },
    ...(can('approval:manage') ? [{ key: 'all' as Scope, label: 'All requests' }] : []),
  ];
  const cancel = useSave((id: string) => api.post(`/approvals/${id}/cancel`, {}), KEYS);

  return (
    <>
      <PageTop
        scope="requests and approvals"
        stats={[{ label: scope === 'inbox' ? 'Waiting on you' : 'Shown', value: q.data ? items.length : '…' }]}
        guide={[
          'Raise a request and it follows the approval chain your company set up.',
          'You can never approve your own request. A manager decides first unless the workflow says otherwise.',
          'Approvers can pass their approvals to a colleague while away; that is not in the web app yet.',
        ]}
        title="Requests"
        actions={<Button onClick={() => setRaising(true)}>New request</Button>}
      />
      <TabBar tabs={tabs} value={scope} onChange={setScope} label="Request lists" />
      {q.isError ? <Alert tone="danger">{userMessage(q.error)}</Alert> : null}
      {cancel.error ? <Alert tone="danger">{cancel.error}</Alert> : null}
      {!q.data ? (
        q.isError ? null : <Skeleton className="h-40" />
      ) : items.length === 0 ? (
        <Empty>{scope === 'inbox' ? 'Nothing is waiting on you.' : 'No requests.'}</Empty>
      ) : (
        <ul className="space-y-3">
          {items.map((r) => (
            <li key={r.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{r.title}</p>
                  <p className="text-sm text-muted">
                    {label(r.requestType)} · {r.requesterName ?? 'Unknown'} ·{' '}
                    {new Date(r.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <Badge tone={statusTone(r.status)}>{label(r.status)}</Badge>
              </div>
              {r.details ? (
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                  {Object.entries(r.details).map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-xs text-muted">{label(k)}</dt>
                      <dd>{String(v ?? '—')}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              <ol className="mt-3 space-y-1 text-sm" aria-label="Approval steps">
                {r.steps.map((s) => (
                  <li key={s.order} className="flex flex-wrap items-center gap-2">
                    <Badge tone={statusTone(s.status)}>{label(s.status)}</Badge>
                    <span>
                      {s.status === 'SKIPPED'
                        ? 'No eligible approver (skipped)'
                        : s.actedByName
                          ? `${s.actedByName}${s.onBehalfOfName ? ` (for ${s.onBehalfOfName})` : ''}`
                          : s.approverNames.join(' or ')}
                    </span>
                    {s.comment ? <span className="text-muted">“{s.comment}”</span> : null}
                  </li>
                ))}
              </ol>
              {scope === 'inbox' && r.status === 'PENDING' ? (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => setActing({ r, decision: 'APPROVE' })}>
                    Approve
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setActing({ r, decision: 'REJECT' })}>
                    Reject
                  </Button>
                </div>
              ) : null}
              {scope === 'mine' && r.status === 'PENDING' ? (
                <div className="mt-3">
                  <Button size="sm" variant="secondary" loading={cancel.isPending} onClick={() => cancel.mutate(r.id)}>
                    Withdraw
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {raising ? <RaiseForm onClose={() => setRaising(false)} /> : null}
      {acting ? <DecideForm {...acting} onClose={() => setActing(undefined)} /> : null}
    </>
  );
}

const raiseSchema = z.object({
  requestType: z.string().min(1, 'Choose a type'),
  title: z.string().trim().min(1, 'Required').max(200),
  note: z.string().trim().max(500),
});

function RaiseForm({ onClose }: { onClose: () => void }) {
  const { can } = useAuth();
  // Only managers of workflows can list them; everyone else types the type key HR told them.
  const wf = useList<ApprovalWorkflow>('approval-workflows', '/approval-workflows', {}, can('approval:manage'));
  const types = (wf.data?.data ?? []).filter((w) => w.status === 'ACTIVE');
  const f = useForm<z.infer<typeof raiseSchema>>({
    resolver: zodResolver(raiseSchema),
    defaultValues: { requestType: '', title: '', note: '' },
  });
  const save = useSave(
    (v: z.infer<typeof raiseSchema>) =>
      api.post('/approvals', {
        requestType: v.requestType,
        title: v.title,
        ...(v.note ? { details: { note: v.note } } : {}),
      }),
    KEYS,
    onClose,
  );
  const e = f.formState.errors;
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="New request">
      <form onSubmit={f.handleSubmit((v) => save.mutate(v))} className="space-y-3" noValidate>
        {save.error ? <Alert tone="danger">{save.error}</Alert> : null}
        <Field label="Request type" error={e.requestType?.message}>
          {(id, inv) =>
            types.length ? (
              <Select id={id} invalid={inv} {...f.register('requestType')}>
                <option value="">Select…</option>
                {types.map((w) => (
                  <option key={w.id} value={w.requestType}>
                    {w.name}
                  </option>
                ))}
              </Select>
            ) : (
              <Input id={id} invalid={inv} placeholder="e.g. EXPENSE" {...f.register('requestType')} />
            )
          }
        </Field>
        <Field label="Title" error={e.title?.message}>
          {(id, inv) => <Input id={id} invalid={inv} {...f.register('title')} />}
        </Field>
        <Field label="Note (optional)" error={e.note?.message}>
          {(id) => <Textarea id={id} rows={3} {...f.register('note')} />}
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

function DecideForm({
  r,
  decision,
  onClose,
}: {
  r: ApprovalRequest;
  decision: 'APPROVE' | 'REJECT';
  onClose: () => void;
}) {
  const f = useForm<{ comment: string }>({ defaultValues: { comment: '' } });
  const save = useSave(
    (v: { comment: string }) =>
      api.post(`/approvals/${r.id}/decision`, { decision, ...(v.comment.trim() ? { comment: v.comment.trim() } : {}) }),
    KEYS,
    onClose,
  );
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`${decision === 'APPROVE' ? 'Approve' : 'Reject'}: ${r.title}`}>
      <form onSubmit={f.handleSubmit((v) => save.mutate(v))} className="space-y-3">
        {save.error ? <Alert tone="danger">{save.error}</Alert> : null}
        <Field label="Comment (optional)">{(id) => <Textarea id={id} rows={3} {...f.register('comment')} />}</Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            {decision === 'APPROVE' ? 'Approve' : 'Reject'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
