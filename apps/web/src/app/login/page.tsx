'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAuth } from '@/components/auth';
import { Button } from '@/components/ui/button';
import { AuthShell } from '@/components/auth-shell';
import { Alert } from '@/components/ui/display';
import { Field, Input } from '@/components/ui/form';
import { userMessage } from '@/lib/errors';

const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email').email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
});
type Form = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const { status, signIn, memberships, selectCompany, signOut } = useAuth();
  const [error, setError] = useState<string>();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Form>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (status === 'ready') router.replace('/dashboard');
  }, [status, router]);

  if (status === 'needsCompany')
    return (
      <AuthShell title="Choose a company" subtitle="Your account belongs to more than one company.">
        <ul className="space-y-2">
          {memberships.map((m) => (
            <li key={m.tenantId}>
              <Button
                variant="secondary"
                className="w-full justify-between"
                onClick={() => selectCompany(m.tenantId)}
              >
                <span>{m.tenantName ?? m.tenantSlug}</span>
                <span className="text-xs font-normal text-muted">{m.roles.join(', ')}</span>
              </Button>
            </li>
          ))}
        </ul>
        <Button variant="ghost" onClick={() => void signOut()}>
          Sign out
        </Button>
      </AuthShell>
    );

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to manage attendance and people.">
      {status === 'offline' ? <Alert tone="warn">Cannot reach the server right now.</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <form
        className="space-y-4"
        noValidate
        onSubmit={handleSubmit(async (v) => {
          setError(undefined);
          try {
            await signIn(v.email, v.password);
          } catch (e) {
            setError(userMessage(e));
          }
        })}
      >
        <Field label="Email" error={errors.email?.message}>
          {(id, invalid) => (
            <Input
              id={id}
              type="email"
              autoComplete="username"
              invalid={invalid}
              {...register('email')}
            />
          )}
        </Field>
        <Field label="Password" error={errors.password?.message}>
          {(id, invalid) => (
            <Input
              id={id}
              type="password"
              autoComplete="current-password"
              invalid={invalid}
              {...register('password')}
            />
          )}
        </Field>
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Sign in
        </Button>
        <Link href="/forgot-password" className="block text-center text-sm text-primary underline">
          Forgot your password?
        </Link>
        <Link href="/signup" className="block text-center text-sm text-primary underline">
          New company? Create a workspace
        </Link>
      </form>
    </AuthShell>
  );
}
