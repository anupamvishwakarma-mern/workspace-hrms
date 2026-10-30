'use client';
import { Plus } from 'lucide-react';
import { PageTop } from '@/components/page-top';
import { useState } from 'react';
import { Pager } from '@/components/pager';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Alert, Badge, Empty, Skeleton, TabBar, Table, Td, Th } from '@/components/ui/display';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { useList, useOne, useSave } from '@/hooks/api';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import { useI18n } from '@/lib/i18n';
import {
  LETTER_CATEGORIES,
  LETTER_PLACEHOLDERS,
  type Employee,
  type IssuedLetter,
  type LetterTemplate,
} from '@/lib/types';
import { formatDate, label } from '@/lib/utils';

type Tab = 'issued' | 'templates';

export default function LettersPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('issued');
  const [issuing, setIssuing] = useState(false);
  const issuedQ = useList<IssuedLetter>('letters', '/letters', { page: 1, limit: 25 });
  const tplQ = useList<LetterTemplate>('letter-templates', '/letter-templates', { limit: 100 });
  return (
    <>
      <PageTop
        scope="issue and track letters"
        stats={[
          { label: 'Letters issued', value: issuedQ.data?.meta?.total ?? '…' },
          { label: 'Templates', value: tplQ.data?.data.length ?? '…' },
        ]}
        guide={[
          'Pick a template, choose the employee and issue. Placeholders such as the name and designation are filled in for you.',
          'Each letter gets a reference number. Revoke a letter with a reason if it was issued by mistake.',
          'Edit templates under the Templates tab.',
        ]}
        title={t('let.title')}
        description={t('let.desc')}
        actions={
          <Button onClick={() => setIssuing(true)}>
            <Plus className="h-4 w-4" aria-hidden /> {t('let.issue')}
          </Button>
        }
      />
      <TabBar
        label="Letter sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'issued', label: t('let.issued') },
          { key: 'templates', label: t('let.templates') },
        ]}
      />
      {tab === 'issued' ? <Issued /> : <Templates />}
      {issuing ? <IssueForm onClose={() => setIssuing(false)} /> : null}
    </>
  );
}

