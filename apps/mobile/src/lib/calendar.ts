import { DateTime } from 'luxon';

export interface Cell {
  date: string; // YYYY-MM-DD
  day: number;
  inMonth: boolean;
}

/** Weeks (Sunday first) covering a month, padded with days of the neighbouring months. */
export function monthGrid(month: string): Cell[][] {
  const first = DateTime.fromISO(`${month}-01`, { zone: 'utc' });
  const start = first.minus({ days: first.weekday % 7 });
  const end = first.endOf('month');
  const weeks: Cell[][] = [];
  for (let w = start; w <= end; w = w.plus({ weeks: 1 })) {
    weeks.push(
      Array.from({ length: 7 }, (_, i) => {
        const d = w.plus({ days: i });
        return { date: d.toISODate()!, day: d.day, inMonth: d.month === first.month };
      }),
    );
  }
  return weeks;
}

export const monthOf = (isoDate: string) => isoDate.slice(0, 7);
export const shiftMonth = (month: string, delta: number) =>
  DateTime.fromISO(`${month}-01`, { zone: 'utc' }).plus({ months: delta }).toFormat('yyyy-MM');
export const monthBounds = (month: string) => {
  const s = DateTime.fromISO(`${month}-01`, { zone: 'utc' });
  return { from: s.toISODate()!, to: s.endOf('month').toISODate()! };
};
export const monthTitle = (month: string, locale = 'en') =>
  DateTime.fromISO(`${month}-01`, { zone: 'utc' }).setLocale(locale).toFormat('LLLL yyyy');
export const weekdayLetters = (locale = 'en') =>
  Array.from({ length: 7 }, (_, i) =>
    DateTime.fromISO('2026-03-01', { zone: 'utc' }) // a Sunday
      .plus({ days: i })
      .setLocale(locale)
      .toFormat('ccccc'),
  );
export const todayInZone = (zone: string) => DateTime.now().setZone(zone).toISODate()!;
