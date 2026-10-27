import { Tabs } from 'expo-router';
import { useAuth } from '@/auth/AuthProvider';
import { Icon, type IconName } from '@/components/icons';
import { canSeeTeam } from '@/lib/roles';
import { useT } from '@/prefs';
import { useTheme } from '@/theme';

const TAB_ICON: Record<string, IconName> = {
  index: 'clock',
  history: 'calendar',
  requests: 'inbox',
  team: 'team',
  more: 'grid',
};

export default function TabsLayout() {
  const t = useTheme();
  const tr = useT();
  const { active } = useAuth();
  const showTeam = canSeeTeam(active?.roles);
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.muted,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '700' },
        tabBarStyle: {
          backgroundColor: t.card,
          borderTopColor: t.border,
          paddingTop: 6,
          height: 64,
        },
        tabBarIcon: ({ color }) => (
          <Icon name={TAB_ICON[route.name] ?? 'info'} color={color} size={22} />
        ),
      })}
    >
      <Tabs.Screen name="index" options={{ title: tr('tab.today') }} />
      <Tabs.Screen name="history" options={{ title: tr('tab.attendance') }} />
      <Tabs.Screen name="requests" options={{ title: tr('tab.requests') }} />
      {/* Hidden (not just disabled) for people who are not managers/HR/owners. The API enforces scope. */}
      <Tabs.Screen
        name="team"
        options={{ title: tr('tab.team'), href: showTeam ? undefined : null }}
      />
      <Tabs.Screen name="more" options={{ title: tr('tab.more') }} />
    </Tabs>
  );
}
