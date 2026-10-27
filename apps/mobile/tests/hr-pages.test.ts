import { describe, expect, it } from 'vitest';
import { DICTIONARIES, LANGUAGES, languageFromLocale, translate } from '../src/i18n';
import { en } from '../src/i18n/en';
import { monthBounds, monthGrid, monthTitle, shiftMonth } from '../src/lib/calendar';
import { parseHandbook } from '../src/lib/handbook';
import { componentAmountMinor, formatMoney } from '../src/lib/money';
import { canSeeTeam, seesEveryone } from '../src/lib/roles';

describe('i18n', () => {
  it('every language has exactly the English keys and no empty strings', () => {
    for (const l of LANGUAGES) {
      const d = DICTIONARIES[l.code];
      expect(Object.keys(d).sort(), l.code).toEqual(Object.keys(en).sort());
      for (const [k, v] of Object.entries(d)) expect(v.trim(), `${l.code}:${k}`).not.toBe('');
    }
  });
  it('keeps the same {placeholders} in every translation', () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const l of LANGUAGES)
      for (const k of Object.keys(en) as (keyof typeof en)[])
        expect(ph(DICTIONARIES[l.code][k]), `${l.code}:${k}`).toEqual(ph(en[k]));
  });
  it('interpolates and leaves unknown placeholders visible', () => {
    expect(translate('en', 'hol.in', { n: 3 })).toBe('in 3 days');
    expect(translate('en', 'hol.in')).toBe('in {n} days');
  });
  it('picks a language from the phone locale', () => {
    expect(languageFromLocale('hi-IN')).toBe('hi');
    expect(languageFromLocale('fr')).toBe('en');
    expect(languageFromLocale(undefined)).toBe('en');
  });
});

describe('money', () => {
  it('formats INR with Indian grouping and other currencies internationally', () => {
    expect(formatMoney(4400000, 'INR')).toBe('₹44,000.00');
    expect(formatMoney(123456789, 'INR')).toBe('₹12,34,567.89');
    expect(formatMoney(123456789, 'USD')).toBe('$1,234,567.89');
    expect(formatMoney(-5050, 'INR')).toBe('-₹50.50');
  });
  it('computes percent-of-basic components with round-half-up', () => {
    // 40% of 10,000.00 basic
    expect(
      componentAmountMinor({ code: 'HRA', calc: 'PERCENT_OF_BASIC', value: 4000 }, 1000000),
    ).toBe(400000);
    expect(componentAmountMinor({ code: 'X', calc: 'FIXED', value: 12345 }, 0)).toBe(12345);
    // 12.5% of 0.01 => 0.00125 -> rounds to 0
    expect(componentAmountMinor({ code: 'Y', calc: 'PERCENT_OF_BASIC', value: 1250 }, 1)).toBe(0);
  });
});

describe('calendar', () => {
  it('builds Sunday-first weeks covering the month', () => {
    const g = monthGrid('2026-03'); // March 2026 starts on a Sunday
    expect(g[0]![0]!.date).toBe('2026-03-01');
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(g.flat().filter((c) => c.inMonth)).toHaveLength(31);
  });
  it('shifts months across year ends and gives bounds', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(monthBounds('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(monthTitle('2026-03')).toBe('March 2026');
  });
});

describe('handbook text', () => {
  it('parses headings, bullets and paragraphs as plain text only', () => {
    const b = parseHandbook(
      '## Leave\nTake it\nwisely.\n\n- one\n- two\n<script>alert(1)</script>',
    );
    expect(b).toEqual([
      { type: 'h', text: 'Leave' },
      { type: 'p', text: 'Take it wisely.' },
      { type: 'li', text: 'one' },
      { type: 'li', text: 'two' },
      { type: 'p', text: '<script>alert(1)</script>' },
    ]);
  });
});

describe('roles', () => {
  it('shows Team only to managers, HR and owners', () => {
    expect(canSeeTeam(['EMPLOYEE'])).toBe(false);
    expect(canSeeTeam(['MANAGER'])).toBe(true);
    expect(seesEveryone(['MANAGER'])).toBe(false);
    expect(seesEveryone(['HR_ADMIN'])).toBe(true);
    expect(canSeeTeam(undefined)).toBe(false);
  });
});
