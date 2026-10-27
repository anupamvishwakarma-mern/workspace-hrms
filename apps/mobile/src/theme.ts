import { useColorScheme } from 'react-native';
import { usePrefs } from '@/prefs';

/** Matches the web design system (teal brand, soft slate neutrals). */
const light = {
  bg: '#f5f7fa',
  card: '#ffffff',
  subtle: '#f1f5f9',
  text: '#0f172a',
  muted: '#64748b',
  border: '#e2e8f0',
  primary: '#0f766e',
  primaryPressed: '#115e59',
  primaryText: '#ffffff',
  accent: '#f0fdfa',
  danger: '#be123c',
  dangerBg: '#fff1f2',
  success: '#047857',
  successBg: '#ecfdf5',
  warn: '#b45309',
  warnBg: '#fffbeb',
  info: '#0369a1',
  infoBg: '#f0f9ff',
  shadow: '#0f172a',
};
const dark: typeof light = {
  bg: '#0a1014',
  card: '#111a20',
  subtle: '#18232b',
  text: '#f1f5f9',
  muted: '#94a3b8',
  border: '#22313b',
  primary: '#2dd4bf',
  primaryPressed: '#5eead4',
  primaryText: '#042f2e',
  accent: '#0b2a2a',
  danger: '#fb7185',
  dangerBg: '#2f1119',
  success: '#34d399',
  successBg: '#0a2a1f',
  warn: '#fbbf24',
  warnBg: '#2e220a',
  info: '#38bdf8',
  infoBg: '#0b2436',
  shadow: '#000000',
};
export type Theme = typeof light;
export const useIsDark = (): boolean => {
  const system = useColorScheme();
  const { scheme } = usePrefs();
  return scheme === 'system' ? system === 'dark' : scheme === 'dark';
};
export const useTheme = (): Theme => (useIsDark() ? dark : light);

export const radius = { sm: 10, md: 14, lg: 20, pill: 999 } as const;
