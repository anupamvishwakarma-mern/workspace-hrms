'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Consent, Field, Honeypot, Input, Select, StatusBanner } from './fields';
import { Button } from '@/components/ui/button';
import { site } from '@/config/site';
import { track } from '@/lib/analytics/track';
import { cn } from '@/lib/utils';
import { trialSchema, type TrialInput } from '@/lib/validation/schemas';

type Outcome =
  | {
      status: 'created';
      message: string;
      activationPath?: string;
      hostingMode: 'MANAGED' | 'CUSTOMER_OWNED';
    }
  | {
      status: 'existing_account' | 'validation_error' | 'database_error' | 'unavailable' | 'failed';
      message: string;
      fields?: Record<string, string>;
    };

function zones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf(
      'timeZone',
    );
  } catch {
    return ['UTC'];
  }
}

export function TrialForm() {
  const tzList = useMemo(zones, []);
  const browserTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return 'UTC';
    }
  }, []);
  const [phase, setPhase] = useState<'idle' | 'sending'>('idle');
  const [outcome, setOutcome] = useState<Outcome>();
  const startedAt = useRef(Date.now());
  const started = useRef(false);
  const f = useForm<TrialInput>({
    resolver: zodResolver(trialSchema as never),
    defaultValues: {
      hostingMode: 'MANAGED',
      timezone: tzList.includes(browserTz) ? browserTz : 'UTC',
      employees: 10,
    },
  });
  const e = f.formState.errors;
  const mode = f.watch('hostingMode');
  const onStart = () => {
    if (!started.current) {
      started.current = true;
      track('trial_registration_start');
    }
  };

  const submit = f.handleSubmit(async (v) => {
    setPhase('sending');
    setOutcome(undefined);
    try {
      const res = await fetch('/api/trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...v, startedAt: startedAt.current }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<Outcome> & {
        fields?: Record<string, string>;
        message?: string;
        status?: string;
      };
      if (body.status) {
        setOutcome(body as Outcome);
        if (body.status === 'created') {
          track('trial_registration_success', {
            hosting: (body as { hostingMode?: string }).hostingMode ?? v.hostingMode,
          });
          f.reset({ hostingMode: 'MANAGED' });
        } else {
          f.setValue('connectionString', '');
        }
        for (const [k, m] of Object.entries(body.fields ?? {}))
          f.setError(k as never, { message: m });
      } else {
        setOutcome({
          status: 'failed',
          message:
            body.message ??
            'Registration could not be completed and no account was confirmed. Please try again.',
        });
      }
    } catch {
      setOutcome({
        status: 'failed',
        message:
          'We could not reach the server. Nothing was created. Check your connection and try again.',
      });
    } finally {
      setPhase('idle');
    }
  });

  if (outcome?.status === 'created') {
    return (
      <div className="space-y-5">
        <StatusBanner tone="success" title="Your workspace was created">
          {outcome.message}
        </StatusBanner>
        <p className="text-sm text-muted">
          {outcome.hostingMode === 'CUSTOMER_OWNED'
            ? 'Your MongoDB passed verification and was set up for your company.'
            : 'Your company has its own private database on our managed infrastructure.'}
        </p>
        {outcome.activationPath ? (
          <Button asChild size="lg" className="w-full">
            <a href={`${site.appUrl}${outcome.activationPath}`}>Set your password and continue</a>
          </Button>
        ) : (
          <>
            <p className="text-sm text-muted">
              Open the activation email to set your password, then sign in to the application.
            </p>
            <Button asChild size="lg" className="w-full">
              <a href={site.loginUrl()}>Go to sign in</a>
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      onChange={onStart}
      noValidate
      className="relative space-y-5"
      aria-describedby="trial-status"
    >
      <Honeypot {...f.register('website' as never)} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="First name" required error={e.firstName?.message}>
          {(p) => <Input autoComplete="given-name" {...p} {...f.register('firstName')} />}
        </Field>
        <Field label="Last name" required error={e.lastName?.message}>
          {(p) => <Input autoComplete="family-name" {...p} {...f.register('lastName')} />}
        </Field>
        <Field label="Business email" required error={e.email?.message}>
          {(p) => <Input type="email" autoComplete="email" {...p} {...f.register('email')} />}
        </Field>
        <Field label="Phone" error={e.phone?.message}>
          {(p) => <Input type="tel" autoComplete="tel" {...p} {...f.register('phone')} />}
        </Field>
        <Field label="Company name" required error={e.companyName?.message}>
          {(p) => <Input autoComplete="organization" {...p} {...f.register('companyName')} />}
        </Field>
        <Field
          label="Number of employees"
          required
          error={e.employees?.message}
          hint="Sets your seat limit."
        >
          {(p) => (
            <Input
              type="number"
              min={1}
              max={10000}
              {...p}
              {...f.register('employees', { valueAsNumber: true })}
            />
          )}
        </Field>
        <Field label="Country" required error={e.country?.message}>
          {(p) => <Input autoComplete="country-name" {...p} {...f.register('country')} />}
        </Field>
        <Field label="Time zone" required error={e.timezone?.message}>
          {(p) => (
            <Select {...p} {...f.register('timezone')}>
              {tzList.map((z) => (
                <option key={z}>{z}</option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Database hosting</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ['MANAGED', 'HRMS Managed Database', 'We host and operate it. Nothing to set up.'],
              ['CUSTOMER_OWNED', 'Customer-Owned MongoDB', 'Your data stays in your own MongoDB.'],
            ] as const
          ).map(([v, t, d]) => (
            <label
              key={v}
              className={cn(
                'flex cursor-pointer gap-3 rounded-xl border p-4 text-sm transition',
                mode === v
                  ? 'border-primary bg-primary-soft/40 ring-1 ring-primary'
                  : 'border-border hover:bg-surface-2',
              )}
            >
              <input
                type="radio"
                value={v}
                className="mt-1 accent-[var(--primary)]"
                {...f.register('hostingMode')}
              />
              <span>
                <span className="block font-semibold">{t}</span>
                <span className="text-muted">{d}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {mode === 'CUSTOMER_OWNED' ? (
        <div className="space-y-4 rounded-xl border border-border bg-surface p-4">
          <StatusBanner tone="info" title="How your connection string is handled">
            It is sent over HTTPS to our server, verified, encrypted and stored. It is never shown
            again, never stored in your browser, and never sent to analytics. Use a dedicated
            database user with only the permissions listed on the{' '}
            <Link className="underline" href="/database-hosting">
              database hosting page
            </Link>
            .
          </StatusBanner>
          <Field
            label="MongoDB connection string"
            required
            error={e.connectionString?.message}
            hint="mongodb:// or mongodb+srv://"
          >
            {(p) => (
              <Input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="mongodb+srv://user:password@host/database"
                {...p}
                {...f.register('connectionString')}
              />
            )}
          </Field>
          <Field
            label="Database name (optional)"
            error={e.databaseName?.message}
            hint="Only needed if the connection string does not name a database."
          >
            {(p) => (
              <Input autoComplete="off" maxLength={60} {...p} {...f.register('databaseName')} />
            )}
          </Field>
        </div>
      ) : null}

      <Consent error={e.consent?.message} {...f.register('consent')}>
        I agree to the{' '}
        <Link href="/terms" className="text-link underline">
          Terms of Service
        </Link>{' '}
        and have read the{' '}
        <Link href="/privacy-policy" className="text-link underline">
          Privacy Policy
        </Link>
        .
      </Consent>

      <div id="trial-status" aria-live="polite" className="space-y-3">
        {phase === 'sending' ? (
          <StatusBanner tone="info" title="Registration in progress">
            <span className="inline-flex items-center gap-2">
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
              {mode === 'CUSTOMER_OWNED'
                ? 'Verifying your MongoDB and preparing your workspace. This can take up to a minute. Please keep this page open.'
                : 'Creating your workspace and database. This usually takes a few seconds.'}
            </span>
          </StatusBanner>
        ) : null}
        {outcome?.status === 'existing_account' ? (
          <StatusBanner tone="warn" title="You already have an account">
            {outcome.message}{' '}
            <a className="underline" href={site.loginUrl()}>
              Sign in
            </a>
          </StatusBanner>
        ) : null}
        {outcome?.status === 'validation_error' ? (
          <StatusBanner tone="error" title="Please check your details">
            {outcome.message}
          </StatusBanner>
        ) : null}
        {outcome?.status === 'database_error' ? (
          <StatusBanner
            tone="error"
            title="We could not verify your database. Nothing was created."
          >
            {outcome.message}
          </StatusBanner>
        ) : null}
        {outcome?.status === 'unavailable' ? (
          <StatusBanner tone="warn" title="Signup is not open right now">
            {outcome.message}{' '}
            <Link className="underline" href={site.demoUrl}>
              Book a demo
            </Link>
          </StatusBanner>
        ) : null}
        {outcome?.status === 'failed' ? (
          <StatusBanner tone="error" title="Provisioning did not complete">
            {outcome.message}
          </StatusBanner>
        ) : null}
      </div>
      <Button type="submit" size="lg" className="w-full" loading={phase === 'sending'}>
        Start free trial
      </Button>
    </form>
  );
}
