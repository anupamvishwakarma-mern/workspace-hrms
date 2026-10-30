'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '@/components/auth';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Alert, Badge, Card, CardTitle, Empty, Skeleton, TabBar, Table, Td, Th } from '@/components/ui/display';
import { Field, Input, Select } from '@/components/ui/form';
import { useSave } from '@/hooks/api';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import type {
  PlatformAdmin,
  PlatformCompanyDetail,
  PlatformMetrics,
  PlatformModule,
  PlatformOwner,
  PlatformTenant,
} from '@/lib/types';

type Tab = 'dashboard' | 'companies' | 'admins';
const TABS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'companies', label: 'Companies' },
  { key: 'admins', label: 'Administrators' },
] as const;
const statusTone = (s: string) => (s === 'ACTIVE' ? 'success' : s === 'SUSPENDED' ? 'warn' : 'neutral');
const when = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : '—');
const ACTIONS: Record<string, string> = {
  'platform.tenant_create': 'Company created',
  'platform.tenant_status': 'Status changed',
  'platform.tenant_seats': 'Seat limit changed',
  'platform.tenant_modules': 'Modules changed',
};

/** What a platform administrator sees instead of a company: the whole platform, and what each company may use. */
export function PlatformConsole() {
  const { email, signOut } = useAuth();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [onboarding, setOnboarding] = useState(false);
  const [managing, setManaging] = useState<string>();
  const catalog = useQuery({
    queryKey: ['platform-modules'],
    queryFn: () => api.get<PlatformModule[]>('/platform/modules'),
  });
  const mods = catalog.data?.data ?? [];
  const open = (id: string) => {
    setManaging(id);
  };
  return (
    <main className="mx-auto max-w-6xl space-y-5 p-6">
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
      <TabBar tabs={TABS} value={tab} onChange={setTab} label="Console sections" />
      {tab === 'dashboard' ? <Dashboard mods={mods} onOpen={open} /> : null}
      {tab === 'companies' ? <Companies mods={mods} onOpen={open} /> : null}
      {tab === 'admins' ? <Admins /> : null}
      {managing ? <Manage id={managing} catalog={mods} onClose={() => setManaging(undefined)} /> : null}
      {onboarding ? <Onboard catalog={mods} onClose={() => setOnboarding(false)} /> : null}
    </main>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card>
      <CardTitle>{label}</CardTitle>
      <p className="mt-1 text-3xl font-bold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </Card>
  );
}

