import type { EventType } from './schemas';

/**
 * Idempotency for punches. If a request times out we cannot know whether the server recorded it,
 * so a retry of the SAME action within a short window reuses the SAME key; the server then returns
 * the original event instead of creating a duplicate. Definitive answers (success or a 4xx) clear it.
 */
export interface PendingPunch {
  action: EventType;
  key: string;
  createdAt: number;
}
export interface PendingStore {
  get(): Promise<string | null>;
  set(v: string): Promise<void>;
  clear(): Promise<void>;
}

export const PENDING_TTL_MS = 10 * 60_000;
export const KEY_RE = /^[A-Za-z0-9_-]{8,100}$/;

export async function keyForPunch(
  store: PendingStore,
  action: EventType,
  now: number,
  makeKey: () => string,
): Promise<string> {
  try {
    const raw = await store.get();
    if (raw) {
      const p = JSON.parse(raw) as Partial<PendingPunch>;
      if (
        p.action === action &&
        typeof p.key === 'string' &&
        KEY_RE.test(p.key) &&
        typeof p.createdAt === 'number' &&
        now - p.createdAt < PENDING_TTL_MS &&
        now >= p.createdAt
      )
        return p.key;
    }
  } catch {
    /* corrupt entry: fall through and mint a new key */
  }
  const key = makeKey();
  const entry: PendingPunch = { action, key, createdAt: now };
  await store.set(JSON.stringify(entry)).catch(() => undefined);
  return key;
}

export const clearPending = (store: PendingStore) => store.clear().catch(() => undefined);
