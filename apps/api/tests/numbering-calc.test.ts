import { describe, expect, it } from 'vitest';
import { DEFAULT_NUMBERING, PREFIX_RE, formatNumber, resolveNumbering } from '../src/modules/tenants/numbering';

describe('numbering rules', () => {
  it('default to the existing formats', () => {
    const n = resolveNumbering(undefined);
    expect(n).toEqual(DEFAULT_NUMBERING);
    expect(formatNumber(n.employee, 7)).toBe('EMP-0007');
    expect(formatNumber(n.letter, 12, '2026-')).toBe('LTR-2026-0012');
  });
  it('use stored values and fall back per field', () => {
    const n = resolveNumbering({ employee: { prefix: 'ACME/', padding: 6 }, letter: { prefix: null } });
    expect(formatNumber(n.employee, 42)).toBe('ACME/000042');
    expect(n.letter).toEqual(DEFAULT_NUMBERING.letter);
  });
  it('allows an empty prefix and does not truncate long numbers', () => {
    expect(formatNumber({ prefix: '', padding: 3 }, 12345)).toBe('12345');
  });
  it('accepts only safe prefixes', () => {
    expect(PREFIX_RE.test('EMP-')).toBe(true);
    expect(PREFIX_RE.test('A_B/')).toBe(true);
    expect(PREFIX_RE.test('')).toBe(true);
    for (const bad of ['emp', 'EMP ', 'EMP.', '../', 'TOOLONGPREFIX1', '<b>']) expect(PREFIX_RE.test(bad), bad).toBe(false);
  });
});
