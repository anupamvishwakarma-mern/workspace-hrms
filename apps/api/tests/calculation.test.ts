import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import {
  calculateDay,
  type CalcInput,
  type EventType,
  type ShiftPolicy,
} from '../src/modules/attendance/calculation';
import { localDate, shiftWindow } from '../src/modules/attendance/dates';

const IST = 'Asia/Kolkata';
const t = (date: string, time: string, tz = IST) =>
  DateTime.fromISO(`${date}T${time}`, { zone: tz }).toJSDate();
const ev = (type: EventType, date: string, time: string, tz = IST) => ({
  type,
  at: t(date, time, tz),
});

const day: ShiftPolicy = {
  startTime: '09:00',
  endTime: '18:00',
  graceMinutes: 10,
  earlyDepartureGraceMinutes: 5,
  breakPolicy: { type: 'RECORDED', paidAllowanceMinutes: 0, autoDeductMinutes: 0 },
  overtimePolicy: { enabled: false, thresholdMinutes: 0 },
  weeklyOffDays: [0],
};
const D = '2026-03-02'; // Monday
const base = (over: Partial<CalcInput> = {}): CalcInput => ({
  workDate: D,
  tz: IST,
  shift: day,
  tenantWorkweek: [1, 2, 3, 4, 5],
  events: [],
  corrections: [],
  holiday: false,
  leave: null,
  now: t('2026-03-10', '12:00'),
  maxOpenSessionHours: 16,
  ...over,
});

describe('grace period boundaries', () => {
  it('exactly at grace is not late; one minute past is late (counted from shift start)', () => {
    const run = (inTime: string) =>
      calculateDay(base({ events: [ev('CHECK_IN', D, inTime), ev('CHECK_OUT', D, '18:00')] }));
    expect(run('09:10').lateMinutes).toBe(0);
    expect(run('09:11').lateMinutes).toBe(11);
    expect(run('09:00').lateMinutes).toBe(0);
    expect(run('08:30').lateMinutes).toBe(0); // early arrival is not negative lateness
  });
  it('early departure grace boundary', () => {
    const run = (out: string) =>
      calculateDay(base({ events: [ev('CHECK_IN', D, '09:00'), ev('CHECK_OUT', D, out)] }));
    expect(run('17:55').earlyDepartureMinutes).toBe(0);
    expect(run('17:54').earlyDepartureMinutes).toBe(6);
    expect(run('18:30').earlyDepartureMinutes).toBe(0);
  });
});

describe('worked time and breaks', () => {
  const punches = [
    ev('CHECK_IN', D, '09:00'),
    ev('BREAK_START', D, '13:00'),
    ev('BREAK_END', D, '13:45'),
    ev('CHECK_OUT', D, '18:00'),
  ];
  it('unpaid recorded breaks are deducted; a normal lunch does not shorten a day whose schedule expects it', () => {
    const shift = {
      ...day,
      breakPolicy: {
        type: 'RECORDED' as const,
        paidAllowanceMinutes: 0,
        autoDeductMinutes: 0,
        expectedUnpaidMinutes: 60,
      },
    };
    const r = calculateDay(base({ shift, events: punches }));
    expect(r.scheduledMinutes).toBe(480);
    expect(r.breakMinutes).toBe(45);
    expect(r.unpaidBreakMinutes).toBe(45);
    expect(r.workedMinutes).toBe(540 - 45);
    expect(r.status).toBe('PRESENT');
  });
  it('paid allowance covers part of the break', () => {
    const shift = {
      ...day,
      breakPolicy: { type: 'RECORDED' as const, paidAllowanceMinutes: 30, autoDeductMinutes: 0 },
    };
    const r = calculateDay(base({ shift, events: punches }));
    expect(r.unpaidBreakMinutes).toBe(15);
    expect(r.workedMinutes).toBe(540 - 15);
  });
  it('fully paid breaks deduct nothing', () => {
    const shift = {
      ...day,
      breakPolicy: { type: 'RECORDED' as const, paidAllowanceMinutes: 120, autoDeductMinutes: 0 },
    };
    expect(calculateDay(base({ shift, events: punches })).workedMinutes).toBe(540);
  });
  it('auto-deduct ignores recorded breaks and reduces scheduled minutes', () => {
    const shift = {
      ...day,
      breakPolicy: { type: 'AUTO_DEDUCT' as const, paidAllowanceMinutes: 0, autoDeductMinutes: 60 },
    };
    const r = calculateDay(base({ shift, events: punches }));
    expect(r.workedMinutes).toBe(480);
    expect(r.scheduledMinutes).toBe(480);
  });
  it('multiple work sessions are summed (no duplicate sessions from one in/out pair)', () => {
    const r = calculateDay(
      base({
        events: [
          ev('CHECK_IN', D, '09:00'),
          ev('CHECK_OUT', D, '13:00'),
          ev('CHECK_IN', D, '14:00'),
          ev('CHECK_OUT', D, '18:00'),
        ],
      }),
    );
    expect(r.workedMinutes).toBe(480);
    expect(r.sessions).toHaveLength(2);
  });
});

