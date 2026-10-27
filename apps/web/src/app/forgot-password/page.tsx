'use client';
import Link from 'next/link';
import { useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/display';
import { Field, Input } from '@/components/ui/form';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <AuthShell title="Reset password">
      {sent ? (
        <Alert tone="info">
          If that address belongs to an account, a reset link has been sent. It can be used once.
        </Alert>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(undefined);
            try {
              await api.postPublic('/auth/forgot-password', { email: email.trim() });
              setSent(true);
            } catch (err) {
              setError(userMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field label="Email">
            {(id) => (
              <Input
                id={id}
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" className="w-full" loading={busy}>
            Send reset link
          </Button>
        </form>
      )}
      <Link href="/login" className="block text-sm text-primary underline">
        Back to sign in
      </Link>
    </AuthShell>
  );
}
