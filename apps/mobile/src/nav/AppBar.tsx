import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { canSeeTeam } from '@/lib/roles';
import { useAuth } from '@/auth/AuthProvider';
import { useTheme } from '@/theme';
import { useView } from '@/workspace';
import { TAB_TITLE } from './config';
import { NavIcon } from './icons';
import { CountBadge, IconButton } from './parts';
import { tabHref, useCurrentTab, useNav, useNavCounts } from './state';

/** Menu on the left, the screen title, then search (people) and the bell (things waiting for you). */
export function AppBar() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { setOpen } = useNav();
  const { view } = useView();
  const { active } = useAuth();
  const tab = useCurrentTab();
  const { total } = useNavCounts();
  const canSearch = canSeeTeam(active?.roles) && view !== 'employee';
  return (
    <View
      style={{
        paddingTop: insets.top,
        backgroundColor: t.card,
        borderBottomWidth: 1,
        borderBottomColor: t.border,
      }}
    >
      <View
        style={{ height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 }}
      >
        <IconButton label="Open menu" onPress={() => setOpen(true)}>
          <NavIcon name="menu" color={t.text} size={24} />
        </IconButton>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={{ flex: 1, color: t.text, fontSize: 20, fontWeight: '800', marginLeft: 4 }}
        >
          {TAB_TITLE[view][tab]}
        </Text>
        {canSearch ? (
          <IconButton label="Search people" onPress={() => router.navigate(tabHref('team'))}>
            <NavIcon name="search" color={t.text} size={22} />
          </IconButton>
        ) : null}
        <IconButton
          label={total > 0 ? `Notifications, ${total} waiting` : 'Notifications'}
          onPress={() => router.navigate(tabHref('requests'))}
        >
          <NavIcon name="bell" color={t.text} size={22} />
          {total > 0 ? (
            <View style={{ position: 'absolute', top: 6, right: 4 }}>
              <CountBadge n={total} />
            </View>
          ) : null}
        </IconButton>
      </View>
    </View>
  );
}
