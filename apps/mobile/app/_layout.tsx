import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { Splash } from '@/components/Splash';
import { Body, Button, Center, H1 } from '@/components/ui';
import { useAppStateFocus } from '@/hooks/queries';
import { useTheme } from '@/theme';
import { ApiError } from '@/lib/errors';
import { PrefsProvider, useT } from '@/prefs';
import { WorkspaceProvider, useFirstRun } from '@/workspace';

function Gate() {
  const t = useTheme();
  const tr = useT();
  const { status, signOut, retry } = useAuth();
  const { step } = useFirstRun();
  useAppStateFocus();
  if (status === 'loading') return <Splash />;
  if (status === 'offline')
    return (
      <Center>
        <H1>Cannot reach the server</H1>
        <Body muted>You are still signed in. Check your connection and try again.</Body>
        <Button title="Try again" onPress={retry} />
      </Center>
    );
  if (status === 'noAccess')
    return (
      <Center>
        <H1>No company access</H1>
        <Body muted>
          Your account is not an active member of any company. Contact your HR administrator.
        </Body>
        <Button title="Sign out" variant="secondary" onPress={() => void signOut()} />
      </Center>
    );
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={status === 'ready' && step === 'permissions'}>
        <Stack.Screen name="permissions" />
      </Stack.Protected>
      <Stack.Protected guard={status === 'ready' && step === 'workspace'}>
        <Stack.Screen name="workspace" />
      </Stack.Protected>
      <Stack.Protected guard={status === 'ready' && step === null}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="hr" />
        <Stack.Screen
          name="correction/new"
          options={{
            presentation: 'modal',
            headerShown: true,
            title: tr('att.requestCorrection'),
            headerStyle: { backgroundColor: t.card },
            headerTintColor: t.primary,
            headerTitleStyle: { color: t.text, fontWeight: '700' },
            contentStyle: { backgroundColor: t.bg },
          }}
        />
      </Stack.Protected>
      <Stack.Protected guard={status === 'signedOut'}>
        <Stack.Screen name="login" />
        <Stack.Screen name="forgot" />
      </Stack.Protected>
      <Stack.Protected guard={status === 'needsCompany'}>
        <Stack.Screen name="company" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: (count, err) =>
              !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
          },
        },
      }),
  );
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={client}>
        <PrefsProvider>
          <AuthProvider>
            <WorkspaceProvider>
              <StatusBar style="auto" />
              <Gate />
            </WorkspaceProvider>
          </AuthProvider>
        </PrefsProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
