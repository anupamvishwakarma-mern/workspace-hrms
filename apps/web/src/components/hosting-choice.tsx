'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/display';
import { Field, Input } from '@/components/ui/form';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';

export type HostingMode = 'MANAGED' | 'CUSTOMER_OWNED';

export interface DbCheck {
  name: string;
  ok: boolean;
  detail?: string;
}
export interface DbTestResult {
  ok: boolean;
  databaseName: string;
  serverVersion: string;
  checks: DbCheck[];
}

export interface CustomerDbValue {
  connectionString: string;
  databaseName: string;
}

const CHECK_LABELS: Record<string, string> = {
  connection: 'Connection',
  authentication: 'Authentication',
  version: 'MongoDB version',
  topology: 'Replica set (transactions)',
  permissions: 'Permissions (create, index, write)',
  emptiness: 'Database is empty or ours',
  binding: 'Not used by another company',
};

/** Test button + result list for a customer-owned connection. The string is sent, never stored or echoed back. */
export function ConnectionTester({
  value,
  endpoint,
  onResult,
  pub = false,
}: {
  value: CustomerDbValue;
  endpoint: string;
  pub?: boolean;
  onResult?: (r: DbTestResult | undefined) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<DbTestResult>();

  async function run() {
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    onResult?.(undefined);
    try {
      const body = {
        connectionString: value.connectionString,
        ...(value.databaseName.trim() ? { databaseName: value.databaseName.trim() } : {}),
      };
      const res = pub ? await api.postPublic<DbTestResult>(endpoint, body) : await api.post<DbTestResult>(endpoint, body);
      setResult(res.data);
      onResult?.(res.data);
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant="secondary"
        onClick={run}
        loading={busy}
        disabled={value.connectionString.trim().length < 10}
      >
        Test connection
      </Button>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {result ? (
        <div className="space-y-2">
          <Alert tone="success">
            Connected to database <b>{result.databaseName}</b> (MongoDB {result.serverVersion}). Nothing has
            been saved yet.
          </Alert>
          <ul className="space-y-1 text-sm">
            {result.checks.map((c) => (
              <li key={c.name} className={c.ok ? 'text-success' : 'text-danger'}>
                {c.ok ? '✓' : '✗'} {CHECK_LABELS[c.name] ?? c.name}
                {c.detail ? <span className="text-muted"> — {c.detail}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Connection string (masked) + optional database name. */
export function CustomerDbFields({
  value,
  onChange,
}: {
  value: CustomerDbValue;
  onChange: (v: CustomerDbValue) => void;
}) {
  return (
    <div className="space-y-4">
      <Field
        label="MongoDB connection string"
        hint="mongodb:// or mongodb+srv://. It is checked, encrypted and stored securely, and is never shown again."
      >
        {(id) => (
          <Input
            id={id}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="mongodb+srv://user:password@cluster.example.net/mydb"
            value={value.connectionString}
            onChange={(e) => onChange({ ...value, connectionString: e.target.value })}
          />
        )}
      </Field>
      <Field label="Database name (optional)" hint="Only needed if the connection string does not name a database.">
        {(id) => (
          <Input
            id={id}
            autoComplete="off"
            maxLength={60}
            value={value.databaseName}
            onChange={(e) => onChange({ ...value, databaseName: e.target.value })}
          />
        )}
      </Field>
    </div>
  );
}

const OPTIONS: {
  mode: HostingMode;
  title: string;
  description: string;
  benefits: string[];
}[] = [
  {
    mode: 'MANAGED',
    title: 'HRMS Managed Database',
    description: 'We host and operate your private database. Nothing to set up.',
    benefits: ['Fastest setup', 'Backups and maintenance handled for you', 'No infrastructure to manage'],
  },
  {
    mode: 'CUSTOMER_OWNED',
    title: 'Customer-Owned MongoDB',
    description: 'Your data stays in your own MongoDB cluster. You provide the connection string.',
    benefits: ['Full ownership of your data', 'Your own network and compliance controls', 'Your own backup policy'],
  },
];

export function HostingChoice({
  mode,
  onMode,
  customerAvailable,
}: {
  mode: HostingMode;
  onMode: (m: HostingMode) => void;
  customerAvailable: boolean;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium">Where should your data live?</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map((o) => {
          const disabled = o.mode === 'CUSTOMER_OWNED' && !customerAvailable;
          const selected = mode === o.mode;
          return (
            <label
              key={o.mode}
              className={cn(
                'flex cursor-pointer flex-col gap-2 rounded-xl border p-3 text-sm',
                selected ? 'border-primary ring-1 ring-primary' : 'border-border',
                disabled && 'cursor-not-allowed opacity-50',
              )}
            >
              <span className="flex items-center gap-2 font-medium">
                <input
                  type="radio"
                  name="hostingMode"
                  checked={selected}
                  disabled={disabled}
                  onChange={() => onMode(o.mode)}
                />
                {o.title}
              </span>
              <span className="text-muted">{o.description}</span>
              <ul className="list-disc space-y-0.5 pl-5 text-muted">
                {o.benefits.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              {disabled ? <span className="text-xs text-muted">Not available on this server.</span> : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
