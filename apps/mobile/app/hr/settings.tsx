import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useAuth } from '@/auth/AuthProvider';
import { KV, NavRow } from '@/components/state';
import { SignOutButton } from '@/components/SignOutButton';
import { Body, Card, Eyebrow, Screen, Segmented } from '@/components/ui';
import { LANGUAGES } from '@/i18n';
import { usePrefs } from '@/prefs';

export default function Settings() {
  const { t: tr, scheme, setScheme, lang } = usePrefs();
  const router = useRouter();
  const { active, email } = useAuth();
  return (
    <Screen underHeader>
      <Card>
        <Eyebrow>{tr('set.appearance')}</Eyebrow>
        <Segmented
          value={scheme}
          onChange={setScheme}
          options={[
            { key: 'system', label: tr('set.system') },
            { key: 'light', label: tr('set.light') },
            { key: 'dark', label: tr('set.dark') },
          ]}
        />
      </Card>
      <Card>
        <Eyebrow>{tr('set.language')}</Eyebrow>
        <NavRow
          icon="globe"
          label={LANGUAGES.find((l) => l.code === lang)?.native ?? lang}
          onPress={() => router.push('/hr/language')}
        />
      </Card>
      <Card>
        <Eyebrow>{tr('set.account')}</Eyebrow>
        <KV label={tr('pro.email')} value={email ?? '—'} />
        <KV label={tr('set.company')} value={active?.tenantName ?? '—'} />
        <SignOutButton />
      </Card>
      <Card>
        <Eyebrow>{tr('set.about')}</Eyebrow>
        <Body muted small>
          {tr('common.version', { v: Constants.expoConfig?.version ?? '0.1.0' })}
        </Body>
      </Card>
    </Screen>
  );
}
