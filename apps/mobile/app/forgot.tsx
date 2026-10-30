import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { AuthField, AuthShell, TextLink } from '@/components/auth-ui';
import { Banner, Button, Card } from '@/components/ui';
import { api } from '@/lib/client';
import { userMessage } from '@/lib/errors';
import { useTheme } from '@/theme';

const RESEND_SECONDS = 30;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Asks the server to email a reset link. The server answers the same way whether or not the account exists. */
export default function Forgot() {
  const t = useTheme();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const valid = EMAIL.test(email.trim());
  const send = async () => {
    if (!valid) return setError('Enter a valid email');
    setBusy(true);
    setError(undefined);
    try {
      await api.call({
        method: 'POST',
        path: '/auth/forgot-password',
        body: { email: email.trim() },
        auth: false,
        tenant: false,
      });
      setSent(true);
      setWait(RESEND_SECONDS);
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Forgot password?"
      subtitle="Enter your work email and we will send you a link to choose a new password."
      footer={
        <Text style={{ color: t.muted, fontSize: 14, textAlign: 'center' }}>
          Email changed? Ask HR to update it.
        </Text>
      }
    >
      {sent ? (
        <Banner tone="success">
          Link sent. If an account exists for that email, a reset link is on its way. Check your
          spam folder too.
        </Banner>
      ) : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <AuthField
        label="Work email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="username"
        autoComplete="email"
        placeholder="name@company.com"
        onSubmitEditing={() => void send()}
      />
      <Button
        title={sent ? (wait > 0 ? `Send again in ${wait}s` : 'Send again') : 'Send reset link'}
        onPress={() => void send()}
        loading={busy}
        disabled={!valid || wait > 0}
        size="lg"
      />
      <Card>
        <Text style={{ color: t.text, fontWeight: '800', fontSize: 15 }}>
          Choose a strong password
        </Text>
        {[
          'At least 10 characters',
          'A mix of letters and numbers',
          'Not one you use elsewhere',
        ].map((r) => (
          <View key={r} style={{ flexDirection: 'row', gap: 8 }}>
            <Text style={{ color: t.primary, fontWeight: '800' }}>•</Text>
            <Text style={{ color: t.muted, fontSize: 14, flex: 1 }}>{r}</Text>
          </View>
        ))}
      </Card>
      <View style={{ alignItems: 'center' }}>
        <TextLink title="Back to sign in" onPress={() => router.back()} />
      </View>
    </AuthShell>
  );
}
