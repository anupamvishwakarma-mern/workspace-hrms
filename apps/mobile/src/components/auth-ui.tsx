import { useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';

/** Plain page for sign-in screens: logo, title, subtitle, then the content. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const t = useTheme();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: 24, gap: 18, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ gap: 12, paddingTop: 24 }}>
            <View
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={{
                width: 56,
                height: 56,
                borderRadius: 18,
                backgroundColor: t.primary,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: t.primaryText, fontSize: 26, fontWeight: '800' }}>W</Text>
            </View>
            <Text
              accessibilityRole="header"
              style={{ color: t.text, fontSize: 28, fontWeight: '800' }}
            >
              {title}
            </Text>
            {subtitle ? (
              <Text style={{ color: t.muted, fontSize: 16, lineHeight: 22 }}>{subtitle}</Text>
            ) : null}
          </View>
          <View style={{ gap: 16 }}>{children}</View>
          <View style={{ flex: 1 }} />
          {footer}
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

/** Text field with a red border and message when invalid, and an optional action on the right (Show/Hide). */
export function AuthField({
  label,
  invalid,
  message,
  right,
  ...rest
}: TextInputProps & { label: string; invalid?: boolean; message?: string; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: t.text, fontWeight: '600', fontSize: 14 }}>{label}</Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 52,
          borderRadius: 14,
          borderWidth: 1.5,
          paddingHorizontal: 14,
          backgroundColor: invalid ? t.dangerBg : t.subtle,
          borderColor: invalid ? t.danger : t.border,
        }}
      >
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={t.muted}
          selectionColor={t.primary}
          {...rest}
          style={{ flex: 1, color: t.text, fontSize: 16, paddingVertical: 12 }}
        />
        {right}
      </View>
      {message ? <Text style={{ color: t.danger, fontSize: 13 }}>{message}</Text> : null}
    </View>
  );
}

export function PasswordField(
  props: TextInputProps & { label: string; invalid?: boolean; message?: string },
) {
  const t = useTheme();
  const [shown, setShown] = useState(false);
  return (
    <AuthField
      {...props}
      secureTextEntry={!shown}
      autoCapitalize="none"
      autoCorrect={false}
      right={
        <Pressable
          onPress={() => setShown((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={shown ? 'Hide password' : 'Show password'}
          hitSlop={10}
          style={{ minHeight: 44, justifyContent: 'center', paddingLeft: 8 }}
        >
          <Text style={{ color: t.primary, fontWeight: '700' }}>{shown ? 'Hide' : 'Show'}</Text>
        </Pressable>
      }
    />
  );
}

export function TextLink({ title, onPress }: { title: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      style={{ minHeight: 44, justifyContent: 'center' }}
    >
      <Text style={{ color: t.primary, fontWeight: '700', fontSize: 15 }}>{title}</Text>
    </Pressable>
  );
}
