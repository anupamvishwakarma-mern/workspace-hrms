import { Alert } from 'react-native';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui';
import { useT } from '@/prefs';

export function SignOutButton() {
  const { signOut } = useAuth();
  const t = useT();
  return (
    <Button
      title={t('common.signOut')}
      variant="secondary"
      onPress={() =>
        Alert.alert(t('common.signOutTitle'), t('common.signOutBody'), [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('common.signOut'), style: 'destructive', onPress: () => void signOut() },
        ])
      }
    />
  );
}
