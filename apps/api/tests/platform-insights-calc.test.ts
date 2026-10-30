import { describe, expect, it } from 'vitest';
import { signupsByMonth } from '../src/modules/platform/platform.insights';

describe('signupsByMonth', () => {
  it('buckets by month, oldest first, ignoring older companies', () => {
    const now = new Date('2026-10-30T10:00:00Z');
    const out = signupsByMonth(
      [new Date('2026-10-01T00:00:00Z'), new Date('2026-10-29T00:00:00Z'), new Date('2026-08-15T00:00:00Z'), new Date('2025-01-01T00:00:00Z')],
      now,
      4,
    );
    expect(out).toEqual([
      { month: '2026-07', count: 0 },
      { month: '2026-08', count: 1 },
      { month: '2026-09', count: 0 },
      { month: '2026-10', count: 2 },
    ]);
  });
  it('crosses a year boundary', () => {
    expect(signupsByMonth([], new Date('2026-02-10T00:00:00Z'), 3).map((m) => m.month)).toEqual(['2025-12', '2026-01', '2026-02']);
  });
});
