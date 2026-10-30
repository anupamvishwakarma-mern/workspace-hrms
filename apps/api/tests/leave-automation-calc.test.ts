import { describe, expect, it } from 'vitest';
import { carryYearToRun, monthsToRun } from '../src/modules/leave/automation';

describe('which months automatic leave credits', () => {
  it('credits only from the month it was switched on, never earlier', () => {
    expect(monthsToRun('2026-03', '2026-03-15')).toEqual(['2026-03']);
    expect(monthsToRun('2026-02', '2026-03-15')).toEqual(['2026-02', '2026-03']);
  });
  it('catches up a few months after downtime, oldest first, and no more', () => {
    expect(monthsToRun('2025-01', '2026-03-15')).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(monthsToRun('2025-11', '2026-01-02')).toEqual(['2025-11', '2025-12', '2026-01']);
  });
  it('does nothing when off, malformed, or switched on for a future month', () => {
    expect(monthsToRun(undefined, '2026-03-15')).toEqual([]);
    expect(monthsToRun('March', '2026-03-15')).toEqual([]);
    expect(monthsToRun('2026-05', '2026-03-15')).toEqual([]);
  });
});

describe('when the year-end carry-forward runs', () => {
  it('runs during January for the year that just ended', () => {
    expect(carryYearToRun('2025-03', '2026-01-01')).toBe(2025);
    expect(carryYearToRun('2025-03', '2026-01-31')).toBe(2025);
  });
  it('does not run in other months', () => {
    expect(carryYearToRun('2025-03', '2026-02-01')).toBeNull();
    expect(carryYearToRun('2025-03', '2025-12-31')).toBeNull();
  });
  it('skips a year that ended before automation was switched on', () => {
    expect(carryYearToRun('2026-01', '2026-01-10')).toBeNull();
    expect(carryYearToRun('2025-12', '2026-01-10')).toBe(2025);
  });
  it('does nothing when off or malformed', () => {
    expect(carryYearToRun(undefined, '2026-01-10')).toBeNull();
    expect(carryYearToRun('x', '2026-01-10')).toBeNull();
  });
});
