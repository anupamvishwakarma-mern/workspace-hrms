import { addDays, dayOfWeek, localDate, shiftWindow } from './dates';

export const CALCULATION_VERSION = 1;

export type EventType = 'CHECK_IN' | 'CHECK_OUT' | 'BREAK_START' | 'BREAK_END';
export type DayStatus =
  'PRESENT' | 'HALF_DAY' | 'ABSENT' | 'ON_LEAVE' | 'HOLIDAY' | 'WEEKLY_OFF' | 'INCOMPLETE';

export interface ShiftPolicy {
  startTime: string;
  endTime: string;
  graceMinutes: number;
  earlyDepartureGraceMinutes: number;
  minFullDayMinutes?: number | null;
  minHalfDayMinutes?: number | null;
  /**
   * RECORDED: unpaid break time = recorded break minutes beyond paidAllowanceMinutes; expectedUnpaidMinutes is the
   * break the schedule assumes (reduces scheduled/full-day minutes so a normal lunch does not make a day short).
   * AUTO_DEDUCT: autoDeductMinutes is deducted every worked day regardless of recorded breaks.
   */
  breakPolicy: {
    type: 'RECORDED' | 'AUTO_DEDUCT';
    paidAllowanceMinutes: number;
    autoDeductMinutes: number;
    expectedUnpaidMinutes?: number;
  };
  overtimePolicy: { enabled: boolean; thresholdMinutes: number; maxMinutesPerDay?: number | null };
  weeklyOffDays: number[];
}

export interface CalcInput {
  workDate: string;
  tz: string;
  shift: ShiftPolicy | null;
  /** Tenant workdays (0=Sun..6=Sat); used for weekly-off only when no shift is assigned. */
  tenantWorkweek: number[];
  events: { type: EventType; at: Date }[];
  /** Approved corrections in approval order; later ones win per field. Originals are never edited. */
  corrections: { checkIn?: Date; checkOut?: Date }[];
  holiday: boolean;
  leave: 'FULL' | 'HALF' | null;
  now: Date;
  maxOpenSessionHours: number;
}

export interface CalcSession {
  start: Date;
  end?: Date;
  breakMinutes: number;
  open: boolean;
}

export interface CalcResult {
  status: DayStatus | null; // null = not determinable yet (today, no punches)
  firstCheckIn?: Date;
  lastCheckOut?: Date;
  workedMinutes: number;
  breakMinutes: number;
  unpaidBreakMinutes: number;
  overtimeMinutes: number;
  lateMinutes: number;
  earlyDepartureMinutes: number;
  scheduledMinutes: number;
  sessions: CalcSession[];
  isOpen: boolean;
  correctionApplied: boolean;
  calculationVersion: number;
}

const FALLBACK_FULL_DAY = 480;
const MIN = 60_000;
interface Brk {
  start: Date;
  end?: Date;
}
interface Sess {
  start: Date;
  end?: Date;
  breaks: Brk[];
}

function buildSessions(events: CalcInput['events']): Sess[] {
  const sessions: Sess[] = [];
  let cur: Sess | null = null;
  for (const e of [...events].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    if (e.type === 'CHECK_IN') {
      if (!cur) {
        cur = { start: e.at, breaks: [] };
        sessions.push(cur);
      }
    } else if (!cur) {
      continue; // orphan event: ignored (service never produces these)
    } else if (e.type === 'BREAK_START') {
      if (!cur.breaks.some((b) => !b.end)) cur.breaks.push({ start: e.at });
    } else if (e.type === 'BREAK_END') {
      const open = cur.breaks.find((b) => !b.end);
      if (open) open.end = e.at;
    } else if (e.type === 'CHECK_OUT') {
      const open = cur.breaks.find((b) => !b.end);
      if (open) open.end = e.at;
      cur.end = e.at;
      cur = null;
    }
  }
  return sessions;
}

/**
 * Deterministic daily attendance calculation. Pure: same input -> same output (`now` is an input).
 * No salary or statutory logic lives here.
 */
