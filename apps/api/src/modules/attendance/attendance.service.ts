import mongoose, { Types, type ClientSession } from 'mongoose';
import { AttendanceCorrection } from '../../database/models/attendanceCorrection.model';
import { AttendanceDay } from '../../database/models/attendanceDay.model';
import { AttendanceEvent } from '../../database/models/attendanceEvent.model';
import { AttendanceException } from '../../database/models/attendanceException.model';
import { Counter } from '../../database/models/counter.model';
import { Employee } from '../../database/models/employee.model';
import { LeaveRequest } from '../../database/models/leaveRequest.model';
import { Holiday } from '../../database/models/holiday.model';
import { Tenant } from '../../database/models/tenant.model';
import { WorkLocation } from '../../database/models/workLocation.model';
import type { Env } from '../../config/env';
import { AppError } from '../../utils/errors';
import { shiftForDate, type ShiftLean } from '../shifts/shifts.service';
import { calculateDay, type CalcResult, type EventType, type ShiftPolicy } from './calculation';
import { addDays, localDate, shiftWindow } from './dates';
import { claimPhoto, verifyPhoto } from './photos';
import { evaluateLocation, type Fence, type GeoFailure, type Reading } from './geo';

export type AttendanceState = 'OFF' | 'WORKING' | 'ON_BREAK';

const TRANSITIONS: Record<AttendanceState, Partial<Record<EventType, AttendanceState>>> = {
  OFF: { CHECK_IN: 'WORKING' },
  WORKING: { BREAK_START: 'ON_BREAK', CHECK_OUT: 'OFF' },
  ON_BREAK: { BREAK_END: 'WORKING' },
};

const ACTION_FOR: Record<EventType, string> = {
  CHECK_IN: 'check-in',
  CHECK_OUT: 'check-out',
  BREAK_START: 'break-start',
  BREAK_END: 'break-end',
};

export function invalidTransitionMessage(state: AttendanceState, type: EventType): string {
  if (state === 'OFF') return type === 'CHECK_IN' ? '' : 'You are not checked in';
  if (state === 'WORKING')
    return type === 'CHECK_IN'
      ? 'You are already checked in'
      : type === 'BREAK_END'
        ? 'You are not on a break'
        : '';
  return type === 'CHECK_OUT'
    ? 'End your break before checking out'
    : type === 'BREAK_START'
      ? 'You are already on a break'
      : type === 'CHECK_IN'
        ? 'You are already checked in'
        : '';
}

export function allowedActions(state: AttendanceState) {
  return (Object.keys(ACTION_FOR) as EventType[]).map((type) => {
    const enabled = !!TRANSITIONS[state][type];
    return {
      action: ACTION_FOR[type],
      eventType: type,
      enabled,
      reason: enabled ? undefined : invalidTransitionMessage(state, type),
    };
  });
}

export interface TenantInfo {
  _id: Types.ObjectId;
  timezone: string;
  workweek: number[];
  settings: {
    attendance: {
      requireGeofence: boolean;
      maxAccuracyMeters: number;
      allowSelfApproval: boolean;
      allowGpsExceptions: boolean;
      requirePhoto: boolean;
      maxOpenSessionHours: number;
    };
  };
}
export async function loadTenant(
  tenantId: Types.ObjectId,
  session?: ClientSession,
): Promise<TenantInfo> {
  const t = await Tenant.findById(tenantId)
    .session(session ?? null)
    .lean();
  if (!t) throw AppError.notFound('Company not found');
  const a = t.settings?.attendance;
  return {
    _id: t._id,
    timezone: t.timezone,
    workweek: t.workweek,
    settings: {
      attendance: {
        requireGeofence: a?.requireGeofence ?? true,
        maxAccuracyMeters: a?.maxAccuracyMeters ?? 100,
        allowSelfApproval: a?.allowSelfApproval ?? false,
        allowGpsExceptions: a?.allowGpsExceptions ?? true,
        requirePhoto: a?.requirePhoto ?? false,
        maxOpenSessionHours: a?.maxOpenSessionHours ?? 16,
      },
    },
  };
}