describe('status thresholds', () => {
  const run = (out: string, shift = day) =>
    calculateDay(base({ shift, events: [ev('CHECK_IN', D, '09:00'), ev('CHECK_OUT', D, out)] }))
      .status;
  it('PRESENT / HALF_DAY / ABSENT by worked minutes', () => {
    expect(run('18:00')).toBe('PRESENT');
    expect(run('13:30')).toBe('HALF_DAY'); // 270 >= 270 (half of 540)
    expect(run('13:29')).toBe('ABSENT');
  });
  it('honours configured thresholds', () => {
    const shift = { ...day, minFullDayMinutes: 420, minHalfDayMinutes: 200 };
    expect(run('16:00', shift)).toBe('PRESENT');
    expect(run('12:20', shift)).toBe('HALF_DAY');
  });
});

describe('grace never downgrades a day', () => {
  it('arriving and leaving within grace is still PRESENT; beyond it falls to HALF_DAY only below the threshold', () => {
    const r = calculateDay(
      base({ events: [ev('CHECK_IN', D, '09:10'), ev('CHECK_OUT', D, '17:55')] }),
    );
    expect(r.workedMinutes).toBe(525);
    expect(r.status).toBe('PRESENT');
    expect(
      calculateDay(base({ events: [ev('CHECK_IN', D, '09:11'), ev('CHECK_OUT', D, '17:55')] }))
        .status,
    ).toBe('HALF_DAY'); // 524 < 525
  });
});

describe('overtime', () => {
  const ot = {
    ...day,
    overtimePolicy: { enabled: true, thresholdMinutes: 30, maxMinutesPerDay: 120 },
  };
  const run = (out: string) =>
    calculateDay(base({ shift: ot, events: [ev('CHECK_IN', D, '09:00'), ev('CHECK_OUT', D, out)] }))
      .overtimeMinutes;
  it('only counts beyond threshold, capped, and only when enabled', () => {
    expect(run('18:29')).toBe(0);
    expect(run('18:30')).toBe(30);
    expect(run('22:00')).toBe(120);
    expect(
      calculateDay(base({ events: [ev('CHECK_IN', D, '09:00'), ev('CHECK_OUT', D, '22:00')] }))
        .overtimeMinutes,
    ).toBe(0);
  });
  it('all time on a weekly off is overtime when enabled', () => {
    const sunday = '2026-03-01';
    const r = calculateDay(
      base({
        workDate: sunday,
        shift: { ...ot, overtimePolicy: { enabled: true, thresholdMinutes: 0 } },
        events: [ev('CHECK_IN', sunday, '10:00'), ev('CHECK_OUT', sunday, '14:00')],
      }),
    );
    expect(r.status).toBe('WEEKLY_OFF');
    expect(r.overtimeMinutes).toBe(240);
  });
});

