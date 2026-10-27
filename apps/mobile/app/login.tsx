import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { useAuth } from '@/auth/AuthProvider';
import { Banner, Body, Button, Card, Field, H1, Screen } from '@/components/ui';
import { useTheme } from '@/theme';
import { userMessage } from '@/lib/errors';
import { loginSchema, type LoginForm } from '@/lib/forms';
import { useT } from '@/prefs';

export default function Login() {
  const tr = useT();
  const t = useTheme();
  const { signIn } = useAuth();
  const [error, setError] = useState<string>();
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const submit = handleSubmit(async (v) => {
    setError(undefined);
    try {
      await signIn(v.email.trim(), v.password);
    } catch (e) {
      setError(userMessage(e));
    }
  });

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen>
        <View style={{ gap: 14, paddingTop: 36, paddingBottom: 8 }}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={{
              width: 56,
              height: 56,
              borderRadius: 18,
              backgroundColor: t.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: t.primaryText, fontSize: 26, fontWeight: '800' }}>W</Text>
          </View>
          <H1>{tr('login.welcome')}</H1>
          <Body muted>{tr('login.subtitle')}</Body>
        </View>
        <Card>
          {error ? <Banner tone="danger">{error}</Banner> : null}
          <Controller
            control={control}
            name="email"
            render={({ field }) => (
              <Field
                label={tr('login.email')}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={errors.email?.message}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="username"
                autoComplete="email"
              />
            )}
          />
          <Controller
            control={control}
            name="password"
            render={({ field }) => (
              <Field
                label={tr('login.password')}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={errors.password?.message}
                secureTextEntry
                autoCapitalize="none"
                textContentType="password"
                autoComplete="password"
                onSubmitEditing={() => void submit()}
              />
            )}
          />
          <Button title={tr('login.signIn')} onPress={() => void submit()} loading={isSubmitting} />
        </Card>
      </Screen>
    </KeyboardAvoidingView>
  );
}
