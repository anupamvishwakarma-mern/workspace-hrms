import * as SecureStore from 'expo-secure-store';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getLocales } from 'expo-localization';
import { isLang, languageFromLocale, translate, type Key, type Lang } from '@/i18n';

export type Scheme = 'system' | 'light' | 'dark';
const LANG_KEY = 'wf.lang';
const SCHEME_KEY = 'wf.scheme';

interface Prefs {
  lang: Lang;
  scheme: Scheme;
  setLang(l: Lang): void;
  setScheme(s: Scheme): void;
  t(key: Key, vars?: Record<string, string | number>): string;
}
const Ctx = createContext<Prefs | null>(null);

/** Language and appearance choices, remembered on the phone (not secrets, never sent to the server). */
export function PrefsProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() =>
    languageFromLocale(getLocales()[0]?.languageCode ?? undefined),
  );
  const [scheme, setSchemeState] = useState<Scheme>('system');

  useEffect(() => {
    void (async () => {
      try {
        const [l, s] = await Promise.all([
          SecureStore.getItemAsync(LANG_KEY),
          SecureStore.getItemAsync(SCHEME_KEY),
        ]);
        if (isLang(l)) setLangState(l);
        if (s === 'light' || s === 'dark' || s === 'system') setSchemeState(s);
      } catch {
        /* storage unavailable: keep defaults */
      }
    })();
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    void SecureStore.setItemAsync(LANG_KEY, l).catch(() => undefined);
  }, []);
  const setScheme = useCallback((s: Scheme) => {
    setSchemeState(s);
    void SecureStore.setItemAsync(SCHEME_KEY, s).catch(() => undefined);
  }, []);
  const value = useMemo<Prefs>(
    () => ({ lang, scheme, setLang, setScheme, t: (k, v) => translate(lang, k, v) }),
    [lang, scheme, setLang, setScheme],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const fallback: Prefs = {
  lang: 'en',
  scheme: 'system',
  setLang: () => undefined,
  setScheme: () => undefined,
  t: (k, v) => translate('en', k, v),
};
export const usePrefs = (): Prefs => useContext(Ctx) ?? fallback;
export const useT = () => usePrefs().t;
