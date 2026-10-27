import { Stack } from 'expo-router';
import { useT } from '@/prefs';
import { useTheme } from '@/theme';
import type { Key } from '@/i18n';

const SCREENS: [string, Key][] = [
  ['holidays', 'page.holidays'],
  ['leave', 'page.leave'],
  ['leave-apply', 'page.leaveApply'],
  ['letters', 'page.letters'],
  ['letter', 'page.letter'],
  ['profile', 'page.profile'],
  ['salary', 'page.salary'],
  ['payslips', 'page.payslips'],
  ['payslip', 'page.payslip'],
  ['language', 'page.language'],
  ['settings', 'page.settings'],
  ['handbook', 'page.handbook'],
];

/** Secondary pages opened from the More tab. Each gets a native back button and a translated title. */
export default function HrLayout() {
  const t = useTheme();
  const tr = useT();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.card },
        headerTintColor: t.primary,
        headerTitleStyle: { color: t.text, fontWeight: '700' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: t.bg },
      }}
    >
      {SCREENS.map(([name, key]) => (
        <Stack.Screen key={name} name={name} options={{ title: tr(key) }} />
      ))}
    </Stack>
  );
}