export const toPolicy = (s: ShiftLean): ShiftPolicy => ({
  startTime: s.startTime as string,
  endTime: s.endTime as string,
  graceMinutes: (s.graceMinutes as number) ?? 0,
  earlyDepartureGraceMinutes: (s.earlyDepartureGraceMinutes as number) ?? 0,
  minFullDayMinutes: s.minFullDayMinutes as number | undefined,
  minHalfDayMinutes: s.minHalfDayMinutes as number | undefined,
  breakPolicy: {
    type: 'RECORDED',
    paidAllowanceMinutes: 0,
    autoDeductMinutes: 0,
    expectedUnpaidMinutes: 0,
    ...((s.breakPolicy as object) ?? {}),
  } as ShiftPolicy['breakPolicy'],
  overtimePolicy: {
    enabled: false,
    thresholdMinutes: 0,
    ...((s.overtimePolicy as object) ?? {}),
  } as ShiftPolicy['overtimePolicy'],
  weeklyOffDays: (s.weeklyOffDays as number[]) ?? [0],
});

/* ------------------------------ state ------------------------------ */

export interface StateInfo {
  state: AttendanceState;
  openSince?: Date;
  workDate?: string;
  lastEventAt?: Date;
  stale?: boolean;
  staleWorkDate?: string;
}

export async function currentState(
  tenantId: Types.ObjectId,
  employeeId: Types.ObjectId,
  now: Date,
  maxOpenHours: number,
  session?: ClientSession,
): Promise<StateInfo> {
  const last = await AttendanceEvent.findOne({ tenantId, employeeId })
    .sort({ occurredAt: -1, _id: -1 })
    .session(session ?? null)
    .lean();
  if (!last || last.eventType === 'CHECK_OUT')
    return { state: 'OFF', lastEventAt: last?.occurredAt };
  const open = await AttendanceEvent.findOne({
    tenantId,
    employeeId,
    eventType: 'CHECK_IN',
    occurredAt: { $lte: last.occurredAt },
  })
    .sort({ occurredAt: -1, _id: -1 })
    .session(session ?? null)
    .lean();
  const openSince = open?.occurredAt ?? last.occurredAt;
  const workDate = open?.workDate ?? last.workDate;
  if (now.getTime() - openSince.getTime() > maxOpenHours * 3_600_000)
    return {
      state: 'OFF',
      stale: true,
      staleWorkDate: workDate,
      openSince,
      lastEventAt: last.occurredAt,
    };
  return {
    state: last.eventType === 'BREAK_START' ? 'ON_BREAK' : 'WORKING',
    openSince,
    workDate,
    lastEventAt: last.occurredAt,
  };
}

/** Which shift instance (workDate) a new check-in at `at` belongs to. Handles overnight shifts and timezones. */
export async function resolveCheckInWorkDate(
  tenant: TenantInfo,
  employeeId: Types.ObjectId,
  at: Date,
): Promise<{ workDate: string; shift: ShiftLean | null }> {
  const base = localDate(at, tenant.timezone);
  const PRE_MS = 4 * 3_600_000;
  const POST_MS = 4 * 3_600_000;
  let best: { workDate: string; shift: ShiftLean; dist: number } | undefined;
  for (const d of [addDays(base, -1), base, addDays(base, 1)]) {
    const shift = await shiftForDate(tenant._id, employeeId, d);
    if (!shift) continue;
    const w = shiftWindow(
      d,
      shift as unknown as { startTime: string; endTime: string },
      (shift.timezone as string | undefined) ?? tenant.timezone,
    );
    if (at.getTime() < w.start.getTime() - PRE_MS || at.getTime() > w.end.getTime() + POST_MS)
      continue;
    const dist = Math.abs(at.getTime() - w.start.getTime());
    if (!best || dist < best.dist) best = { workDate: d, shift, dist };
  }
  if (best) return { workDate: best.workDate, shift: best.shift };
  return { workDate: base, shift: await shiftForDate(tenant._id, employeeId, base) };
}

