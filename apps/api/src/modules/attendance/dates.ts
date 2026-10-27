import { DateTime } from 'luxon';

export const isRealDate = (d: string): boolean => DateTime.fromISO(d, { zone: 'UTC' }).isValid;
export const WORK_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Calendar date ('YYYY-MM-DD') of an instant in the given IANA timezone. Never UTC-by-default. */
export function localDate(at: Date, tz: string): string {
  return DateTime.fromJSDate(at, { zone: tz }).toFormat('yyyy-MM-dd');
}

export function addDays(date: string, days: number): string {
  return DateTime.fromISO(date, { zone: 'UTC' }).plus({ days }).toFormat('yyyy-MM-dd');
}

/** 0 = Sunday ... 6 = Saturday for a calendar date (timezone-independent). */
export function dayOfWeek(date: string): number {
  return DateTime.fromISO(date, { zone: 'UTC' }).weekday % 7;
}

export interface ShiftTimes {
  startTime: string;
  endTime: string;
}

/** Concrete start/end instants of the shift instance that begins on `workDate` in `tz`. */
export function shiftWindow(
  workDate: string,
  shift: ShiftTimes,
  tz: string,
): { start: Date; end: Date; overnight: boolean } {
  const start = DateTime.fromISO(`${workDate}T${shift.startTime}`, { zone: tz });
  let end = DateTime.fromISO(`${workDate}T${shift.endTime}`, { zone: tz });
  const overnight = end <= start;
  if (overnight) end = end.plus({ days: 1 });
  return { start: start.toJSDate(), end: end.toJSDate(), overnight };
}

export const minutesBetween = (a: Date, b: Date): number =>
  Math.floor((b.getTime() - a.getTime()) / 60_000);

export function isValidTimezone(tz: string): boolean {
  return DateTime.local().setZone(tz).isValid;
}
