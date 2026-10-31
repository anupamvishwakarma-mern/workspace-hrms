/**
 * Sliding-window limiter, in memory. Good protection for a single instance; with several instances each keeps its
 * own counters, so put an edge/WAF limit in front for real abuse protection (documented in docs/MARKETING_SITE.md).
 */
const hits = new Map<string, number[]>();
let lastSweep = 0;

export function rateLimit(
  key: string,
  max: number,
  windowMs: number,
  now = Date.now(),
): { ok: boolean; retryAfterSec: number } {
  if (now - lastSweep > 60_000) {
    lastSweep = now;
    for (const [k, v] of hits)
      if (!v.length || now - v[v.length - 1]! > windowMs * 2) hits.delete(k);
  }
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - recent[0]!)) / 1000)),
    };
  }
  recent.push(now);
  hits.set(key, recent);
  return { ok: true, retryAfterSec: 0 };
}
export const resetRateLimits = () => hits.clear();