/* --------------------------- day calculation --------------------------- */

/**
 * Approved leave covering a day. A full-day approved request wins over a half-day one if both
 * somehow exist (overlaps are rejected at request time, so this is defence in depth).
 */
export async function resolveLeave(
  tenantId: Types.ObjectId,
  employeeId: Types.ObjectId,
  workDate: string,
  session?: ClientSession,
): Promise<'FULL' | 'HALF' | null> {
  const approved = await LeaveRequest.find({
    tenantId,
    employeeId,
    status: 'APPROVED',
    startDate: { $lte: workDate },
    endDate: { $gte: workDate },
  })
    .select('halfDay')
    .session(session ?? null)
    .lean();
  if (approved.length === 0) return null;
  return approved.some((r) => !r.halfDay) ? 'FULL' : 'HALF';
}

export async function holidayOn(
  tenantId: Types.ObjectId,
  workDate: string,
  locationIds: Types.ObjectId[],
  session?: ClientSession,
): Promise<boolean> {
  const n = await Holiday.countDocuments({
    tenantId,
    date: workDate,
    status: 'ACTIVE',
    $or: [
      { workLocationId: null },
      { workLocationId: { $exists: false } },
      ...(locationIds.length ? [{ workLocationId: { $in: locationIds } }] : []),
    ],
  }).session(session ?? null);
  return n > 0;
}

export async function computeDay(
  tenant: TenantInfo,
  employeeId: Types.ObjectId,
  workDate: string,
  now: Date,
  session?: ClientSession,
) {
  const employee = await Employee.findOne({ _id: employeeId, tenantId: tenant._id })
    .select('workLocationIds')
    .session(session ?? null)
    .lean();
  const shift = await shiftForDate(tenant._id, employeeId, workDate);
  const tz = (shift?.timezone as string | undefined) ?? tenant.timezone;
  const [events, corrections, holiday, leave, pending] = await Promise.all([
    AttendanceEvent.find({ tenantId: tenant._id, employeeId, workDate })
      .sort({ occurredAt: 1, _id: 1 })
      .session(session ?? null)
      .lean(),
    AttendanceCorrection.find({ tenantId: tenant._id, employeeId, workDate, status: 'APPROVED' })
      .sort({ reviewedAt: 1 })
      .session(session ?? null)
      .lean(),
    holidayOn(tenant._id, workDate, employee?.workLocationIds ?? [], session),
    resolveLeave(tenant._id, employeeId, workDate, session),
    AttendanceCorrection.exists({
      tenantId: tenant._id,
      employeeId,
      workDate,
      status: 'PENDING',
    }).session(session ?? null),
  ]);
  const result = calculateDay({
    workDate,
    tz,
    shift: shift ? toPolicy(shift) : null,
    tenantWorkweek: tenant.workweek,
    events: events.map((e) => ({ type: e.eventType, at: e.occurredAt })),
    corrections: corrections.map((c) => ({
      checkIn: c.requestedChanges?.checkIn ?? undefined,
      checkOut: c.requestedChanges?.checkOut ?? undefined,
    })),
    holiday,
    leave,
    now,
    maxOpenSessionHours: tenant.settings.attendance.maxOpenSessionHours,
  });
  return {
    result,
    shiftId: shift?._id,
    events,
    correctionStatus: (pending ? 'PENDING' : result.correctionApplied ? 'APPLIED' : 'NONE') as
      'PENDING' | 'APPLIED' | 'NONE',
  };
}

/** Deterministically recomputes and persists the AttendanceDay summary. Safe to call repeatedly. */
export async function recalculateDay(
  tenant: TenantInfo,
  employeeId: Types.ObjectId,
  workDate: string,
  now: Date,
  session?: ClientSession,
): Promise<CalcResult> {
  const { result, shiftId, correctionStatus } = await computeDay(
    tenant,
    employeeId,
    workDate,
    now,
    session,
  );
  if (result.status === null) return result;
  const { status, ...rest } = result;
  await AttendanceDay.findOneAndUpdate(
    { tenantId: tenant._id, employeeId, workDate },
    { $set: { ...rest, status, shiftId, correctionStatus } },
    { upsert: true, session, new: true },
  );
  return result;
}

