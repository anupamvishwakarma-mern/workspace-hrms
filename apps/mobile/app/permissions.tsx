import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { AuthShell } from '@/components/auth-ui';
import { Badge, Button, Card } from '@/components/ui';
import { NavIcon, type NavIconName } from '@/nav/icons';
import { useTheme } from '@/theme';
import { useFirstRun } from '@/workspace';

type Perm = 'location' | 'camera';
const ROWS: { key: Perm; icon: NavIconName; title: string; why: string; tag: string }[] = [
  {
    key: 'location',
    icon: 'pin',
    title: 'Location',
    why: 'Confirms you are at your work place when you punch in or out.',
    tag: 'Recommended',
  },
  {
    key: 'camera',
    icon: 'camera',
    title: 'Camera',
    why: 'Only for the photo some companies ask for when you punch.',
    tag: 'Optional',
  },
];

/** Shown once after the first sign-in on this phone. Everything here can be changed later in system settings. */
export default function Permissions() {
  const t = useTheme();
  const { markPermsSeen } = useFirstRun();
  const [granted, setGranted] = useState<Record<Perm, boolean>>({ location: false, camera: false });

  useEffect(() => {
    void (async () => {
      try {
        const [l, c] = await Promise.all([
          Location.getForegroundPermissionsAsync(),
          ImagePicker.getCameraPermissionsAsync(),
        ]);
        setGranted({ location: l.granted, camera: c.granted });
      } catch {
        /* unknown: leave both as not allowed */
      }
    })();
  }, []);

  const allow = async (k: Perm) => {
    try {
      const r =
        k === 'location'
          ? await Location.requestForegroundPermissionsAsync()
          : await ImagePicker.requestCameraPermissionsAsync();
      setGranted((g) => ({ ...g, [k]: r.granted }));
    } catch {
      /* the system dialog failed; the person can allow it later in settings */
    }
  };
  const any = granted.location || granted.camera;

  return (
    <AuthShell
      title="Allow what you need"
      subtitle="These let punching in work properly. You can change them any time in your phone's settings."
    >
      {ROWS.map((r) => (
        <Card key={r.key}>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                backgroundColor: t.accent,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <NavIcon name={r.icon} color={t.primary} size={22} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Text style={{ color: t.text, fontWeight: '800', fontSize: 16 }}>{r.title}</Text>
                <Badge label={r.tag} tone={r.tag === 'Recommended' ? 'info' : 'neutral'} />
              </View>
              <Text style={{ color: t.muted, fontSize: 13, lineHeight: 18 }}>{r.why}</Text>
            </View>
          </View>
          {granted[r.key] ? (
            <Badge label="Allowed" tone="success" />
          ) : (
            <Button title="Allow" variant="secondary" onPress={() => void allow(r.key)} />
          )}
        </Card>
      ))}
      <Button
        title={any ? 'Continue' : 'Skip for now'}
        onPress={markPermsSeen}
        size="lg"
        variant={any ? 'primary' : 'secondary'}
      />
    </AuthShell>
  );
}