describe('overnight shifts', () => {
  const night: ShiftPolicy = { ...day, startTime: '22:00', endTime: '06:00', weeklyOffDays: [] };
  it('window ends on the following day', () => {
    const w = shiftWindow(D, night, IST);
    expect(w.overnight).toBe(true);
    expect(w.end.getTime() - w.start.getTime()).toBe(8 * 3600_000);
  });
  it('check-in 22:00 -> check-out 06:00 next day is a full present day with no early/late', () => {
    const r = calculateDay(
      base({
        shift: night,
        events: [ev('CHECK_IN', D, '22:00'), ev('CHECK_OUT', '2026-03-03', '06:00')],
      }),
    );
    expect(r.workedMinutes).toBe(480);
    expect(r.status).toBe('PRESENT');
    expect(r.lateMinutes).toBe(0);
    expect(r.earlyDepartureMinutes).toBe(0);
  });
  it('late arrival and early departure are measured against the next-day end', () => {
    const r = calculateDay(
      base({
        shift: night,
        events: [ev('CHECK_IN', D, '22:30'), ev('CHECK_OUT', '2026-03-03', '05:00')],
      }),
    );
    expect(r.lateMinutes).toBe(30);
    expect(r.earlyDepartureMinutes).toBe(60);
  });
});

describe('timezones', () => {
  it('workday follows the employee timezone, not UTC', () => {
    const at = new Date('2026-03-01T19:00:00Z'); // 00:30 on 2 March in IST, still 1 March in UTC
    expect(localDate(at, IST)).toBe('2026-03-02');
    expect(localDate(at, 'UTC')).toBe('2026-03-01');
    expect(localDate(at, 'America/Los_Angeles')).toBe('2026-03-01');
  });
  it('shift windows are correct across a DST change (New York, spring forward)', () => {
    const ny: ShiftPolicy = { ...day, startTime: '00:00', endTime: '08:00' };
    const w = shiftWindow('2026-03-08', ny, 'America/New_York'); // clocks skip 02:00 -> 03:00
    expect((w.end.getTime() - w.start.getTime()) / 3600_000).toBe(7);
  });
  it('calculates in the shift timezone for a different-zone tenant', () => {
    const ny = 'America/New_York';
    const r = calculateDay(
      base({
        tz: ny,
        workDate: D,
        events: [ev('CHECK_IN', D, '09:05', ny), ev('CHECK_OUT', D, '18:00', ny)],
      }),
    );
    expect(r.lateMinutes).toBe(0);
    expect(r.workedMinutes).toBe(535);
  });
});

describe('holidays, weekly offs and leave', () => {
  it('holiday and weekly off with no punches', () => {
    expect(calculateDay(base({ holiday: true })).status).toBe('HOLIDAY');
    expect(calculateDay(base({ workDate: '2026-03-01' })).status).toBe('WEEKLY_OFF');
  });
  it('holiday takes precedence; no lateness on a holiday', () => {
    const r = calculateDay(
      base({ holiday: true, events: [ev('CHECK_IN', D, '11:00'), ev('CHECK_OUT', D, '15:00')] }),
    );
    expect(r.status).toBe('HOLIDAY');
    expect(r.lateMinutes).toBe(0);
    expect(r.workedMinutes).toBe(240);
  });
  it('approved full leave -> ON_LEAVE, zero scheduled minutes', () => {
    const r = calculateDay(base({ leave: 'FULL' }));
    expect(r.status).toBe('ON_LEAVE');
    expect(r.scheduledMinutes).toBe(0);
  });
  it('half-day leave halves the requirement', () => {
    const worked = calculateDay(
      base({ leave: 'HALF', events: [ev('CHECK_IN', D, '09:00'), ev('CHECK_OUT', D, '13:30')] }),
    );
    expect(worked.status).toBe('PRESENT'); // 270 >= 270
    expect(worked.lateMinutes).toBe(0);
    expect(calculateDay(base({ leave: 'HALF' })).status).toBe('HALF_DAY');
  });
  it('no shift assigned: tenant workweek decides weekly off', () => {
    expect(calculateDay(base({ shift: null, workDate: '2026-03-07' })).status).toBe('WEEKLY_OFF'); // Saturday
    expect(calculateDay(base({ shift: null })).status).toBe('ABSENT');
  });
});

