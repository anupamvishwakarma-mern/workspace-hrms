import { describe, expect, it } from 'vitest';
import { addDaysIso, compact, formatDate, formatMinutes, formatTime, label } from '@/lib/utils';

describe('utils', () => {
  it('formats minutes', () => {
    expect(formatMinutes(0)).toBe('0m');
    expect(formatMinutes(65)).toBe('1h 05m');
    expect(formatMinutes(null)).toBe('0m');
  });
  it('formats times in the company zone, not the browser zone', () => {
    expect(formatTime('2026-03-02T03:30:00.000Z', 'Asia/Kolkata')).toBe('09:00');
    expect(formatTime('2026-03-02T03:30:00.000Z', 'America/New_York')).toBe('22:30');
    expect(formatTime(undefined, 'UTC')).toBe('—');
  });
  it('formats dates and does date math without timezone drift', () => {
    expect(formatDate('2026-03-02')).toBe('02 Mar 2026');
    expect(formatDate('2026-03-02T00:00:00.000Z')).toBe('02 Mar 2026');
    expect(addDaysIso('2026-02-28', 1)).toBe('2026-03-01');
  });
  it('labels enums', () => expect(label('NOTICE_PERIOD')).toBe('Notice period'));
  it('compact drops blanks but keeps zero and false', () => {
    expect(compact({ a: '', b: undefined, c: null, d: 0, e: false, f: 'x' })).toEqual({
      d: 0,
      e: false,
      f: 'x',
    });
  });
});
