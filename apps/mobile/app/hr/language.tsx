import { Pressable, Text, View } from 'react-native';
import { Icon } from '@/components/icons';
import { Banner, Card, Screen, Body } from '@/components/ui';
import { LANGUAGES } from '@/i18n';
import { usePrefs } from '@/prefs';
import { useTheme } from '@/theme';

export default function Language() {
  const t = useTheme();
  const { t: tr, lang, setLang } = usePrefs();
  return (
    <Screen underHeader>
      <Body muted>{tr('lang.subtitle')}</Body>
      <Card>
        {LANGUAGES.map((l, i) => (
          <Pressable
            key={l.code}
            onPress={() => setLang(l.code)}
            accessibilityRole="radio"
            accessibilityState={{ selected: lang === l.code }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingVertical: 14,
              borderTopWidth: i ? 1 : 0,
              borderColor: t.border,
            }}
          >
            <View>
              <Text style={{ color: t.text, fontSize: 17, fontWeight: '700' }}>{l.native}</Text>
              <Text style={{ color: t.muted, fontSize: 13 }}>{l.label}</Text>
            </View>
            {lang === l.code ? <Icon name="check" color={t.primary} size={22} /> : null}
          </Pressable>
        ))}
      </Card>
      <Banner tone="info">{tr('lang.note')}</Banner>
    </Screen>
  );
}