/* ---------------------------- locking & txns ---------------------------- */

const lockId = (tenantId: Types.ObjectId, employeeId: Types.ObjectId) =>
  `attendance:${tenantId}:${employeeId}`;

/** Serialises all attendance writes for one employee (concurrent writers hit a write-conflict and retry). */
export async function withEmployeeTransaction<T>(
  tenantId: Types.ObjectId,
  employeeId: Types.ObjectId,
  fn: (session: ClientSession) => Promise<T>,
): Promise<T> {
  await Counter.updateOne(
    { _id: lockId(tenantId, employeeId) },
    { $setOnInsert: { seq: 0 } },
    { upsert: true },
  ).catch(() => undefined);
  const session = await mongoose.startSession();
  try {
    let out!: T;
    await session.withTransaction(async () => {
      await Counter.updateOne(
        { _id: lockId(tenantId, employeeId) },
        { $inc: { seq: 1 } },
        { session },
      );
      out = await fn(session);
    });
    return out;
  } finally {
    await session.endSession();
  }
}

/* ------------------------------ geofence ------------------------------ */

export async function loadFences(
  tenantId: Types.ObjectId,
  assigned: Types.ObjectId[],
): Promise<Fence[]> {
  const locs = await WorkLocation.find({
    tenantId,
    status: 'ACTIVE',
    allowedAttendanceMethods: 'GEOFENCE',
    ...(assigned.length ? { _id: { $in: assigned } } : {}),
  }).lean();
  return locs.map((l) => ({
    id: String(l._id),
    name: l.name,
    latitude: l.location!.coordinates[1]!,
    longitude: l.location!.coordinates[0]!,
    radiusMeters: l.radiusMeters,
  }));
}

export const FAILURE_MESSAGES: Record<GeoFailure, string> = {
  LOCATION_REQUIRED: 'Location is required to record attendance',
  POOR_ACCURACY: 'GPS accuracy is too low to verify your position',
  NO_GEOFENCE_CONFIGURED: 'No office location is configured for you; contact HR',
  OUTSIDE_GEOFENCE: 'You are outside the permitted attendance area',
};

/* -------------------------------- punch -------------------------------- */

export interface AppendParams {
  tenant: TenantInfo;
  employeeId: Types.ObjectId;
  type: EventType;
  at: Date;
  idempotencyKey: string;
  source: 'MOBILE' | 'WEB' | 'EXCEPTION';
  location?: Reading;
  clientTimestamp?: Date;
  deviceId?: string;
  verification: {
    status: 'VERIFIED' | 'NOT_REQUIRED' | 'EXCEPTION_APPROVED';
    method?: string;
    distanceMeters?: number;
    mockLocationDetected: boolean;
  };
  workLocationId?: string;
  exceptionId?: Types.ObjectId;
  photoId?: Types.ObjectId;
  /** Exception approvals must not rewrite history: refuse if later punches exist. */
  requireNoLaterEvents?: boolean;
}

