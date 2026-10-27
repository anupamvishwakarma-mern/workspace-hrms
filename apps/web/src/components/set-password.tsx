'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { AuthShell } from '@/components/auth-shell';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/display';
import { Field, Input } from '@/components/ui/form';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';

const schema = z
  .object({
    password: z
      .string()
      .min(10, 'Use at least 10 characters')
      .max(128)
      .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Include letters and digits'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match',
  });
type Form = z.infer<typeof schema>;

/** Shared by account activation and password reset: the single-use token comes from the emailed link. */
export function SetPassword({
  title,
  endpoint,
  doneText,
}: {
  title: string;
  endpoint: '/auth/activate' | '/auth/reset-password';
  doneText: string;
}) {
  const token = useSearchParams().get('token') ?? '';
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Form>({ resolver: zodResolver(schema) });

  if (done)
    return (
      <AuthShell title={title}>
        <Alert tone="success">{doneText}</Alert>
        <Button asChild className="w-full">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </AuthShell>
    );
  if (token.length < 10)
    return (
      <AuthShell title={title}>
        <Alert tone="danger">This link is incomplete. Open the link from your email again.</Alert>
      </AuthShell>
    );
  return (
    <AuthShell title={title}>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <form
        className="space-y-4"
        noValidate
        onSubmit={handleSubmit(async (v) => {
          setError(undefined);
          try {
            await api.postPublic(endpoint, { token, password: v.password });
            setDone(true);
          } catch (e) {
            setError(userMessage(e));
          }
        })}
      >
        <Field
          label="New password"
          error={errors.password?.message}
          hint="At least 10 characters, with letters and digits."
        >
          {(id, inv) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              invalid={inv}
              {...register('password')}
            />
          )}
        </Field>
        <Field label="Confirm password" error={errors.confirm?.message}>
          {(id, inv) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              invalid={inv}
              {...register('confirm')}
            />
          )}
        </Field>
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Set password
        </Button>
      </form>
    </AuthShell>
  );
}
