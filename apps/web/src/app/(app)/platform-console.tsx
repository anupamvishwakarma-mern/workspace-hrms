'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '@/components/auth';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Alert, Badge, Empty, Skeleton, Table, Td, Th } from '@/components/ui/display';
import { Field, Input, Select } from '@/components/ui/form';
import { useSave } from '@/hooks/api';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import type { PlatformModule, PlatformTenant } from '@/lib/types';

/** What a platform administrator sees instead of a company: every company, and what each may use. */
export function PlatformConsole() {
  const { email, signOut } = useAuth();
  const tenants = useQuery({
    queryKey: ['platform-tenants'],
    queryFn: () => api.get<PlatformTenant[]>('/platform/tenants', { limit: 100 }),
  });
  const catalog = useQuery({
    queryKey: ['platform-modules'],
    queryFn: () => api.get<PlatformModule[]>('/platform/modules'),
  });
  const [managing, setManaging] = useState<string>();
  const [onboarding, setOnboarding] = useState(false);
  const list = tenants.data?.data ?? [];
  const mods = catalog.data?.data ?? [];
  const current = list.find((t) => t.id === managing);

  return (
    <main className="mx-auto max-w-5xl space-y-5 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Platform console</h1>
          <p className="text-sm text-muted">
            Signed in as {email}. You manage companies and what each may use; you cannot see their
            employee data.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setOnboarding(true)}>Onboard company</Button>
          <Button variant="secondary" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </header>
      {tenants.isError ? <Alert tone="danger">{userMessage(tenants.error)}</Alert> : null}
      {!tenants.data ? (
        tenants.isError ? null : <Skeleton className="h-40" />
      ) : list.length === 0 ? (
        <Empty>No companies yet.</Empty>
      ) : (
        <Table aria-label="Companies">
          <thead>
            <tr>
              <Th>Company</Th>
              <Th>Status</Th>
              <Th>Seats</Th>
              <Th>Modules</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.id}>
                <Td>
                  <span className="font-medium">{t.name}</span>
                  <span className="block text-xs text-muted">{t.slug}</span>
                </Td>
                <Td>
                  <Badge tone={t.status === 'ACTIVE' ? 'success' : 'warn'}>{t.status.toLowerCase()}</Badge>
                </Td>
                <Td>{t.maxEmployees ?? 'Unlimited'}</Td>
                <Td>
                  {t.modules.length} of {mods.length || t.modules.length}
                </Td>
                <Td>
                  <Button size="sm" variant="secondary" onClick={() => setManaging(t.id)}>
                    Manage
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {current ? <Manage tenant={current} catalog={mods} onClose={() => setManaging(undefined)} /> : null}
      {onboarding ? <Onboard catalog={mods} onClose={() => setOnboarding(false)} /> : null}
    </main>
  );
}

/** Switching a module on pulls in what it needs; switching one off drops what depends on it. */
function toggle(set: string[], key: string, on: boolean, catalog: PlatformModule[]): string[] {
  const next = new Set(set);
  if (on) {
    next.add(key);
    for (const r of catalog.find((m) => m.key === key)?.requires ?? []) next.add(r);
  } else {
    next.delete(key);
    for (const m of catalog) if (m.requires.includes(key)) next.delete(m.key);
  }
  return catalog.map((m) => m.key).filter((k) => next.has(k));
}

function ModulePicker({
  value,
  onChange,
  catalog,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  catalog: PlatformModule[];
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">Modules</legend>
      {catalog.map((m) => (
        <label key={m.key} className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={value.includes(m.key)}
            onChange={(e) => onChange(toggle(value, m.key, e.target.checked, catalog))}
          />
          <span>
            <b>{m.label}</b>
            <span className="block text-xs text-muted">{m.description}</span>
          </span>
        </label>
      ))}
      <p className="text-xs text-muted">
        Switched-off modules are refused by the server and hidden in the apps. Their data is kept.
      </p>
    </fieldset>
  );
}

