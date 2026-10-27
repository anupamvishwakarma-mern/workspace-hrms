import Constants from 'expo-constants';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { useAuth } from '@/auth/AuthProvider';
import { Avatar, Badge, Body, Button, Card, Eyebrow, PageHeader, Screen } from '@/components/ui';

export default function Profile() {
  const { active, memberships, selectCompany, signOut, email } = useAuth();
  return (
    <Screen>
      <PageHeader title="Profile" />
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Avatar name={email ?? active?.tenantName ?? '?'} size={56} />
          <View style={{ flex: 1, gap: 2 }}>
            <Body bold>{email ?? 'Signed in'}</Body>
            <Body muted small>
              {active?.tenantName ?? 'Company'}
            </Body>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {active?.roles.map((r) => (
            <Badge key={r} label={r.replace('_', ' ')} tone="neutral" />
          ))}
        </View>
        <Body muted small>
          Roles shown here are informational. What you can do is decided by the server.
        </Body>
      </Card>

      {memberships.length > 1 ? (
        <Card>
          <Eyebrow>Switch company</Eyebrow>
          {memberships.map((m) => (
            <Pressable
              key={m.tenantId}
              disabled={m.tenantId === active?.tenantId}
              onPress={() => void selectCompany(m.tenantId)}
              accessibilityRole="button"
              accessibilityLabel={`Switch to ${m.tenantName ?? 'company'}`}
              style={{
                paddingVertical: 12,
                borderTopWidth: StyleSheet.hairlineWidth,
                borderColor: '#94a3b833',
              }}
            >
              <Body bold={m.tenantId === active?.tenantId}>
                {m.tenantName ?? m.tenantId}
                {m.tenantId === active?.tenantId ? ' (current)' : ''}
              </Body>
            </Pressable>
          ))}
        </Card>
      ) : null}

      <Card>
        <Eyebrow>Your location and privacy</Eyebrow>
        <Body small muted>
          This app reads your location once, only when you check in, check out or start/end a break,
          to verify you are at your work location. It never tracks you in the background. Location
          is a signal reviewed together with other information; it does not by itself prove where
          you were.
        </Body>
      </Card>

      <Button
        title="Sign out"
        variant="secondary"
        onPress={() =>
          Alert.alert('Sign out?', 'You will need to sign in again.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
          ])
        }
      />
      <Body muted small>
        Version {Constants.expoConfig?.version ?? '0.1.0'}
      </Body>
    </Screen>
  );
}
