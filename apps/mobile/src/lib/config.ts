import { resolveApiUrl } from './url';

declare const __DEV__: boolean;

/** Resolved once at startup; throws a clear error for a missing or insecure URL. */
export const API_URL = resolveApiUrl(process.env.EXPO_PUBLIC_API_URL, __DEV__);
