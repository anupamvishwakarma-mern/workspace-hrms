import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Text, View } from 'react-native';
import { useAuth } from '@/auth/AuthProvider';
import { AuthField, AuthShell, PasswordField, TextLink } from '@/components/auth-ui';
import { Banner, Button } from '@/components/ui';
import { ApiError, userMessage } from '@/lib/errors';
import { loginSchema, type LoginForm } from '@/lib/forms';
import { useT } from '@/prefs';
import { useTheme } from '@/theme';

export default function Login() {
  const tr = useT();
  const t = useTheme();
  const router = useRouter();
  const { signIn } = useAuth();
  const [error, setError] = useState<string>();
  const [wrong, setWrong] = useState(false);
  const {
    control,
    handleSubmit,
    resetField,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const submit = handleSubmit(async (v) => {
    setError(undefined);
    setWrong(false);
    try {
      await signIn(v.email.trim(), v.password);
    } catch (e) {
      const bad = e instanceof ApiError && e.code === 'INVALID_CREDENTIALS';
      setWrong(bad);
      setError(
        bad
          ? 'Email or password is incorrect. After several failed attempts your account is locked for a short while.'
          : userMessage(e),
      );
      if (bad) resetField('password');
    }
  });

  return (
    <AuthShell title={tr('login.welcome')} subtitle={tr('login.subtitle')}>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Controller
        control={control}
        name="email"
        render={({ field }) => (
          <AuthField
            label={tr('login.email')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            invalid={wrong || !!errors.email}
            message={errors.email?.message}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
            autoComplete="email"
            placeholder="name@company.com"
          />
        )}
      />
      <Controller
        control={control}
        name="password"
        render={({ field }) => (
          <PasswordField
            label={tr('login.password')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            invalid={wrong || !!errors.password}
            message={wrong ? 'Check your password and try again.' : errors.password?.message}
            textContentType="password"
            autoComplete="password"
            onSubmitEditing={() => void submit()}
          />
        )}
      />
      <View style={{ alignItems: 'flex-end' }}>
        <TextLink title="Forgot password?" onPress={() => router.push('/forgot')} />
      </View>
      <Button
        title={wrong ? 'Try again' : tr('login.signIn')}
        onPress={() => void submit()}
        loading={isSubmitting}
        size="lg"
      />
      {wrong ? (
        <Text style={{ color: t.muted, fontSize: 14, lineHeight: 20, textAlign: 'center' }}>
          Still stuck? Use Forgot password, or ask HR to reset your account.
        </Text>
      ) : null}
    </AuthShell>
  );
}
