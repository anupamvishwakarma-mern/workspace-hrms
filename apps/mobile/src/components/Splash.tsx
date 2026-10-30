import * as Application from 'expo-application';
import { ActivityIndicator, Text, View } from 'react-native';

/** Shown while the saved session is restored. Always dark, like the launch screen. */
export function Splash() {
  return (
    <View
      accessibilityLabel="Getting your workspace ready"
      style={{
        flex: 1,
        backgroundColor: '#0b1f1e',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
      }}
    >
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 22,
          backgroundColor: '#2dd4bf',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: '#042f2e', fontSize: 34, fontWeight: '800' }}>W</Text>
      </View>
      <Text style={{ color: '#f1f5f9', fontSize: 26, fontWeight: '800' }}>Workforce HRMS</Text>
      <ActivityIndicator color="#2dd4bf" />
      <Text style={{ color: '#94a3b8', fontSize: 14 }}>Getting your workspace ready</Text>
      <Text style={{ color: '#64748b', fontSize: 12, position: 'absolute', bottom: 36 }}>
        Version {Application.nativeApplicationVersion ?? '0.1.0'}
      </Text>
    </View>
  );
}
