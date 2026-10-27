import { describe, expect, it } from 'vitest';
import {
  KEY_RE,
  PENDING_TTL_MS,
  clearPending,
  keyForPunch,
  type PendingStore,
} from '../src/lib/punch';

function store(): PendingStore & { v: string | null } {
  const s = {
    v: null as string | null,
    get: async () => s.v,
    set: async (x: string) => void (s.v = x),
    clear: async () => void (s.v = null),
  };
  return s;
}
let n = 0;
const mk = () => `wf-key-${++n}-abcdefgh`;

describe('punch idempotency keys', () => {
  it('reuses the same key when the same action is retried after an ambiguous failure', async () => {
    const s = store();
    const a = await keyForPunch(s, 'CHECK_IN', 1000, mk);
    const b = await keyForPunch(s, 'CHECK_IN', 5000, mk);
    expect(b).toBe(a);
  });
  it('mints a new key for a different action, after the TTL, or after a definitive answer', async () => {
    const s = store();
    const a = await keyForPunch(s, 'CHECK_IN', 1000, mk);
    expect(await keyForPunch(s, 'CHECK_OUT', 2000, mk)).not.toBe(a);
    const c = await keyForPunch(s, 'CHECK_OUT', 3000, mk);
    expect(await keyForPunch(s, 'CHECK_OUT', 3000 + PENDING_TTL_MS + 1, mk)).not.toBe(c);
    const d = await keyForPunch(s, 'BREAK_START', 9000, mk);
    await clearPending(s);
    expect(await keyForPunch(s, 'BREAK_START', 9001, mk)).not.toBe(d);
  });
  it('survives a corrupt stored value and always produces a server-valid key', async () => {
    const s = store();
    s.v = '{not json';
    const k = await keyForPunch(s, 'CHECK_IN', 1, mk);
    expect(KEY_RE.test(k)).toBe(true);
    s.v = JSON.stringify({ action: 'CHECK_IN', key: 'bad key!', createdAt: 1 });
    expect(KEY_RE.test(await keyForPunch(s, 'CHECK_IN', 2, mk))).toBe(true);
  });
  it('does not trust a stored timestamp from the future', async () => {
    const s = store();
    s.v = JSON.stringify({ action: 'CHECK_IN', key: 'future-key-12345', createdAt: 10_000 });
    expect(await keyForPunch(s, 'CHECK_IN', 5_000, mk)).not.toBe('future-key-12345');
  });
});