export function calculateDay(input: CalcInput): CalcResult {
  const { workDate, tz, shift, now } = input;
  const sessions = buildSessions(input.events);

  // --- approved corrections: override boundary punches only -------------------------------
  let correctionApplied = false;
  const co = input.corrections.reduce<{ checkIn?: Date; checkOut?: Date }>(
    (acc, c) => ({ checkIn: c.checkIn ?? acc.checkIn, checkOut: c.checkOut ?? acc.checkOut }),
    {},
  );
  if (co.checkIn || co.checkOut) {
    correctionApplied = true;
    if (sessions.length === 0) {
      if (co.checkIn && co.checkOut)
        sessions.push({ start: co.checkIn, end: co.checkOut, breaks: [] });
    } else {
      const first = sessions[0]!;
      const last = sessions[sessions.length - 1]!;
      if (co.checkIn) first.start = co.checkIn;
      if (co.checkOut) {
        last.end = co.checkOut;
        last.breaks.forEach((b) => {
          if (!b.end) b.end = co.checkOut;
        });
      }
    }
  }

  // --- schedule context ------------------------------------------------------------------
  const weeklyOff = shift
    ? shift.weeklyOffDays.includes(dayOfWeek(workDate))
    : !input.tenantWorkweek.includes(dayOfWeek(workDate));
  const nonWorking = input.holiday || weeklyOff;
  const win = shift && !nonWorking ? shiftWindow(workDate, shift, tz) : null;
  const durationMin = win ? Math.floor((win.end.getTime() - win.start.getTime()) / MIN) : 0;
  const breakPolicy = shift?.breakPolicy ?? {
    type: 'RECORDED' as const,
    paidAllowanceMinutes: 0,
    autoDeductMinutes: 0,
  };
  const expectedBreak =
    breakPolicy.type === 'AUTO_DEDUCT'
      ? breakPolicy.autoDeductMinutes
      : (breakPolicy.expectedUnpaidMinutes ?? 0);
  const baseScheduled = win ? Math.max(0, durationMin - expectedBreak) : 0;
  const leaveFactor = input.leave === 'FULL' ? 0 : input.leave === 'HALF' ? 0.5 : 1;
  const scheduledMinutes = Math.floor(baseScheduled * leaveFactor);

  // --- durations --------------------------------------------------------------------------
  const staleMs = input.maxOpenSessionHours * 60 * MIN;
  let grossMs = 0;
  let recordedBreakMs = 0;
  let isOpen = false;
  let staleOpen = false;
  const outSessions: CalcSession[] = [];
  for (const s of sessions) {
    let end = s.end;
    let open = false;
    if (!end) {
      if (now.getTime() - s.start.getTime() > staleMs) {
        staleOpen = true;
        open = true;
        end = undefined;
      } else {
        isOpen = true;
        open = true;
        end = now;
      }
    }
    const brMs = s.breaks.reduce((sum, b) => {
      const bEnd = b.end ?? end ?? s.start;
      return (
        sum + Math.max(0, Math.min(bEnd.getTime(), (end ?? bEnd).getTime()) - b.start.getTime())
      );
    }, 0);
    recordedBreakMs += end ? brMs : 0;
    if (end) grossMs += Math.max(0, end.getTime() - s.start.getTime());
    outSessions.push({ start: s.start, end: s.end, breakMinutes: Math.floor(brMs / MIN), open });
  }

  let unpaidBreakMs: number;
  if (breakPolicy.type === 'AUTO_DEDUCT')
    unpaidBreakMs = grossMs > 0 ? Math.min(grossMs, breakPolicy.autoDeductMinutes * MIN) : 0;
  else unpaidBreakMs = Math.max(0, recordedBreakMs - breakPolicy.paidAllowanceMinutes * MIN);
  const workedMinutes = Math.max(0, Math.floor((grossMs - unpaidBreakMs) / MIN));

  const firstCheckIn = sessions[0]?.start;
  const closedSessions = sessions.filter((s) => s.end);
  const lastCheckOut = closedSessions.length
    ? closedSessions[closedSessions.length - 1]!.end
    : undefined;

  // --- late / early / overtime ------------------------------------------------------------
  let lateMinutes = 0;
  let earlyDepartureMinutes = 0;
  if (win && shift && input.leave !== 'HALF') {
    if (firstCheckIn) {
      const lateMs = firstCheckIn.getTime() - win.start.getTime();
      if (lateMs > shift.graceMinutes * MIN) lateMinutes = Math.floor(lateMs / MIN);
    }
    if (lastCheckOut && !isOpen && !staleOpen) {
      const earlyMs = win.end.getTime() - lastCheckOut.getTime();
      if (earlyMs > shift.earlyDepartureGraceMinutes * MIN)
        earlyDepartureMinutes = Math.floor(earlyMs / MIN);
    }
  }
  let overtimeMinutes = 0;
  const ot = shift?.overtimePolicy;
  if (ot?.enabled && !isOpen && !staleOpen) {
    const extra = Math.max(0, workedMinutes - scheduledMinutes);
    if (extra > 0 && extra >= ot.thresholdMinutes)
      overtimeMinutes = ot.maxMinutesPerDay ? Math.min(extra, ot.maxMinutesPerDay) : extra;
  }

  // --- status -----------------------------------------------------------------------------
  // Default full-day requirement = scheduled minutes minus the grace allowances, so arriving/leaving within grace
  // never downgrades a day. Explicit minFullDayMinutes / minHalfDayMinutes on the shift override these defaults.
  const defaultFull = baseScheduled
    ? Math.max(
        1,
        baseScheduled - (shift?.graceMinutes ?? 0) - (shift?.earlyDepartureGraceMinutes ?? 0),
      )
    : FALLBACK_FULL_DAY;
  const defaultHalf = Math.floor((baseScheduled || FALLBACK_FULL_DAY) / 2);
  const leaveScale = input.leave === 'HALF' ? 0.5 : 1;
  const fullDay = Math.floor((shift?.minFullDayMinutes ?? defaultFull) * leaveScale);
  const halfDay = Math.floor((shift?.minHalfDayMinutes ?? defaultHalf) * leaveScale);
  const hasSession = sessions.length > 0;
  const today = localDate(now, tz);
  let status: DayStatus | null;
  if (hasSession && staleOpen) status = 'INCOMPLETE';
  else if (input.holiday) status = 'HOLIDAY';
  else if (weeklyOff) status = 'WEEKLY_OFF';
  else if (input.leave === 'FULL') status = 'ON_LEAVE';
  else if (hasSession && isOpen)
    status = 'PRESENT'; // in progress; provisional
  else if (hasSession)
    status =
      workedMinutes >= fullDay ? 'PRESENT' : workedMinutes >= halfDay ? 'HALF_DAY' : 'ABSENT';
  else if (co.checkIn || co.checkOut)
    status = 'INCOMPLETE'; // correction supplied only one boundary and there are no punches
  else if (input.leave === 'HALF') status = 'HALF_DAY';
  else status = workDate < today ? 'ABSENT' : null;

  return {
    status,
    firstCheckIn,
    lastCheckOut,
    workedMinutes,
    breakMinutes: Math.floor(recordedBreakMs / MIN),
    unpaidBreakMinutes: Math.floor(unpaidBreakMs / MIN),
    overtimeMinutes,
    lateMinutes,
    earlyDepartureMinutes,
    scheduledMinutes,
    sessions: outSessions,
    isOpen,
    correctionApplied,
    calculationVersion: CALCULATION_VERSION,
  };
}

export { addDays };
