import { describe, expect, it } from 'vitest';
import { monthlyCredit } from '../src/modules/leave/ledger.service';

describe('monthly accrual schedule', () => {
  it.each([12, 15, 10, 7.5, 21, 0.5, 366])('twelve credits add up to exactly %s days', (allowance) => {
    let total = 0;
    for (let m = 1; m <= 12; m++) {
      const c = monthlyCredit(allowance, m);
      expect(c * 2).toBe(Math.round(c * 2)); // half-day steps only
      expect(c).toBeGreaterThanOrEqual(0);
      total += c;
    }
    expect(total).toBe(allowance);
  });

  it('is a flat share when the allowance divides evenly', () => {
    expect([1, 2, 3, 12].map((m) => monthlyCredit(12, m))).toEqual([1, 1, 1, 1]);
  });
});
