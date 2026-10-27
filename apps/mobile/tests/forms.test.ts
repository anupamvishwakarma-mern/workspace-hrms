import { describe, expect, it } from 'vitest';
import { resolveApiUrl } from '../src/lib/url';
import { buildCorrectionPayload, correctionSchema, loginSchema } from '../src/lib/forms';
import { formatMinutes, formatTime } from '../src/lib/format';
import { ApiError, isGeoFailure, userMessage } from '../src/lib/errors';

const NOW = new Date('2026-03-10T06:00:00Z');
const base = {
  workDate: '2026-03-09',
  checkIn: '09:00',
  checkOut: '18:00',
  checkOutNextDay: false,
  reason: 'Forgot to check in',
};

describe('resolveApiUrl', () => {
  it('requires https in release builds and allows http only in dev', () => {
    expect(() => resolveApiUrl('http://x.test/api/v1', false)).toThrow(/https/);
    expect(resolveApiUrl('http://10.0.2.2:4000/api/v1/', true)).toBe('http://10.0.2.2:4000/api/v1');
    expect(resolveApiUrl('https://api.example.com/api/v1', false)).toBe(
      'https://api.example.com/api/v1',
    );
    expect(() => resolveApiUrl(undefined, true)).toThrow(/not set/);
    expect(() => resolveApiUrl('not a url', true)).toThrow(/valid URL/);
  });
});

describe('forms', () => {
  it('validates login', () => {
    expect(loginSchema.safeParse({ email: 'bad', password: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
  });
  it('requires at least one time and a real reason', () => {
    expect(correctionSchema.safeParse({ ...base, checkIn: '', checkOut: '' }).success).toBe(false);
    expect(correctionSchema.safeParse({ ...base, checkIn: '9am' }).success).toBe(false);
    expect(correctionSchema.safeParse({ ...base, reason: 'no' }).success).toBe(false);
    expect(correctionSchema.safeParse(base).success).toBe(true);
  });
  it('converts wall-clock times using the company timezone, not the phone', () => {
    const p = buildCorrectionPayload(base, 'Asia/Kolkata', NOW);
    expect(p.checkIn).toBe('2026-03-09T03:30:00.000Z');
    expect(p.checkOut).toBe('2026-03-09T12:30:00.000Z');
  });
  it('supports overnight check-out and rejects check-out before check-in', () => {
    const night = buildCorrectionPayload(
      { ...base, checkIn: '22:00', checkOut: '06:00', checkOutNextDay: true },
      'Asia/Kolkata',
      NOW,
    );
    expect(night.checkOut! > night.checkIn!).toBe(true);
    expect(() =>
      buildCorrectionPayload({ ...base, checkIn: '18:00', checkOut: '09:00' }, 'Asia/Kolkata', NOW),
    ).toThrow(/after/);
  });
  it('rejects future dates and dates beyond the 60 day window', () => {
    expect(() =>
      buildCorrectionPayload({ ...base, workDate: '2026-03-12' }, 'Asia/Kolkata', NOW),
    ).toThrow(/future/);
    expect(() =>
      buildCorrectionPayload({ ...base, workDate: '2025-12-01' }, 'Asia/Kolkata', NOW),
    ).toThrow(/60 days/);
  });
  it('omits an empty side of the correction', () => {
    const p = buildCorrectionPayload({ ...base, checkOut: '' }, 'Asia/Kolkata', NOW);
    expect(p).not.toHaveProperty('checkOut');
  });
});

describe('formatting and errors', () => {
  it('formats minutes and shows times in the given zone', () => {
    expect(formatMinutes(0)).toBe('0m');
    expect(formatMinutes(65)).toBe('1h 05m');
    expect(formatMinutes(undefined)).toBe('0m');
    expect(formatTime('2026-03-09T03:30:00.000Z', 'Asia/Kolkata')).toBe('09:00 AM');
    expect(formatTime(null, 'Asia/Kolkata')).toBe('--');
  });
  it('shows safe messages and recognises geofence failures', () => {
    expect(userMessage(new ApiError(500, 'INTERNAL_ERROR', 'stack trace details'))).not.toMatch(
      /stack/,
    );
    expect(userMessage(new ApiError(0, 'NETWORK_ERROR', 'x'))).toMatch(/connection/);
    expect(userMessage(new Error('boom'))).toBe('Something went wrong. Try again.');
    expect(isGeoFailure(new ApiError(422, 'OUTSIDE_GEOFENCE', 'x'))).toBe(true);
    expect(isGeoFailure(new ApiError(409, 'INVALID_TRANSITION', 'x'))).toBe(false);
  });
});