function Manage({
  tenant,
  catalog,
  onClose,
}: {
  tenant: PlatformTenant;
  catalog: PlatformModule[];
  onClose: () => void;
}) {
  const [modules, setModules] = useState(tenant.modules);
  const [reason, setReason] = useState('');
  const [seats, setSeats] = useState(String(tenant.maxEmployees ?? ''));
  const [status, setStatus] = useState(tenant.status);
  const [statusReason, setStatusReason] = useState('');
  const [localError, setLocalError] = useState<string>();
  const inv = ['platform-tenants'];
  const saveModules = useSave(
    () => api.patch(`/platform/tenants/${tenant.id}/modules`, { modules, reason: reason.trim() }),
    inv,
    () => setReason(''),
  );
  const saveSeats = useSave(
    () => api.patch(`/platform/tenants/${tenant.id}/seats`, { maxEmployees: Number(seats) }),
    inv,
  );
  const saveStatus = useSave(
    () => api.patch(`/platform/tenants/${tenant.id}/status`, { status, reason: statusReason.trim() }),
    inv,
    () => setStatusReason(''),
  );
  const same = [...modules].sort().join() === [...tenant.modules].sort().join();
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={tenant.name} description={tenant.slug}>
      <div className="space-y-6">
        {localError ? <Alert tone="danger">{localError}</Alert> : null}
        <section className="space-y-3" aria-label="Modules">
          {saveModules.error ? <Alert tone="danger">{saveModules.error}</Alert> : null}
          <ModulePicker value={modules} onChange={setModules} catalog={catalog} />
          <Field label="Reason for the change (kept in the audit log)">
            {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
          <Button
            loading={saveModules.isPending}
            disabled={same}
            onClick={() => {
              setLocalError(undefined);
              if (reason.trim().length < 3) return setLocalError('Give a reason for the change.');
              saveModules.mutate(undefined);
            }}
          >
            Save modules
          </Button>
        </section>
        <section className="space-y-3" aria-label="Seats">
          {saveSeats.error ? <Alert tone="danger">{saveSeats.error}</Alert> : null}
          <Field label="Seat limit" hint="Cannot go below the current headcount.">
            {(id) => <Input id={id} inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value)} />}
          </Field>
          <Button
            variant="secondary"
            loading={saveSeats.isPending}
            disabled={!/^\d+$/.test(seats) || Number(seats) < 1}
            onClick={() => saveSeats.mutate(undefined)}
          >
            Save seats
          </Button>
        </section>
        <section className="space-y-3" aria-label="Status">
          {saveStatus.error ? <Alert tone="danger">{saveStatus.error}</Alert> : null}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              {(id) => (
                <Select id={id} value={status} onChange={(e) => setStatus(e.target.value as PlatformTenant['status'])}>
                  <option value="ACTIVE">Active</option>
                  <option value="SUSPENDED">Suspended</option>
                  <option value="CLOSED">Closed</option>
                </Select>
              )}
            </Field>
            <Field label="Reason">
              {(id) => <Input id={id} value={statusReason} onChange={(e) => setStatusReason(e.target.value)} />}
            </Field>
          </div>
          <Button
            variant="secondary"
            loading={saveStatus.isPending}
            disabled={status === tenant.status || statusReason.trim().length < 3}
            onClick={() => {
              if (status === 'CLOSED' && !window.confirm('Close this company? Its people lose access.')) return;
              saveStatus.mutate(undefined);
            }}
          >
            Change status
          </Button>
        </section>
      </div>
    </Modal>
  );
}

function Onboard({ catalog, onClose }: { catalog: PlatformModule[]; onClose: () => void }) {
  const [name, setName] = useState('');
  const [seats, setSeats] = useState('25');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [owner, setOwner] = useState('');
  const [modules, setModules] = useState(catalog.map((m) => m.key));
  const [localError, setLocalError] = useState<string>();
  const save = useSave(
    () =>
      api.post('/platform/tenants', {
        name: name.trim(),
        maxEmployees: Number(seats),
        owner: { email: owner.trim(), firstName: first.trim(), lastName: last.trim() },
        modules,
      }),
    ['platform-tenants'],
    onClose,
  );
  const submit = () => {
    setLocalError(undefined);
    if (name.trim().length < 2) return setLocalError('Enter the company name.');
    if (!/^\d+$/.test(seats) || Number(seats) < 1) return setLocalError('Enter the number of seats.');
    if (!first.trim() || !last.trim() || !/^\S+@\S+\.\S+$/.test(owner.trim()))
      return setLocalError("Enter the owner's name and email.");
    save.mutate(undefined);
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Onboard company" description="The owner receives an activation email.">
      <div className="space-y-3">
        {localError || save.error ? <Alert tone="danger">{localError ?? save.error}</Alert> : null}
        <Field label="Company name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Seats">{(id) => <Input id={id} inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value)} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Owner first name">{(id) => <Input id={id} value={first} onChange={(e) => setFirst(e.target.value)} />}</Field>
          <Field label="Owner last name">{(id) => <Input id={id} value={last} onChange={(e) => setLast(e.target.value)} />}</Field>
        </div>
        <Field label="Owner email">{(id) => <Input id={id} type="email" value={owner} onChange={(e) => setOwner(e.target.value)} />}</Field>
        <ModulePicker value={modules} onChange={setModules} catalog={catalog} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={submit}>
            Onboard
          </Button>
        </div>
      </div>
    </Modal>
  );
}
