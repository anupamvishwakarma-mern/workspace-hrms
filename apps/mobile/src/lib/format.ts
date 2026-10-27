import { DateTime } from 'luxon';

export function formatMinutes(total: number | null | undefined): string {
  const m = Math.max(0, Math.round(total ?? 0));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

/** ISO instant -> "09:05 AM" in the given IANA timezone (the shift/company zone, not the phone's). */
export function formatTime(iso: string | null | undefined, zone: string): string {
  if (!iso) return '--';
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(zone);
  return dt.isValid ? dt.toFormat('hh:mm a') : '--';
}

export function formatWorkDate(workDate: string): string {
  const dt = DateTime.fromISO(workDate, { zone: 'utc' });
  return dt.isValid ? dt.toFormat('ccc, dd LLL yyyy') : workDate;
}

export const STATUS_LABEL: Record<string, string> = {
  PRESENT: 'Present',
  HALF_DAY: 'Half day',
  ABSENT: 'Absent',
  ON_LEAVE: 'On leave',
  HOLIDAY: 'Holiday',
  WEEKLY_OFF: 'Weekly off',
  INCOMPLETE: 'Incomplete',
};
export const STATE_LABEL = {
  OFF: 'Not checked in',
  WORKING: 'Working',
  ON_BREAK: 'On break',
} as const;
export const EVENT_LABEL = {
  CHECK_IN: 'Checked in',
  CHECK_OUT: 'Checked out',
  BREAK_START: 'Break started',
  BREAK_END: 'Break ended',
} as const;