/** A labelled horizontal bar; the number is always printed so colour is never the only signal. */
function Bar({ label, value, max, tone = 'bg-primary' }: { label: string; value: number; max: number; tone?: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-28 shrink-0 truncate">{label}</span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-subtle">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${value ? pct : 0}%` }} />
      </div>
      <span className="w-10 text-right tabular-nums text-muted">{value}</span>
    </div>
  );
}

function Dashboard({ mods, onOpen }: { mods: PlatformModule[]; onOpen: (id: string) => void }) {
  const q = useQuery({
    queryKey: ['platform-tenants', 'metrics'],
    queryFn: () => api.get<PlatformMetrics>('/platform/metrics'),
  });
  if (q.isError) return <Alert tone="danger">{userMessage(q.error)}</Alert>;
  const m = q.data?.data;
  if (!m) return <Skeleton className="h-64" />;
  const live = (m.tenantsByStatus.ACTIVE ?? 0) + (m.tenantsByStatus.SUSPENDED ?? 0);
  const maxSignup = Math.max(1, ...m.signupsByMonth.map((s) => s.count));
  const used = m.seatsSold > 0 ? Math.round((m.people / m.seatsSold) * 100) : 0;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Companies" value={m.companies} hint={`${m.tenantsByStatus.ACTIVE ?? 0} active · ${m.tenantsByStatus.SUSPENDED ?? 0} suspended · ${m.tenantsByStatus.CLOSED ?? 0} closed`} />
        <Stat label="People on the platform" value={m.people} hint="Current employees across open companies" />
        <Stat label="Seats sold" value={m.seatsSold} hint={m.seatsSold ? `${used}% in use` : 'No seat limits set'} />
        <Stat label="Active sign-ins" value={m.activeUsers} hint={`${m.activeMemberships} company memberships`} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle>New companies, last 6 months</CardTitle>
          <div className="mt-3 space-y-2">
            {m.signupsByMonth.map((s) => (
              <Bar key={s.month} label={s.month} value={s.count} max={maxSignup} />
            ))}
          </div>
        </Card>
        <Card>
          <CardTitle>Module adoption ({live} open companies)</CardTitle>
          <div className="mt-3 space-y-2">
            {mods.map((x) => (
              <Bar key={x.key} label={x.label} value={m.moduleAdoption[x.key] ?? 0} max={live} tone="bg-info" />
            ))}
          </div>
        </Card>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardTitle>Near their seat limit</CardTitle>
          {m.nearSeatLimit.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No company is above 90% of its seats.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {m.nearSeatLimit.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <button className="truncate text-left font-medium text-primary hover:underline" onClick={() => onOpen(c.id)}>
                    {c.name}
                  </button>
                  <span className="tabular-nums text-muted">
                    {c.headcount}/{c.maxEmployees}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle>Suspended</CardTitle>
          {m.suspended.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No suspended companies.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {m.suspended.map((c) => (
                <li key={c.id}>
                  <button className="font-medium text-primary hover:underline" onClick={() => onOpen(c.id)}>
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle>Newest companies</CardTitle>
          <ul className="mt-2 space-y-2 text-sm">
            {m.recentCompanies.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2">
                <button className="truncate text-left font-medium text-primary hover:underline" onClick={() => onOpen(c.id)}>
                  {c.name}
                </button>
                <span className="text-xs text-muted">{when(c.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Owners onOpen={onOpen} />
    </div>
  );
}

function Owners({ onOpen }: { onOpen: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const q = useQuery({
    queryKey: ['platform-tenants', 'owners'],
    queryFn: () => api.get<PlatformOwner[]>('/platform/owners'),
  });
  const term = search.trim().toLowerCase();
  const list = (q.data?.data ?? []).filter(
    (o) => !term || o.email.toLowerCase().includes(term) || o.companyName.toLowerCase().includes(term),
  );
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle>Company owners ({q.data?.data.length ?? 0})</CardTitle>
        <div className="w-60">
          <Input aria-label="Search owners" placeholder="Search owner or company" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      {q.isError ? <Alert tone="danger">{userMessage(q.error)}</Alert> : null}
      {!q.data ? (
        q.isError ? null : <Skeleton className="mt-3 h-24" />
      ) : list.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{term ? 'No owner matches.' : 'No owners yet.'}</p>
      ) : (
        <div className="mt-3">
          <Table aria-label="Company owners">
            <thead>
              <tr>
                <Th>Owner</Th>
                <Th>Company</Th>
                <Th>Account</Th>
                <Th>Last sign-in</Th>
              </tr>
            </thead>
            <tbody>
              {list.map((o) => (
                <tr key={`${o.companyId}-${o.userId}`}>
                  <Td className="font-medium">{o.email}</Td>
                  <Td>
                    <button className="text-primary hover:underline" onClick={() => onOpen(o.companyId)}>
                      {o.companyName}
                    </button>
                    {o.companyStatus !== 'ACTIVE' ? (
                      <span className="ml-2">
                        <Badge tone={statusTone(o.companyStatus)}>{o.companyStatus.toLowerCase()}</Badge>
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    {o.userStatus === 'INVITED' ? (
                      <Badge tone="info">invited</Badge>
                    ) : o.userStatus === 'DISABLED' || o.membershipStatus === 'INACTIVE' ? (
                      <Badge tone="warn">disabled</Badge>
                    ) : (
                      <Badge tone="success">active</Badge>
                    )}
                  </Td>
                  <Td>{when(o.lastLoginAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  );
}

function Companies({ mods, onOpen }: { mods: PlatformModule[]; onOpen: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const q = useQuery({
    queryKey: ['platform-tenants', 'companies', search.trim()],
    queryFn: () => api.get<PlatformTenant[]>('/platform/companies', search.trim() ? { q: search.trim() } : {}),
  });
  const list = (q.data?.data ?? []).filter((t) => !status || t.status === status);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <div className="w-64">
          <Input aria-label="Search companies" placeholder="Search name or slug" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="w-44">
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="CLOSED">Closed</option>
          </Select>
        </div>
      </div>
      {q.isError ? <Alert tone="danger">{userMessage(q.error)}</Alert> : null}
      {!q.data ? (
        q.isError ? null : <Skeleton className="h-40" />
      ) : list.length === 0 ? (
        <Empty>{search || status ? 'No company matches.' : 'No companies yet.'}</Empty>
      ) : (
        <Table aria-label="Companies">
          <thead>
            <tr>
              <Th>Company</Th>
              <Th>Status</Th>
              <Th>People / seats</Th>
              <Th>Modules</Th>
              <Th>Created</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {list.map((t) => {
              const full = t.maxEmployees && (t.headcount ?? 0) >= t.maxEmployees;
              return (
                <tr key={t.id}>
                  <Td>
                    <span className="font-medium">{t.name}</span>
                    <span className="block text-xs text-muted">{t.slug}</span>
                  </Td>
                  <Td>
                    <Badge tone={statusTone(t.status)}>{t.status.toLowerCase()}</Badge>
                  </Td>
                  <Td>
                    <span className="tabular-nums">
                      {t.headcount ?? 0} / {t.maxEmployees ?? '∞'}
                    </span>
                    {full ? <span className="ml-2 text-xs text-warn">full</span> : null}
                  </Td>
                  <Td>
                    {t.modules.length} of {mods.length || t.modules.length}
                  </Td>
                  <Td>{when(t.createdAt)}</Td>
                  <Td>
                    <Button size="sm" variant="secondary" onClick={() => onOpen(t.id)}>
                      Manage
                    </Button>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}

function Admins() {
  const q = useQuery({
    queryKey: ['platform-admins'],
    queryFn: () => api.get<PlatformAdmin[]>('/platform/admins'),
  });
  const list = q.data?.data ?? [];
  return (
    <div className="space-y-3">
      <Alert tone="info">
        Platform administrators are created from the command line on the server, never through the app. This list is read only.
      </Alert>
      {q.isError ? <Alert tone="danger">{userMessage(q.error)}</Alert> : null}
      {!q.data ? (
        q.isError ? null : <Skeleton className="h-24" />
      ) : (
        <Table aria-label="Platform administrators">
          <thead>
            <tr>
              <Th>Email</Th>
              <Th>Status</Th>
              <Th>Last sign-in</Th>
              <Th>Created</Th>
            </tr>
          </thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id}>
                <Td className="font-medium">{u.email}</Td>
                <Td>
                  <Badge tone={u.status === 'ACTIVE' ? 'success' : 'warn'}>{u.status.toLowerCase()}</Badge>
                </Td>
                <Td>{when(u.lastLoginAt)}</Td>
                <Td>{when(u.createdAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
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

function Manage({ id, catalog, onClose }: { id: string; catalog: PlatformModule[]; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ['platform-tenants', 'detail', id],
    queryFn: () => api.get<PlatformCompanyDetail>(`/platform/companies/${id}`),
  });
  const d = detail.data?.data;
  if (detail.isError)
    return (
      <Modal open onOpenChange={(o) => !o && onClose()} title="Company">
        <Alert tone="danger">{userMessage(detail.error)}</Alert>
      </Modal>
    );
  if (!d)
    return (
      <Modal open onOpenChange={(o) => !o && onClose()} title="Company">
        <Skeleton className="h-40" />
      </Modal>
    );
  return <ManageForm key={d.company.id} detail={d} catalog={catalog} onClose={onClose} />;
}

function ManageForm({
  detail,
  catalog,
  onClose,
}: {
  detail: PlatformCompanyDetail;
  catalog: PlatformModule[];
  onClose: () => void;
}) {
  const tenant = detail.company;
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
        <section className="space-y-2 text-sm" aria-label="Overview">
          <p>
            <Badge tone={statusTone(tenant.status)}>{tenant.status.toLowerCase()}</Badge>{' '}
            <span className="text-muted">
              {tenant.headcount ?? 0} of {tenant.maxEmployees ?? 'unlimited'} seats · created {when(tenant.createdAt)} · {tenant.timezone}
            </span>
          </p>
          <div>
            <b>Owners</b>
            {detail.owners.length === 0 ? (
              <p className="text-muted">No owner found.</p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {detail.owners.map((o) => (
                  <li key={o.userId}>
                    {o.email} <span className="text-muted">· {o.userStatus === 'INVITED' ? 'invited, not yet activated' : `last sign-in ${when(o.lastLoginAt)}`}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <b>Recent platform changes</b>
            {detail.activity.length === 0 ? (
              <p className="text-muted">None yet.</p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {detail.activity.slice(0, 6).map((a) => (
                  <li key={a.id}>
                    {ACTIONS[a.action] ?? a.action} <span className="text-muted">· {when(a.at)}{a.by ? ` · ${a.by}` : ''}{a.reason ? ` · ${a.reason}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
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
