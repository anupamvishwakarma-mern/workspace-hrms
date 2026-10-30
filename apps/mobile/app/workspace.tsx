import { useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { useAuth } from '@/auth/AuthProvider';
import { AuthShell } from '@/components/auth-ui';
import { Badge, Button, Card } from '@/components/ui';
import { useMyEmployee } from '@/hooks/queries';
import { ROLE_LABEL } from '@/nav/config';
import { NavIcon } from '@/nav/icons';
import { useTheme } from '@/theme';
import { useFirstRun, useView } from '@/workspace';

/** For people with two hats: a manager, HR or owner who also has their own employee record. */
export default function ChooseWorkspace() {
  const t = useTheme();
  const { signOut } = useAuth();
  const { base } = useView();
  const { choose } = useFirstRun();
  const me = useMyEmployee();
  const [pick, setPick] = useState<'work' | 'self'>('work');
  const [remember, setRemember] = useState(false);
  const first = me.data?.firstName;

  const card = (key: 'work' | 'self', title: string, sub: string, last?: boolean) => {
    const on = pick === key;
    return (
      <Pressable
        onPress={() => setPick(key)}
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}
        accessibilityLabel={`${title}. ${sub}`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          padding: 16,
          minHeight: 72,
          borderRadius: 18,
          borderWidth: 2,
          borderColor: on ? t.primary : t.border,
          backgroundColor: on ? t.accent : t.card,
        }}
      >
        <NavIcon
          name={key === 'work' ? 'team' : 'user'}
          color={on ? t.primary : t.muted}
          size={24}
        />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Text style={{ color: t.text, fontWeight: '800', fontSize: 17 }}>{title}</Text>
            {last ? <Badge label="Last used" tone="neutral" /> : null}
          </View>
          <Text style={{ color: t.muted, fontSize: 14 }}>{sub}</Text>
        </View>
      </Pressable>
    );
  };

  return (
    <AuthShell
      title={first ? `Hi ${first}, where to?` : 'Where to?'}
      subtitle="You can switch any time from the menu."
    >
      {card('work', `${ROLE_LABEL[base]} workspace`, 'Approvals, team and company reports')}
      {card('self', 'My workspace', 'Punch, leave, pay and profile')}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 }}>
        <Switch
          value={remember}
          onValueChange={setRemember}
          accessibilityLabel="Remember my choice on this phone"
          trackColor={{ true: t.primary }}
        />
        <Text style={{ color: t.text, fontSize: 15, flex: 1 }}>
          Remember my choice on this phone
        </Text>
      </View>
      <Button
        title={pick === 'work' ? `Open ${ROLE_LABEL[base]} workspace` : 'Open my workspace'}
        onPress={() => choose(pick === 'self', remember)}
        size="lg"
      />
      <Button title="Sign out" variant="ghost" onPress={() => void signOut()} />
    </AuthShell>
  );
}
