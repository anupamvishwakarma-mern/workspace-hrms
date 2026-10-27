import { DateTime } from 'luxon';
import { z } from 'zod';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const CORRECTION_WINDOW_DAYS = 60;

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email').email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
});
export type LoginForm = z.infer<typeof loginSchema>;

export const correctionSchema = z
  .object({
    workDate: z.string().regex(DATE, 'Use YYYY-MM-DD'),
    checkIn: z
      .string()
      .trim()
      .refine((v) => v === '' || TIME.test(v), 'Use 24h HH:MM'),
    checkOut: z
      .string()
      .trim()
      .refine((v) => v === '' || TIME.test(v), 'Use 24h HH:MM'),
    checkOutNextDay: z.boolean(),
    reason: z.string().trim().min(5, 'Explain what happened (at least 5 characters)').max(1000),
  })
  .refine((v) => v.checkIn !== '' || v.checkOut !== '', {
    path: ['checkIn'],
    message: 'Enter a check-in time, a check-out time, or both',
  });
export type CorrectionForm = z.infer<typeof correctionSchema>;

export interface CorrectionPayload {
  workDate: string;
  checkIn?: string;
  checkOut?: string;
  reason: string;
}

/**
 * Converts wall-clock times the employee typed into instants using the company/shift timezone
 * (never the phone's). The server re-validates everything, including the 60-day window.
 */
export function buildCorrectionPayload(
  v: CorrectionForm,
  zone: string,
  now: Date = new Date(),
): CorrectionPayload {
  const day = DateTime.fromISO(v.workDate, { zone });
  if (!day.isValid) throw new Error('Invalid date');
  const today = DateTime.fromJSDate(now, { zone }).startOf('day');
  if (day > today) throw new Error('You cannot correct a future date');
  if (today.diff(day, 'days').days > CORRECTION_WINDOW_DAYS)
    throw new Error(`Corrections are limited to the last ${CORRECTION_WINDOW_DAYS} days`);
  const at = (hhmm: string, plusDays = 0) => {
    const [h, m] = hhmm.split(':').map(Number) as [number, number];
    return day.plus({ days: plusDays }).set({ hour: h, minute: m }).toUTC().toISO()!;
  };
  const checkIn = v.checkIn ? at(v.checkIn) : undefined;
  const checkOut = v.checkOut ? at(v.checkOut, v.checkOutNextDay ? 1 : 0) : undefined;
  if (checkIn && checkOut && checkOut <= checkIn)
    throw new Error('Check-out must be after check-in (use "next day" for overnight shifts)');
  return {
    workDate: v.workDate,
    ...(checkIn ? { checkIn } : {}),
    ...(checkOut ? { checkOut } : {}),
    reason: v.reason,
  };
}
