/** Validates the configured API base URL. Plain http is allowed only in development builds. */
export function resolveApiUrl(raw: string | undefined, isDev: boolean): string {
  const value = (raw ?? '').trim().replace(/\/+$/, '');
  if (!value)
    throw new Error('EXPO_PUBLIC_API_URL is not set. Copy apps/mobile/.env.example to .env.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`EXPO_PUBLIC_API_URL is not a valid URL: ${value}`);
  }
  if (url.protocol !== 'https:' && !(isDev && url.protocol === 'http:'))
    throw new Error(
      'Release builds must use an https:// API URL (plain http is for development only).',
    );
  return value;
}