function Issued() {
  const [page, setPage] = useState(1);
  const [view, setView] = useState<string>();
  const q = useList<IssuedLetter>('letters', '/letters', { page, limit: 25 });
  return (
    <>
      {q.isError ? <Alert tone="danger">{userMessage(q.error)}</Alert> : null}
      {!q.data ? (
        q.isError ? null : (
          <Skeleton className="h-40" />
        )
      ) : (
        <>
          <Table aria-label="Issued letters">
            <thead>
              <tr>
                <Th>Reference</Th>
                <Th>Employee</Th>
                <Th>Letter</Th>
                <Th>Issued</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {q.data.data.map((l) => (
                <tr key={l.id}>
                  <Td className="font-mono text-xs">{l.referenceNo}</Td>
                  <Td>
                    {l.employee ? `${l.employee.firstName} ${l.employee.lastName}` : '—'}
                    <span className="block text-xs text-muted">{l.employee?.employeeCode}</span>
                  </Td>
                  <Td className="font-medium">
                    {l.title}
                    <span className="block text-xs text-muted">{label(l.category)}</span>
                  </Td>
                  <Td>{formatDate(l.issuedAt)}</Td>
                  <Td>
                    <Badge tone={l.status === 'ISSUED' ? 'success' : 'danger'}>
                      {l.status === 'ISSUED' ? 'Issued' : 'Revoked'}
                    </Badge>
                  </Td>
                  <Td>
                    <Button size="sm" variant="secondary" onClick={() => setView(l.id)}>
                      View
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {q.data.data.length === 0 ? <Empty>No letters issued yet.</Empty> : null}
          <Pager page={page} limit={25} total={q.data.meta?.total ?? 0} onPage={setPage} />
        </>
      )}
      {view ? <LetterView id={view} onClose={() => setView(undefined)} /> : null}
    </>
  );
}

function LetterView({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useOne<IssuedLetter>('letter', `/letters/${id}`);
  const [reason, setReason] = useState('');
  const [revoking, setRevoking] = useState(false);
  const revoke = useSave(
    () => api.post(`/letters/${id}/revoke`, { reason: reason.trim() }),
    ['letters', 'letter'],
    () => setRevoking(false),
  );
  const l = q.data?.data;
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={l?.title ?? 'Letter'}
      description={l?.referenceNo}
    >
      {!l ? (
        q.isError ? (
          <Alert tone="danger">{userMessage(q.error)}</Alert>
        ) : (
          <Skeleton className="h-32" />
        )
      ) : (
        <div className="space-y-3">
          {l.status === 'REVOKED' ? <Alert tone="danger">Revoked: {l.revokeReason}</Alert> : null}
          {/* Plain text: letter text is never rendered as HTML. */}
          <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-subtle/50 p-3 font-sans text-sm">
            {l.body}
          </pre>
          <div className="flex justify-between gap-2">
            <Button variant="secondary" onClick={() => window.print()}>
              Print
            </Button>
            {l.status === 'ISSUED' ? (
              revoking ? (
                <div className="flex flex-1 items-end gap-2">
                  {revoke.error ? <Alert tone="danger">{revoke.error}</Alert> : null}
                  <Field label="Reason for revoking">
                    {(fid) => (
                      <Input id={fid} value={reason} onChange={(e) => setReason(e.target.value)} />
                    )}
                  </Field>
                  <Button
                    loading={revoke.isPending}
                    disabled={reason.trim().length < 3}
                    onClick={() => revoke.mutate(undefined)}
                  >
                    Revoke
                  </Button>
                </div>
              ) : (
                <Button variant="secondary" onClick={() => setRevoking(true)}>
                  Revoke letter
                </Button>
              )
            ) : null}
          </div>
        </div>
      )}
    </Modal>
  );
}

function IssueForm({ onClose }: { onClose: () => void }) {
  const people = useList<Employee>('employees-lookup', '/employees', {
    limit: 100,
    status: 'ACTIVE',
  });
  const templates = useList<LetterTemplate>('letter-templates', '/letter-templates', {
    limit: 100,
  });
  const [employeeId, setEmployeeId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [localError, setLocalError] = useState<string>();
  const save = useSave(
    () => api.post('/letters', { employeeId, templateId }),
    ['letters'],
    onClose,
  );
  const active = (templates.data?.data ?? []).filter((t) => t.status === 'ACTIVE');
  const chosen = active.find((t) => t.id === templateId);
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Issue a letter"
      description="The placeholders are filled from the employee's record. If a value is missing the letter is not issued."
    >
      <div className="space-y-3">
        {localError || save.error ? <Alert tone="danger">{localError ?? save.error}</Alert> : null}
        <Field label="Employee">
          {(id) => (
            <Select id={id} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Choose…</option>
              {(people.data?.data ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.firstName} {e.lastName} ({e.employeeCode})
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Template"
          hint={active.length === 0 ? 'Create a template in the Templates tab first.' : undefined}
        >
          {(id) => (
            <Select id={id} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">Choose…</option>
              {active.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} · {label(t.category)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {chosen ? (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-subtle/60 p-3 font-sans text-xs text-muted">
            {chosen.body}
          </pre>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            onClick={() =>
              employeeId && templateId
                ? save.mutate(undefined)
                : setLocalError('Choose an employee and a template.')
            }
          >
            Issue letter
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Templates() {
  const [editing, setEditing] = useState<LetterTemplate | 'new'>();
  const q = useList<LetterTemplate>('letter-templates', '/letter-templates', { limit: 100 });
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button variant="secondary" onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" aria-hidden /> New template
        </Button>
      </div>
      {q.isError ? <Alert tone="danger">{userMessage(q.error)}</Alert> : null}
      {!q.data ? (
        q.isError ? null : (
          <Skeleton className="h-40" />
        )
      ) : (
        <>
          <Table aria-label="Letter templates">
            <thead>
              <tr>
                <Th>Title</Th>
                <Th>Category</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {q.data.data.map((t) => (
                <tr key={t.id}>
                  <Td className="font-medium">{t.title}</Td>
                  <Td>{label(t.category)}</Td>
                  <Td>
                    <Badge tone={t.status === 'ACTIVE' ? 'success' : 'neutral'}>
                      {label(t.status)}
                    </Badge>
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
          {q.data.data.length === 0 ? <Empty>No templates yet.</Empty> : null}
        </>
      )}
      {editing ? (
        <TemplateForm
          template={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </>
  );
}

function TemplateForm({ template, onClose }: { template?: LetterTemplate; onClose: () => void }) {
  const [title, setTitle] = useState(template?.title ?? '');
  const [category, setCategory] = useState(template?.category ?? 'OFFER');
  const [body, setBody] = useState(template?.body ?? '');
  const [status, setStatus] = useState(template?.status ?? 'ACTIVE');
  const [localError, setLocalError] = useState<string>();
  const save = useSave(
    () =>
      template
        ? api.patch(`/letter-templates/${template.id}`, {
            title: title.trim(),
            category,
            body: body.trim(),
            status,
          })
        : api.post('/letter-templates', { title: title.trim(), category, body: body.trim() }),
    ['letter-templates'],
    onClose,
  );
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={template ? 'Edit template' : 'New template'}
      description="Plain text. Use placeholders like {{employee.name}}; unknown placeholders are rejected."
    >
      <div className="space-y-3">
        {localError || save.error ? <Alert tone="danger">{localError ?? save.error}</Alert> : null}
        <Field label="Title">
          {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <Field label="Category">
          {(id) => (
            <Select
              id={id}
              value={category}
              onChange={(e) => setCategory(e.target.value as typeof category)}
            >
              {LETTER_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {label(c)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Text">
          {(id) => (
            <Textarea id={id} rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
          )}
        </Field>
        <details className="text-xs text-muted">
          <summary className="cursor-pointer font-medium">Available placeholders</summary>
          <p className="mt-1 font-mono leading-relaxed">
            {LETTER_PLACEHOLDERS.map((p) => `{{${p}}}`).join('  ')}
          </p>
          <p className="mt-1">Salary placeholders need a salary structure for the employee.</p>
        </details>
        {template ? (
          <Field label="Status">
            {(id) => (
              <Select
                id={id}
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
              >
                <option value="ACTIVE">Active</option>
                <option value="ARCHIVED">Archived</option>
              </Select>
            )}
          </Field>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            onClick={() =>
              title.trim().length >= 2 && body.trim().length >= 10
                ? save.mutate(undefined)
                : setLocalError('Add a title and at least 10 characters of text.')
            }
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
