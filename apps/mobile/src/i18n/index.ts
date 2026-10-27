import { en, type Key } from './en';
import { hi } from './hi';

export const LANGUAGES = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
] as const;
export type Lang = (typeof LANGUAGES)[number]['code'];
export const DICTIONARIES: Record<Lang, Record<Key, string>> = { en, hi };
export type { Key };

export const isLang = (v: unknown): v is Lang => LANGUAGES.some((l) => l.code === v);

/** "Hello {name}" + { name: 'Asha' } -> "Hello Asha". Unknown placeholders are left visible so gaps are noticed. */
export function translate(lang: Lang, key: Key, vars?: Record<string, string | number>): string {
  const raw = DICTIONARIES[lang][key] ?? en[key];
  return vars ? raw.replace(/\{(\w+)\}/g, (m, k: string) => String(vars[k] ?? m)) : raw;
}

/** Best starting language from the phone's locale (e.g. "hi-IN" -> hi), defaulting to English. */
export function languageFromLocale(locale: string | undefined): Lang {
  const base = (locale ?? '').toLowerCase().split(/[-_]/)[0];
  return isLang(base) ? base : 'en';
}
