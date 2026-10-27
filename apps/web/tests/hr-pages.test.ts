import { describe, expect, it } from 'vitest';
import { DICTIONARIES, LANGUAGES, en } from '../src/lib/i18n';
import { componentAmountMinor, formatMoney } from '../src/lib/money';

describe('web i18n', () => {
  it('every language has exactly the English keys, none empty', () => {
    for (const l of LANGUAGES) {
      const d = DICTIONARIES[l.code];
      expect(Object.keys(d).sort(), l.code).toEqual(Object.keys(en).sort());
      for (const [k, v] of Object.entries(d)) expect(v.trim(), `${l.code}:${k}`).not.toBe('');
    }
  });
});

describe('money', () => {
  it('formats minor units', () => {
    expect(formatMoney(4400000, 'INR')).toBe('₹44,000.00');
    expect(formatMoney(123456789, 'INR')).toBe('₹12,34,567.89');
    expect(formatMoney(-100, 'USD')).toBe('-$1.00');
  });
  it('percent of basic matches the server rule (value = percent x 100)', () => {
    expect(
      componentAmountMinor({ code: 'HRA', calc: 'PERCENT_OF_BASIC', value: 4000 }, 5000000),
    ).toBe(2000000);
  });
});