export async function appendEvent(p: AppendParams, session: ClientSession) {
  const { tenant, employeeId } = p;
  const maxOpen = tenant.settings.attendance.maxOpenSessionHours;
  let at = p.at;
  const state = await currentState(tenant._id, employeeId, at, maxOpen, session);
  if (state.lastEventAt && at < state.lastEventAt) {
    if (p.requireNoLaterEvents)
      throw AppError.conflict(
        'Later punches already exist for this employee; submit an attendance correction instead',
      );
    at = state.lastEventAt; // never let the ledger go backwards if clocks disagree
  }
  if (!TRANSITIONS[state.state][p.type]) {
    throw new AppError(409, 'INVALID_TRANSITION', invalidTransitionMessage(state.state, p.type), {
      state: state.state,
      allowedActions: allowedActions(state.state)
        .filter((a) => a.enabled)
        .map((a) => a.action),
    });
  }
  let workDate: string;
  let shiftId: Types.ObjectId | undefined;
  if (p.type === 'CHECK_IN') {
    const r = await resolveCheckInWorkDate(tenant, employeeId, at);
    workDate = r.workDate;
    shiftId = r.shift?._id;
  } else {
    workDate = state.workDate!;
    shiftId = (await shiftForDate(tenant._id, employeeId, workDate))?._id;
  }
  const loc = p.location;
  const [event] = await AttendanceEvent.create(
    [
      {
        tenantId: tenant._id,
        employeeId,
        eventType: p.type,
        occurredAt: at,
        receivedAt: p.at,
        clientTimestamp: p.clientTimestamp,
        workDate,
        shiftId,
        location: loc ? { type: 'Point', coordinates: [loc.longitude, loc.latitude] } : undefined,
        locationAccuracyMeters: loc?.accuracyMeters,
        workLocationId: p.workLocationId,
        verification: {
          status: p.verification.status,
          method: p.verification.method,
          distanceMeters: p.verification.distanceMeters,
          riskSignals: { mockLocationDetected: p.verification.mockLocationDetected },
        },
        deviceId: p.deviceId,
        idempotencyKey: p.idempotencyKey,
        source: p.source,
        exceptionId: p.exceptionId,
        photoId: p.photoId,
      },
    ],
    { session },
  );
  const day = await recalculateDay(tenant, employeeId, workDate, at, session);
  if (state.stale && state.staleWorkDate && state.staleWorkDate !== workDate)
    await recalculateDay(tenant, employeeId, state.staleWorkDate, at, session);
  const newState = TRANSITIONS[state.state][p.type]!;
  return { event: event!, day, state: newState, workDate };
}

export interface PunchInput {
  type: EventType;
  idempotencyKey: string;
  location?: Reading;
  clientTimestamp?: Date;
  deviceId?: string;
  exceptionReason?: string;
  photoId?: string;
  source: 'MOBILE' | 'WEB';
}

export type PunchOutcome =
  | {
      kind: 'RECORDED';
      replayed: boolean;
      event: Record<string, unknown> & { _id: Types.ObjectId };
      state: AttendanceState;
    }
  | {
      kind: 'EXCEPTION';
      replayed: boolean;
      exception: Record<string, unknown> & { _id: Types.ObjectId };
    };

