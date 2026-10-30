'use client';
import { useState } from 'react';
import { useAuth } from '@/components/auth';
import { Button } from '@/components/ui/button';
import { Alert, Skeleton } from '@/components/ui/display';
import { Field, Input } from '@/components/ui/form';
import { useOne, useSave } from '@/hooks/api';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import type { Employee } from '@/lib/types';

interface SensitiveView {
  configured: boolean;
  bank: Record<string, string>;
  statutory: Record<string, string>;
}

const BANK = [
  ['accountHolder', 'Account holder'],
  ['bankName', 'Bank'],
  ['branch', 'Branch'],
  ['ifsc', 'IFSC code'],
  ['accountNumber', 'Account number'],
] as const;
const IDS = [
  ['pan', 'PAN'],
  ['aadhaar', 'Aadhaar'],
  ['uan', 'UAN'],
  ['pfNumber', 'PF number'],
  ['esiNumber', 'ESI number'],
] as const;
const ALL = [...BANK, ...IDS];

/** Bank and statutory identifiers: masked by default, revealing is audited, editing is by someone else only. */
export function BankIds({ emp }: { emp: Employee }) {
  const { can, active } = useAuth();
  const canRead = can('employee:sensitive:read');
  const canEdit = can('employee:sensitive:update') && active?.employeeId !== emp.id;
  const [reveal, setReveal] = useState(false);
  const [editing, setEditing] = useState(false);
  const path = `/employees/${emp.id}/sensitive${reveal ? '?reveal=true' : ''}`;
  const q = useOne<SensitiveView>('employee-sensitive', path);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [localError, setLocalError] = useState<string>();

  const save = useSave(
    (body: Record<string, string | null>) => api.put(`/employees/${emp.id}/sensitive`, body),
    ['employee-sensitive'],
    () => {
      setEditing(false);
      setDraft({});
      setReveal(false);
    },
  );
  const data = q.data?.data;
  const value = (k: string) => data?.bank[k] ?? data?.statutory[k];

  const submit = () => {
    setLocalError(undefined);
    const body: Record<string, string | null> = {};
    for (const [k] of ALL) {
      const v = (draft[k] ?? '').trim();
      if (v === '') continue;
      body[k] = v === '-' ? null : v;
    }
    if (Object.keys(body).length === 0) return setLocalError('Fill in at least one field to change.');
    save.mutate(body);
  };

  if (q.isError) return <Alert tone="danger">{userMessage(q.error)}</Alert>;
  if (!data) return <Skeleton className="h-40" />;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Shown masked. Revealing full values is recorded in the audit log. Changes are recorded by
        field name only, never by value, and you cannot change your own details.
      </p>
      {!editing ? (
        <>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {ALL.map(([k, l]) => (
              <div key={k}>
                <dt className="text-xs text-muted">{l}</dt>
                <dd className="font-mono">{value(k) ?? '—'}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap justify-end gap-2">
            {canRead ? (
              <Button
                variant="secondary"
                onClick={() => {
                  if (reveal) setReveal(false);
                  else if (window.confirm('Show full bank and ID numbers? This is recorded in the audit log.'))
                    setReveal(true);
                }}
              >
                {reveal ? 'Hide full values' : 'Reveal full values'}
              </Button>
            ) : null}
            {canEdit ? <Button onClick={() => setEditing(true)}>Edit</Button> : null}
          </div>
        </>
      ) : (
        <div className="space-y-3">
          {localError || save.error ? <Alert tone="danger">{localError ?? save.error}</Alert> : null}
          <p className="text-xs text-muted">
            Fill in only what you want to change. Leave a field empty to keep it as is; type a single
            dash (-) to clear it.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {ALL.map(([k, l]) => (
              <Field key={k} label={l} hint={value(k) ? `Currently ${value(k)}` : undefined}>
                {(id) => (
                  <Input
                    id={id}
                    autoComplete="off"
                    value={draft[k] ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                  />
                )}
              </Field>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setEditing(false); setDraft({}); }}>
              Cancel
            </Button>
            <Button loading={save.isPending} onClick={submit}>
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
