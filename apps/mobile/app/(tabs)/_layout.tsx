import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { UnderHeaderContext } from '@/components/ui';
import { useAuth } from '@/auth/AuthProvider';
import { canSeeTeam } from '@/lib/roles';
import { AppBar } from '@/nav/AppBar';
import { Drawer } from '@/nav/Drawer';
import { FooterNav } from '@/nav/FooterNav';
import { NavProvider } from '@/nav/state';
import { useT } from '@/prefs';

export default function TabsLayout() {
  const tr = useT();
  const { active } = useAuth();
  const showTeam = canSeeTeam(active?.roles);
  return (
    <NavProvider>
      <UnderHeaderContext.Provider value>
        <View style={{ flex: 1 }}>
          <Tabs
            tabBar={() => <FooterNav />}
            screenOptions={{ header: () => <AppBar />, headerShown: true }}
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
          <Drawer />
        </View>
      </UnderHeaderContext.Provider>
    </NavProvider>
  );
}
