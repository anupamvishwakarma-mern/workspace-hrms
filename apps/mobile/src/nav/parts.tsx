import { Pressable, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import { badgeText } from './config';

/** Count pill for things that need action. Hidden at zero, "99+" above 99. */
export function CountBadge({ n, tone = 'danger' }: { n: number; tone?: 'danger' | 'primary' }) {
  const t = useTheme();
  if (n <= 0) return null;
  return (
    <View
      accessibilityLabel={`${n} waiting`}
      style={{
        minWidth: 20,
        height: 20,
        paddingHorizontal: 5,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: tone === 'danger' ? t.danger : t.primary,
      }}
    >
      <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>{badgeText(n)}</Text>
    </View>
  );
}

/** 48px tap target. */
export function IconButton({
  children,
  label,
  onPress,
}: {
  children: React.ReactNode;
  label: string;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? t.subtle : 'transparent',
      })}
    >
      {children}
    </Pressable>
  );
}
