import { useRouter, type Href } from 'expo-router';
import { View } from 'react-native';
import { useAuth } from '@/auth/AuthProvider';
import { Avatar, Body, Card, Eyebrow, PageHeader, Screen } from '@/components/ui';
import { Divider, NavRow } from '@/components/state';
import type { IconName } from '@/components/icons';
import type { Key } from '@/i18n';
import { useT } from '@/prefs';
import MeExtras from '@/views/MeExtras';

interface Item {
  icon: IconName;
  label: Key;
  href: Href;
}
const SECTIONS: { title: Key; items: Item[] }[] = [
  {
    title: 'more.section.me',
    items: [
      { icon: 'user', label: 'page.profile', href: '/hr/profile' },
      { icon: 'leaf', label: 'page.leave', href: '/hr/leave' },
      { icon: 'calendar', label: 'page.holidays', href: '/hr/holidays' },
    ],
  },
  {
    title: 'more.section.pay',
    items: [
      { icon: 'wallet', label: 'page.salary', href: '/hr/salary' },
      { icon: 'doc', label: 'page.payslips', href: '/hr/payslips' },
      { icon: 'doc', label: 'page.letters', href: '/hr/letters' },
      { icon: 'book', label: 'page.handbook', href: '/hr/handbook' },
    ],
  },
  {
    title: 'more.section.app',
    items: [
      { icon: 'globe', label: 'page.language', href: '/hr/language' },
      { icon: 'gear', label: 'page.settings', href: '/hr/settings' },
    ],
  },
];

export default function More() {
  const router = useRouter();
  const t = useT();
  const { active, email } = useAuth();
  return (
    <Screen>
      <PageHeader title={t('more.title')} subtitle={t('more.subtitle')} />
      <Card tone="accent">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Avatar name={email ?? active?.tenantName ?? '?'} size={48} />
          <View style={{ flex: 1 }}>
            <Body bold>{email ?? ''}</Body>
            <Body muted small>
              {active?.tenantName ?? ''}
            </Body>
          </View>
        </View>
      </Card>
      <MeExtras />
      {SECTIONS.map((sec) => (
        <Card key={sec.title}>
          <Eyebrow>{t(sec.title)}</Eyebrow>
          {sec.items.map((it, i) => (
            <View key={it.label}>
              {i > 0 ? <Divider /> : null}
              <NavRow icon={it.icon} label={t(it.label)} onPress={() => router.push(it.href)} />
            </View>
          ))}
        </Card>
      ))}
    </Screen>
  );
}
