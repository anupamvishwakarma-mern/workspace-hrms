import { clsx, type ClassValue } from 'clsx';
import { DateTime } from 'luxon';
import { twMerge } from 'tailwind-merge';

export const cn = (...i: ClassValue[]) => twMerge(clsx(i));

export function formatMinutes(total: number | null | undefined): string {
  const m = Math.max(0, Math.round(total ?? 0));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}
export function formatTime(iso: string | null | undefined, zone: string): string {
  if (!iso) return '—';
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(zone);
  return dt.isValid ? dt.toFormat('HH:mm') : '—';
}
export function formatDate(d: string | undefined): string {
  if (!d) return '—';
  const dt = DateTime.fromISO(d.slice(0, 10), { zone: 'utc' });
  return dt.isValid ? dt.toFormat('dd LLL yyyy') : d;
}
export const todayIso = (zone: string) => DateTime.now().setZone(zone).toISODate()!;
export const addDaysIso = (d: string, n: number) =>
  DateTime.fromISO(d, { zone: 'utc' }).plus({ days: n }).toISODate()!;
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const label = (s: string) =>
  s
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
/** Strips blank form values so optional fields are omitted rather than sent as "" (the API is strict). */
export function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null),
  ) as Partial<T>;
}
