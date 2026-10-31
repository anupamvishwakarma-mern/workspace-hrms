'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { Consent, Field, Honeypot, Input, StatusBanner, useSubmit } from './fields';
import { Button } from '@/components/ui/button';
import { track } from '@/lib/analytics/track';
import {
  newsletterSchema,
  unsubscribeSchema,
  type NewsletterInput,
} from '@/lib/validation/schemas';

export function NewsletterForm({ compact = false }: { compact?: boolean }) {
  const { state, send } = useSubmit('/api/newsletter');
  const f = useForm<NewsletterInput>({ resolver: zodResolver(newsletterSchema as never) });
  const e = f.formState.errors;
  if (state.phase === 'done')
    return (
      <StatusBanner tone="success" title="You are subscribed.">
        Thanks. You can unsubscribe at any time from the{' '}
        <Link className="underline" href="/unsubscribe">
          unsubscribe page
        </Link>
        .
      </StatusBanner>
    );
  return (
    <form
      noValidate
      className="relative space-y-3"
      onSubmit={f.handleSubmit(async (v) => {
        const r = await send(v);
        if (r.ok) track('newsletter_signup');
      })}
    >
      <Honeypot {...f.register('website' as never)} />
      <p className="text-sm font-semibold">
        {compact ? 'Get HR insights and product updates' : 'Subscribe to our newsletter'}
      </p>
      <div className="flex gap-2">
        <div className="flex-1">
          <Field label="Email address" error={e.email?.message}>
            {(p) => (
              <Input
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                {...p}
                {...f.register('email')}
              />
            )}
          </Field>
        </div>
        <Button type="submit" className="mt-[1.65rem]" loading={state.phase === 'sending'}>
          Subscribe
        </Button>
      </div>
      <Consent error={e.consent?.message} {...f.register('consent')}>
        I agree to receive emails about HR insights and product updates. I can unsubscribe at any
        time.{' '}
        <Link className="underline" href="/privacy-policy">
          Privacy Policy
        </Link>
        .
      </Consent>
      {state.phase === 'error' ? <StatusBanner tone="error">{state.message}</StatusBanner> : null}
    </form>
  );
}

export function UnsubscribeForm() {
  const { state, send } = useSubmit('/api/newsletter/unsubscribe');
  const f = useForm<{ email: string }>({ resolver: zodResolver(unsubscribeSchema as never) });
  if (state.phase === 'done')
    return (
      <StatusBanner tone="success" title="Request received.">
        We will remove this address from our mailing list.
      </StatusBanner>
    );
  return (
    <form
      noValidate
      className="relative max-w-md space-y-4"
      onSubmit={f.handleSubmit((v) => send(v))}
    >
      <Honeypot {...f.register('website' as never)} />
      <Field label="Email address" required error={f.formState.errors.email?.message}>
        {(p) => <Input type="email" autoComplete="email" {...p} {...f.register('email')} />}
      </Field>
      {state.phase === 'error' ? <StatusBanner tone="error">{state.message}</StatusBanner> : null}
      <Button type="submit" loading={state.phase === 'sending'}>
        Unsubscribe
      </Button>
    </form>
  );
}
