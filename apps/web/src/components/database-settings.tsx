'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ConnectionTester, CustomerDbFields, type CustomerDbValue } from '@/components/hosting-choice';
import { useAuth } from '@/components/auth';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Alert, Badge, Card, CardTitle, Skeleton } from '@/components/ui/display';
import { Field, Input } from '@/components/ui/form';
import { useList, useOne } from '@/hooks/api';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';

interface DbInfo {
  hostingMode: 'MANAGED' | 'CUSTOMER_OWNED';
  provider: string;
  status: string;
  health: string;
  message: string;
  databaseName?: string;
  schemaVersion: number;
  latestSchemaVersion: number;
  lastConnectionCheck?: string;
  lastSuccessfulConnection?: string;
  lastFailureAt?: string;
  lastError?: string;
  usage?: { storageSizeMb: number; collections?: number; limitMb?: number; overLimit?: boolean };
  responsibilities: { us: string[]; you: string[] };
  managed?: { backupPolicy: string; planId?: string; storageLimitMb?: number };
  canChangeConnection: boolean;
}
interface DbEvent {
  _id: string;
  type: string;
  createdAt: string;
  ok: boolean;
  detail?: { code?: string; error?: string };
}

const fmt = (d?: string) => (d ? new Date(d).toLocaleString() : '—');
const healthTone = (h: string) => (h === 'HEALTHY' ? 'success' : h === 'UNKNOWN' ? 'neutral' : h === 'DEGRADED' ? 'warn' : 'danger');

function ReplaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState<CustomerDbValue>({ connectionString: '', databaseName: '' });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      await api.put('/tenants/current/database/connection', {
        connectionString: v.connectionString.trim(),
        ...(v.databaseName.trim() ? { databaseName: v.databaseName.trim() } : {}),
        currentPassword: password,
        confirm: true,
      });
      setV({ connectionString: '', databaseName: '' });
      setPassword('');
      setConfirm(false);
      await qc.invalidateQueries({ queryKey: ['database'] });
      onClose();
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Replace database connection"
      description="Use this when your credentials changed or your cluster moved. It must point to the same database."
    >
      <div className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <CustomerDbFields value={v} onChange={setV} />
        <ConnectionTester value={v} endpoint="/tenants/current/database/test" />
        <Field label="Your password" hint="Required to confirm this change.">
          {(id) => (
            <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          )}
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          <span>I understand the new connection replaces the current one for my whole company.</span>
        </label>
        <Button
          type="button"
          onClick={submit}
          loading={busy}
          disabled={!confirm || !password || v.connectionString.trim().length < 10}
        >
          Verify and replace
        </Button>
      </div>
    </Modal>
  );
}

export function DatabaseSettings() {
  const { can } = useAuth();
  const allowed = can('tenant:database');
  const info = useOne<DbInfo>('database', '/tenants/current/database', allowed);
  const events = useList<DbEvent>('database', '/tenants/current/database/events', { limit: 10 }, allowed);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [note, setNote] = useState<string>();

  if (!allowed) return null;
  const d = info.data?.data;

  async function recheck() {
    setRechecking(true);
    setNote(undefined);
    try {
      await api.post('/tenants/current/database/recheck');
      await qc.invalidateQueries({ queryKey: ['database'] });
    } catch (e) {
      setNote(userMessage(e));
    } finally {
      setRechecking(false);
    }
  }

  return (
    <Card className="space-y-4" id="database">
      <CardTitle>Database &amp; Infrastructure</CardTitle>
      {info.isPending ? <Skeleton className="h-24" /> : null}
      {info.isError ? <Alert tone="danger">{userMessage(info.error)}</Alert> : null}
      {note ? <Alert tone="danger">{note}</Alert> : null}
      {d ? (
        <>
          <Alert tone={d.health === 'HEALTHY' ? 'success' : d.health === 'UNKNOWN' ? 'info' : d.health === 'DEGRADED' ? 'warn' : 'danger'}>
            {d.message}
          </Alert>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">Hosting</dt><dd>{d.hostingMode === 'MANAGED' ? 'HRMS Managed Database' : 'Customer-Owned MongoDB'}</dd></div>
            <div><dt className="text-muted">Provider</dt><dd>{d.provider}</dd></div>
            <div><dt className="text-muted">Status</dt><dd><Badge tone={d.status === 'READY' ? 'success' : 'warn'}>{d.status}</Badge></dd></div>
            <div><dt className="text-muted">Health</dt><dd><Badge tone={healthTone(d.health)}>{d.health}</Badge></dd></div>
            {d.databaseName ? <div><dt className="text-muted">Database name</dt><dd>{d.databaseName}</dd></div> : null}
            <div><dt className="text-muted">Schema version</dt><dd>{d.schemaVersion} (latest {d.latestSchemaVersion})</dd></div>
            <div><dt className="text-muted">Last checked</dt><dd>{fmt(d.lastConnectionCheck)}</dd></div>
            {d.hostingMode === 'CUSTOMER_OWNED' ? (
              <div><dt className="text-muted">Last successful connection</dt><dd>{fmt(d.lastSuccessfulConnection)}</dd></div>
            ) : null}
            {d.usage ? (
              <div>
                <dt className="text-muted">Storage used</dt>
                <dd>
                  {d.usage.storageSizeMb.toFixed(1)} MB{d.usage.limitMb ? ` of ${d.usage.limitMb} MB` : ''}
                  {d.usage.overLimit ? ' (over limit)' : ''}
                </dd>
              </div>
            ) : null}
            {d.managed ? (
              <div><dt className="text-muted">Plan</dt><dd>{d.managed.planId ?? '—'}</dd></div>
            ) : null}
          </dl>
          {d.lastError ? <Alert tone="warn">Last error: {d.lastError}</Alert> : null}
          {d.managed ? <p className="text-sm text-muted">Backups: {d.managed.backupPolicy}</p> : null}
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <p className="mb-1 font-medium">We take care of</p>
              <ul className="list-disc space-y-0.5 pl-5 text-muted">{d.responsibilities.us.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
            <div>
              <p className="mb-1 font-medium">You are responsible for</p>
              <ul className="list-disc space-y-0.5 pl-5 text-muted">{d.responsibilities.you.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {d.hostingMode === 'CUSTOMER_OWNED' ? (
              <Button type="button" variant="secondary" onClick={recheck} loading={rechecking}>
                Re-check connection
              </Button>
            ) : null}
            {d.canChangeConnection ? (
              <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
                Replace connection details
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted">
            The connection string is stored encrypted and is never shown. Changing between managed and
            customer-owned hosting needs a guided data migration and is not available yet; contact support.
          </p>
          {events.data?.data?.length ? (
            <div>
              <p className="mb-1 text-sm font-medium">Recent activity</p>
              <ul className="space-y-0.5 text-sm text-muted">
                {events.data.data.map((e) => (
                  <li key={e._id}>{fmt(e.createdAt)} — {e.type.replace(/_/g, ' ').toLowerCase()} ({e.ok ? 'ok' : `failed${e.detail?.code ? `: ${e.detail.code}` : ''}`})</li>
                ))}
              </ul>
            </div>
          ) : null}
          <ReplaceDialog open={open} onClose={() => setOpen(false)} />
        </>
      ) : null}
    </Card>
  );
}
