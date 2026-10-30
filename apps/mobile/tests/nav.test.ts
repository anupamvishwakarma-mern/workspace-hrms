import { describe, expect, it } from 'vitest';
import { badgeText, drawerFor, footerFor } from '../src/nav/config';

const VIEWS = ['employee', 'manager', 'hr', 'owner'] as const;

describe('navigation config', () => {
  it('keeps the footer to five items, one centre button at most', () => {
    for (const v of VIEWS)
      for (const punch of [false, true]) {
        const items = footerFor(v, punch);
        expect(items.length).toBeLessThanOrEqual(5);
        expect(items.filter((i) => i.center).length).toBeLessThanOrEqual(1);
      }
  });
  it('only employees get the Punch layout', () => {
    expect(footerFor('employee', true).map((i) => i.label)).toEqual([
      'Home',
      'Attendance',
      'Punch',
      'Leave',
      'Me',
    ]);
    expect(footerFor('manager', true)).toEqual(footerFor('manager', false));
  });
  it('every item opens something and keys are unique per drawer', () => {
    for (const v of VIEWS) {
      const keys = drawerFor(v).flatMap((g) => g.items.map((i) => i.key));
      expect(new Set(keys).size).toBe(keys.length);
      for (const g of drawerFor(v)) for (const i of g.items) expect(i.tab || i.href).toBeTruthy();
    }
  });
  it('caps badges at 99+', () => {
    expect(badgeText(7)).toBe('7');
    expect(badgeText(99)).toBe('99');
    expect(badgeText(100)).toBe('99+');
  });
});
