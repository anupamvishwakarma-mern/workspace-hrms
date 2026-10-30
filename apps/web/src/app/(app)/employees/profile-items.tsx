'use client';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Alert, Badge, Empty, Skeleton } from '@/components/ui/display';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { useList, useSave } from '@/hooks/api';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import type { ProfileItem, ProfileKind } from '@/lib/types';
import { formatDate } from '@/lib/utils';

const KINDS: { kind: ProfileKind; title: string; add: string; org: string; name: string }[] = [
  { kind: 'QUALIFICATION', title: 'Qualifications', add: 'Add qualification', org: 'Institution', name: 'Degree or course' },
  { kind: 'EXPERIENCE', title: 'Previous employment', add: 'Add employer', org: 'Employer', name: 'Job title' },
  { kind: 'CERTIFICATION', title: 'Certifications', add: 'Add certification', org: 'Issued by', name: 'Certificate' },
  { kind: 'SKILL', title: 'Skills', add: 'Add skill', org: '', name: 'Skill' },
];
const LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'];
const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/** Qualifications, previous jobs, skills and certifications. HR can verify; employees see "not verified" until HR does. */
export function ProfileItems({
  employeeId,
  canVerify,
}: {
  employeeId: string;
  canVerify: boolean;
}) {
  const q = useList<ProfileItem>('profile-items', `/employees/${employeeId}/profile-items`, {});
  const [adding, setAdding] = useState<ProfileKind>();
  const [err, setErr] = useState<string>();
  const verify = useSave(
    (i: ProfileItem) => api.patch(`/employees/${employeeId}/profile-items/${i.id}`, { verified: !i.verified }),
    ['profile-items'],
  );
  const remove = useSave(
    (i: ProfileItem) => api.del(`/employees/${employeeId}/profile-items/${i.id}`),
    ['profile-items'],
  );
  if (q.isError) return <Alert tone="danger">{userMessage(q.error)}</Alert>;
  if (!q.data) return <Skeleton className="h-40" />;
  const items = q.data.data;
  const err2 = err ?? verify.error ?? remove.error;

  return (
    <div className="space-y-6">
      {err2 ? <Alert tone="danger">{err2}</Alert> : null}
      {KINDS.map((k) => {
        const rows = items.filter((i) => i.kind === k.kind);
        return (
          <section key={k.kind} aria-label={k.title} className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{k.title}</h3>
              <Button size="sm" variant="secondary" onClick={() => { setErr(undefined); setAdding(k.kind); }}>
                <Plus className="h-4 w-4" aria-hidden /> {k.add}
              </Button>
            </div>
            {rows.length === 0 ? (
              <Empty>None recorded.</Empty>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border text-sm">
                {rows.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-start justify-between gap-2 p-3">
                    <div>
                      <p className="font-medium">
                        {i.title}
                        {i.level ? <span className="ml-2 text-xs text-muted">{cap(i.level)}</span> : null}
                      </p>
                      {i.organization ? <p className="text-muted">{i.organization}</p> : null}
                      {i.fromDate || i.toDate ? (
                        <p className="text-xs text-muted">
                          {i.fromDate ? formatDate(i.fromDate) : ''}
                          {i.toDate ? ` to ${formatDate(i.toDate)}` : i.kind === 'EXPERIENCE' ? ' to present' : ''}
                        </p>
                      ) : null}
                      {i.credentialId ? <p className="text-xs text-muted">ID {i.credentialId}</p> : null}
                      {i.notes ? <p className="mt-1 text-xs">{i.notes}</p> : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={i.verified ? 'success' : 'neutral'}>{i.verified ? 'Verified' : 'Not verified'}</Badge>
                      {canVerify ? (
                        <Button size="sm" variant="ghost" onClick={() => verify.mutate(i)}>
                          {i.verified ? 'Unverify' : 'Verify'}
                        </Button>
                      ) : null}
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove ${i.title}`}
                        onClick={() => window.confirm(`Remove "${i.title}"?`) && remove.mutate(i)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {adding ? <ItemForm employeeId={employeeId} kind={adding} onClose={() => setAdding(undefined)} /> : null}
    </div>
  );
}

function ItemForm({ employeeId, kind, onClose }: { employeeId: string; kind: ProfileKind; onClose: () => void }) {
  const k = KINDS.find((x) => x.kind === kind)!;
  const [title, setTitle] = useState('');
  const [org, setOrg] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [level, setLevel] = useState('INTERMEDIATE');
  const [cred, setCred] = useState('');
  const [notes, setNotes] = useState('');
  const [localError, setLocalError] = useState<string>();
  const dates = kind !== 'SKILL';
  const save = useSave(
    () =>
      api.post(`/employees/${employeeId}/profile-items`, {
        kind,
        title: title.trim(),
        ...(org.trim() ? { organization: org.trim() } : {}),
        ...(dates && from ? { fromDate: from } : {}),
        ...(dates && to ? { toDate: to } : {}),
        ...(kind === 'SKILL' ? { level } : {}),
        ...(kind === 'CERTIFICATION' && cred.trim() ? { credentialId: cred.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      }),
    ['profile-items'],
    onClose,
  );
  const submit = () => {
    setLocalError(undefined);
    if (!title.trim()) return setLocalError(`Enter the ${k.name.toLowerCase()}.`);
    if (kind !== 'SKILL' && !org.trim()) return setLocalError(`Enter the ${k.org.toLowerCase()}.`);
    if (kind === 'EXPERIENCE' && !from) return setLocalError('Enter the start date.');
    if (from && to && to < from) return setLocalError('The end date is before the start date.');
    save.mutate(undefined);
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={k.add}>
      <div className="space-y-3">
        {localError || save.error ? <Alert tone="danger">{localError ?? save.error}</Alert> : null}
        <Field label={k.name}>{(id) => <Input id={id} value={title} maxLength={150} onChange={(e) => setTitle(e.target.value)} />}</Field>
        {kind !== 'SKILL' ? (
          <Field label={k.org}>{(id) => <Input id={id} value={org} maxLength={150} onChange={(e) => setOrg(e.target.value)} />}</Field>
        ) : (
          <Field label="Level">
            {(id) => (
              <Select id={id} value={level} onChange={(e) => setLevel(e.target.value)}>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>{cap(l)}</option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {dates ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label={kind === 'CERTIFICATION' ? 'Issued on' : 'From'}>
              {(id) => <Input id={id} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}
            </Field>
            <Field label={kind === 'CERTIFICATION' ? 'Expires on' : 'To'} hint={kind === 'EXPERIENCE' ? 'Leave empty if current' : undefined}>
              {(id) => <Input id={id} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}
            </Field>
          </div>
        ) : null}
        {kind === 'CERTIFICATION' ? (
          <Field label="Credential ID (optional)">{(id) => <Input id={id} value={cred} maxLength={80} onChange={(e) => setCred(e.target.value)} />}</Field>
        ) : null}
        <Field label="Notes (optional)">{(id) => <Textarea id={id} rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} onClick={submit}>Add</Button>
        </div>
      </div>
    </Modal>
  );
}
