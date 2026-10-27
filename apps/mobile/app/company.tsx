import { Pressable } from 'react-native';
import { useAuth } from '@/auth/AuthProvider';
import { View } from 'react-native';
import { Avatar, Body, Button, Card, PageHeader, Screen } from '@/components/ui';
import { useT } from '@/prefs';

export default function Company() {
  const tr = useT();
  const { memberships, selectCompany, signOut } = useAuth();
  return (
    <Screen>
      <PageHeader title={tr('company.title')} subtitle={tr('company.subtitle')} />
      {memberships.map((m) => (
        <Pressable
          key={m.tenantId}
          onPress={() => void selectCompany(m.tenantId)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${m.tenantName ?? 'company'}`}
        >
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Avatar name={m.tenantName ?? m.tenantSlug ?? m.tenantId} />
              <View style={{ flex: 1, gap: 2 }}>
                <Body bold>{m.tenantName ?? m.tenantSlug ?? m.tenantId}</Body>
                <Body muted small>
                  {m.roles.join(', ')}
                </Body>
              </View>
            </View>
          </Card>
        </Pressable>
      ))}
      <Button title={tr('common.signOut')} variant="secondary" onPress={() => void signOut()} />
    </Screen>
  );
}
