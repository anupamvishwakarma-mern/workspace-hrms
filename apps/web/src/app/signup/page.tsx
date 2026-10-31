'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { AuthShell } from '@/components/auth-shell';
import {
  ConnectionTester,
  CustomerDbFields,
  HostingChoice,
  type CustomerDbValue,
  type DbTestResult,
  type HostingMode,
} from '@/components/hosting-choice';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/display';
import { Field, Input, Select } from '@/components/ui/form';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';

const schema = z.object({
  name: z.string().trim().min(2, 'Enter your company name').max(200),
  maxEmployees: z
    .number({ message: 'Enter a number' })
    .int('Enter a whole number')
    .min(1, 'At least 1 member')
    .max(10000, 'At most 10,000 members'),
  timezone: z.string().min(1),
  firstName: z.string().trim().min(1, 'Enter your first name').max(100),
  lastName: z.string().trim().min(1, 'Enter your last name').max(100),
  email: z.string().trim().min(1, 'Enter your work email').email('Enter a valid email'),
});
type Form = z.infer<typeof schema>;

interface SignupResult {
  company: { name: string; slug: string; maxEmployees: number; hostingMode?: HostingMode };
  message: string;
  activationLink?: string;
}

function timezones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf(
      'timeZone',
    );
  } catch {
    return ['UTC'];
  }
}

export default function SignupPage() {
  const zones = useMemo(() => timezones(), []);
  const browserZone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return 'UTC';
    }
  }, []);
  const [error, setError] = useState<string>();
  const [mode, setMode] = useState<HostingMode>('MANAGED');
  const [customerAvailable, setCustomerAvailable] = useState(false);
  const [cdb, setCdb] = useState<CustomerDbValue>({ connectionString: '', databaseName: '' });
  const [tested, setTested] = useState<DbTestResult>();
  useEffect(() => {
    api
      .getPublic<{ hostingModes: { mode: string; available: boolean }[] }>('/signup/options')
      .then((r) =>
        setCustomerAvailable(!!r.data.hostingModes.find((m) => m.mode === 'CUSTOMER_OWNED')?.available),
      )
      .catch(() => setCustomerAvailable(false));
  }, []);
  const [done, setDone] = useState<SignupResult>();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { timezone: zones.includes(browserZone) ? browserZone : 'UTC', maxEmployees: 10 },
  });

  if (done)
    return (
      <AuthShell title="Your workspace is ready">
        <Alert tone="success">{done.message}</Alert>
        <p className="text-sm text-muted">
          {done.company.name} has its own private database ({done.company.hostingMode === 'CUSTOMER_OWNED' ? 'in your MongoDB' : 'managed by us'}) and room for {done.company.maxEmployees}{' '}
          members. Set your password to finish, then sign in.
        </p>
        {done.activationLink ? (
          <Button asChild className="w-full">
            <a href={new URL(done.activationLink).pathname + new URL(done.activationLink).search}>
              Set your password
            </a>
          </Button>
        ) : (
          <Button asChild className="w-full">
            <Link href="/login">Go to sign in</Link>
          </Button>
        )}
      </AuthShell>
    );

  return (
    <AuthShell
      title="Create your company"
      subtitle="Set up a private workspace for attendance and HR in a minute."
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <form
        className="space-y-4"
        noValidate
        onSubmit={handleSubmit(async (v) => {
          setError(undefined);
          if (mode === 'CUSTOMER_OWNED' && cdb.connectionString.trim().length < 10) {
            setError('Enter your MongoDB connection string, or choose the managed database.');
            return;
          }
          try {
            const res = await api.postPublic<SignupResult>('/signup', {
              name: v.name,
              maxEmployees: v.maxEmployees,
              timezone: v.timezone,
              owner: { email: v.email, firstName: v.firstName, lastName: v.lastName },
              database:
                mode === 'CUSTOMER_OWNED'
                  ? {
                      hostingMode: 'CUSTOMER_OWNED',
                      connectionString: cdb.connectionString.trim(),
                      ...(cdb.databaseName.trim() ? { databaseName: cdb.databaseName.trim() } : {}),
                    }
                  : { hostingMode: 'MANAGED' },
            });
            setDone(res.data);
          } catch (e) {
            setError(userMessage(e));
          }
        })}
      >
        <Field label="Company name" error={errors.name?.message}>
          {(id, inv) => (
            <Input id={id} autoComplete="organization" invalid={inv} {...register('name')} />
          )}
        </Field>
        <Field
          label="Number of members"
          error={errors.maxEmployees?.message}
          hint="How many people will use the app. You can only add this many employees."
        >
          {(id, inv) => (
            <Input id={id} type="number" min={1} max={10000} invalid={inv} {...register('maxEmployees', { valueAsNumber: true })} />
          )}
        </Field>
        <Field label="Time zone" error={errors.timezone?.message}>
          {(id, inv) => (
            <Select id={id} invalid={inv} {...register('timezone')}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Your first name" error={errors.firstName?.message}>
            {(id, inv) => (
              <Input id={id} autoComplete="given-name" invalid={inv} {...register('firstName')} />
            )}
          </Field>
          <Field label="Your last name" error={errors.lastName?.message}>
            {(id, inv) => (
              <Input id={id} autoComplete="family-name" invalid={inv} {...register('lastName')} />
            )}
          </Field>
        </div>
        <Field label="Work email" error={errors.email?.message}>
          {(id, inv) => (
            <Input id={id} type="email" autoComplete="email" invalid={inv} {...register('email')} />
          )}
        </Field>
        <HostingChoice
          mode={mode}
          onMode={(m) => {
            setMode(m);
            setTested(undefined);
          }}
          customerAvailable={customerAvailable}
        />
        {mode === 'CUSTOMER_OWNED' ? (
          <div className="space-y-4 rounded-xl border border-border p-3">
            <CustomerDbFields
              value={cdb}
              onChange={(v) => {
                setCdb(v);
                setTested(undefined);
              }}
            />
            <ConnectionTester value={cdb} endpoint="/signup/database/test" pub onResult={setTested} />
            {!tested ? (
              <p className="text-xs text-muted">
                Testing first is recommended. Your company is only activated after the database passes every
                check.
              </p>
            ) : null}
          </div>
        ) : null}
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Create company
        </Button>
        <p className="text-center text-sm text-muted">
          Already have an account?{' '}
          <Link href="/login" className="text-primary underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