export async function punch(
  tenantId: Types.ObjectId,
  employeeId: Types.ObjectId,
  input: PunchInput,
  now: Date,
  env: Env,
): Promise<PunchOutcome> {
  const employee = await Employee.findOne({ _id: employeeId, tenantId }).lean();
  if (!employee) throw AppError.forbidden('No employee profile is linked to your account');
  if (!['ACTIVE', 'NOTICE_PERIOD'].includes(employee.employmentStatus))
    throw AppError.forbidden('Your employment status does not allow attendance');
  const tenant = await loadTenant(tenantId);
  const maxOpen = tenant.settings.attendance.maxOpenSessionHours;

  // 1. idempotency: a retried request returns the original outcome and never creates a second event
  const prior = await AttendanceEvent.findOne({
    tenantId,
    employeeId,
    idempotencyKey: input.idempotencyKey,
  }).lean();
  if (prior) {
    if (prior.eventType !== input.type)
      throw new AppError(
        409,
        'IDEMPOTENCY_KEY_REUSED',
        'This idempotency key was used for a different action',
      );
    const st = await currentState(tenantId, employeeId, now, maxOpen);
    return { kind: 'RECORDED', replayed: true, event: prior as never, state: st.state };
  }
  const priorEx = await AttendanceException.findOne({
    tenantId,
    employeeId,
    idempotencyKey: input.idempotencyKey,
  }).lean();
  if (priorEx) return { kind: 'EXCEPTION', replayed: true, exception: priorEx as never };

  // 2. state machine (read-only pre-check for a fast, clear error; re-validated inside the transaction)
  const st = await currentState(tenantId, employeeId, now, maxOpen);
  if (!TRANSITIONS[st.state][input.type]) {
    throw new AppError(409, 'INVALID_TRANSITION', invalidTransitionMessage(st.state, input.type), {
      state: st.state,
      allowedActions: allowedActions(st.state)
        .filter((a) => a.enabled)
        .map((a) => a.action),
    });
  }

  // 2b. proof photo: required for check in/out when the company asks for it; always verified when sent
  const photoNeeded =
    tenant.settings.attendance.requirePhoto &&
    (input.type === 'CHECK_IN' || input.type === 'CHECK_OUT');
  if (photoNeeded && !input.photoId)
    throw new AppError(422, 'PHOTO_REQUIRED', 'A photo is required to record this punch', {
      photoRequired: true,
    });
  const photoId = input.photoId
    ? (await verifyPhoto(env, tenantId, employeeId, input.photoId))._id
    : undefined;

  // 3. geofence / GPS policy (server decides; client never self-verifies)
  const fences = await loadFences(tenantId, employee.workLocationIds ?? []);
  const verdict = evaluateLocation(
    employee.attendanceMode ?? 'OFFICE',
    tenant.settings.attendance,
    input.location,
    fences,
  );
  if (!verdict.ok) {
    const failure = verdict.failure!;
    const canRequestException = tenant.settings.attendance.allowGpsExceptions;
    if (!canRequestException || !input.exceptionReason) {
      throw new AppError(422, failure, FAILURE_MESSAGES[failure], {
        exceptionAllowed: canRequestException,
        distanceMeters: verdict.distanceMeters,
        maxAccuracyMeters: tenant.settings.attendance.maxAccuracyMeters,
      });
    }
    const ex = await AttendanceException.create({
      tenantId,
      employeeId,
      eventType: input.type,
      occurredAt: now,
      clientTimestamp: input.clientTimestamp,
      failure,
      distanceMeters: verdict.distanceMeters,
      locationAccuracyMeters: input.location?.accuracyMeters,
      location: input.location
        ? { type: 'Point', coordinates: [input.location.longitude, input.location.latitude] }
        : undefined,
      workLocationId: verdict.workLocationId,
      mockLocationDetected: verdict.riskSignals.mockLocationDetected,
      deviceId: input.deviceId,
      employeeReason: input.exceptionReason,
      idempotencyKey: input.idempotencyKey,
      photoId,
    });
    if (photoId) await claimPhoto(tenantId, employeeId, photoId, now);
    return { kind: 'EXCEPTION', replayed: false, exception: ex.toObject() as never };
  }

  // 4. atomic append + recalculation
  try {
    const out = await withEmployeeTransaction(tenantId, employeeId, async (session) => {
      if (photoId) await claimPhoto(tenantId, employeeId, photoId, now, session);
      return appendEvent(
        {
          tenant,
          employeeId,
          type: input.type,
          at: now,
          idempotencyKey: input.idempotencyKey,
          source: input.source,
          location: input.location,
          clientTimestamp: input.clientTimestamp,
          deviceId: input.deviceId,
          workLocationId: verdict.workLocationId,
          verification: {
            status: verdict.method === 'NOT_REQUIRED' ? 'NOT_REQUIRED' : 'VERIFIED',
            method: verdict.method,
            distanceMeters: verdict.distanceMeters,
            mockLocationDetected: verdict.riskSignals.mockLocationDetected,
          },
          photoId,
        },
        session,
      );
    });
    return {
      kind: 'RECORDED',
      replayed: false,
      event: out.event.toObject() as never,
      state: out.state,
    };
  } catch (err) {
    // Two identical requests racing: whichever lost sees the winner's event (by key) and returns it as a replay.
    const winner = await AttendanceEvent.findOne({
      tenantId,
      employeeId,
      idempotencyKey: input.idempotencyKey,
    }).lean();
    if (winner && winner.eventType === input.type)
      return {
        kind: 'RECORDED',
        replayed: true,
        event: winner as never,
        state: (await currentState(tenantId, employeeId, now, maxOpen)).state,
      };
    throw err;
  }
}