describe('missing check-out and in-progress days', () => {
  it('stale open session is INCOMPLETE and contributes no worked time', () => {
    const r = calculateDay(base({ events: [ev('CHECK_IN', D, '09:00')] }));
    expect(r.status).toBe('INCOMPLETE');
    expect(r.workedMinutes).toBe(0);
    expect(r.isOpen).toBe(false);
  });
  it('a live open session counts up to now and is flagged in progress', () => {
    const now = t(D, '12:00');
    const r = calculateDay(base({ now, events: [ev('CHECK_IN', D, '09:00')] }));
    expect(r.isOpen).toBe(true);
    expect(r.workedMinutes).toBe(180);
    expect(r.status).toBe('PRESENT');
  });
  it('open break at calculation time is clipped to now', () => {
    const now = t(D, '13:30');
    const r = calculateDay(
      base({ now, events: [ev('CHECK_IN', D, '09:00'), ev('BREAK_START', D, '13:00')] }),
    );
    expect(r.breakMinutes).toBe(30);
    expect(r.workedMinutes).toBe(270 - 30);
  });
  it('today with no punches is undetermined; past days are ABSENT', () => {
    expect(calculateDay(base({ now: t(D, '08:00') })).status).toBeNull();
    expect(calculateDay(base()).status).toBe('ABSENT');
  });
});

describe('approved corrections', () => {
  it('a corrected check-out completes an INCOMPLETE day without touching the original events', () => {
    const events = [ev('CHECK_IN', D, '09:00')];
    const snapshot = JSON.stringify(events);
    const r = calculateDay(base({ events, corrections: [{ checkOut: t(D, '18:00') }] }));
    expect(r.status).toBe('PRESENT');
    expect(r.workedMinutes).toBe(540);
    expect(r.correctionApplied).toBe(true);
    expect(JSON.stringify(events)).toBe(snapshot);
  });
  it('a day with no punches can be rebuilt from a full correction; later corrections win per field', () => {
    const r = calculateDay(
      base({
        corrections: [
          { checkIn: t(D, '09:00'), checkOut: t(D, '17:00') },
          { checkOut: t(D, '18:00') },
        ],
      }),
    );
    expect(r.workedMinutes).toBe(540);
  });
  it('a lone boundary with no punches stays INCOMPLETE', () => {
    expect(calculateDay(base({ corrections: [{ checkIn: t(D, '09:00') }] })).status).toBe(
      'INCOMPLETE',
    );
  });
});

describe('determinism', () => {
  it('same input twice gives identical output and is version-stamped', () => {
    const input = base({ events: [ev('CHECK_IN', D, '09:05'), ev('CHECK_OUT', D, '18:00')] });
    expect(JSON.stringify(calculateDay(input))).toBe(JSON.stringify(calculateDay(input)));
    expect(calculateDay(input).calculationVersion).toBe(1);
  });
  it('event input order does not matter', () => {
    const a = [
      ev('CHECK_IN', D, '09:00'),
      ev('BREAK_START', D, '12:00'),
      ev('BREAK_END', D, '12:30'),
      ev('CHECK_OUT', D, '18:00'),
    ];
    expect(calculateDay(base({ events: [...a].reverse() })).workedMinutes).toBe(
      calculateDay(base({ events: a })).workedMinutes,
    );
  });
});
