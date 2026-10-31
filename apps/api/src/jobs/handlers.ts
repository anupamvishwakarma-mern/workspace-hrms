import { DateTime } from 'luxon';
import type { Logger } from 'pino';
import type { Types } from 'mongoose';
import { AttendanceDay } from '../database/models/attendanceDay.model';
import { AttendanceEvent } from '../database/models/attendanceEvent.model';
import { AttendanceException } from '../database/models/attendanceException.model';
import { PunchPhoto } from '../database/models/punchPhoto.model';
import { EmployeeDocument } from '../database/models/employeeDocument.model';
import { Tenant } from '../database/models/tenant.model';
import { tenantDatabaseManager } from '../database/hosting/manager';
import { TENANT_DB_FIELDS } from '../database/hosting/source';
import type { Env } from '../config/env';
import { escalateOverdue } from '../modules/approvals/approvals.service';
import { notifyEmployee } from '../modules/notifications/push.service';
import { getStorage } from '../modules/documents/storage';
import { loadTenant, recalculateDay } from '../modules/attendance/attendance.service';
import { addDays, isValidTimezone, localDate } from '../modules/attendance/dates';
import { ensureDays, scopedEmployees } from '../modules/reports/reports.service';

export interface SweepOptions {
  /** Days back from yesterday to (re)check, so a missed run self-heals. */
  lookbackDays?: number;
  /** Only process tenants whose local hour is one of these (the queue passes [1, 2]). Omit to process all. */
  localHours?: number[];
  log?: Pick<Logger, 'error' | 'info'>;
}
export interface SweepResult {
  tenants: number;
  skipped: number;
  failed: number;
  staleRecalculated: number;
}

/**
 * Nightly attendance sweep, safe to run at any time and any number of times:
 *  1. materialises ABSENT/ON_LEAVE/HOLIDAY/WEEKLY_OFF rows for past days nobody calculated;
 *  2. recalculates days whose punch session was left open past the policy limit (-> INCOMPLETE).
 * One tenant failing never stops the others.
 */
export async function dailyAttendanceSweep(
  now: Date,
  opts: SweepOptions = {},
): Promise<SweepResult> {
  const lookback = opts.lookbackDays ?? 3;
  const out: SweepResult = { tenants: 0, skipped: 0, failed: 0, staleRecalculated: 0 };
  const tenants = await Tenant.find({ status: 'ACTIVE' }).select(`_id timezone ${TENANT_DB_FIELDS}`).lean();
  for (const t of tenants) {
    try {
      // Resolves THIS company's database (managed or customer-owned); an unreachable one fails only this company.
      await tenantDatabaseManager.runInTenantDoc(t, async () => {
      if (!isValidTimezone(t.timezone)) throw new Error(`Invalid time zone: ${t.timezone}`);
      const localHour = DateTime.fromJSDate(now, { zone: t.timezone }).hour;
      if (opts.localHours && !opts.localHours.includes(localHour)) {
        out.skipped += 1;
        return;
      }
      const tenant = await loadTenant(t._id);
      const today = localDate(now, tenant.timezone);
      const yesterday = addDays(today, -1);
      const from = addDays(yesterday, -(lookback - 1));
      const employees = await scopedEmployees(tenant._id, undefined);
      for (let i = 0; i < employees.length; i += 200)
        await ensureDays(tenant, employees.slice(i, i + 200), from, yesterday, now);

      const stale = await AttendanceDay.find({
        tenantId: tenant._id,
        isOpen: true,
        workDate: { $lt: today },
      })
        .select('employeeId workDate')
        .lean();
      for (const d of stale) {
        await recalculateDay(tenant, d.employeeId, d.workDate, now);
        out.staleRecalculated += 1;
      }
      out.tenants += 1;
      });
    } catch (err) {
      out.failed += 1;
      opts.log?.error({ err, tenantId: String(t._id) }, 'daily sweep failed for tenant');
    }
  }
  return out;
}

/**
 * Retention for raw location data. Erases coordinates and accuracy from punches/exceptions older than
 * `retentionDays`; the event itself (type, server time, verification result, distance, risk flag) stays,
 * so the attendance ledger and its audit value are intact.
 *
 * This is the ONE place the immutable-ledger guard is deliberately bypassed (native collection update,
 * $unset of two location fields only). It cannot touch times, types or any other field.
 */
export async function purgeLocationData(now: Date, retentionDays: number) {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
  const update = {
    $unset: { location: '', locationAccuracyMeters: '' },
    $set: { locationPurgedAt: now },
  };
  const { results, failed } = await tenantDatabaseManager.forEachTenant(async (t) => {
    const [events, exceptions] = await Promise.all([
      AttendanceEvent.collection.updateMany(
        { tenantId: t._id, occurredAt: { $lt: cutoff }, location: { $exists: true } },
        update,
      ),
      AttendanceException.collection.updateMany(
        { tenantId: t._id, occurredAt: { $lt: cutoff }, location: { $exists: true }, status: { $ne: 'PENDING' } }, // never from an undecided request
        update,
      ),
    ]);
    return { events: events.modifiedCount, exceptions: exceptions.modifiedCount };
  });
  return {
    events: results.reduce((n, r) => n + r.value.events, 0),
    exceptions: results.reduce((n, r) => n + r.value.exceptions, 0),
    cutoff,
    failed,
  };
}

/** Uploads that were started but never confirmed within an hour: remove any stray object and mark deleted. */
async function cleanupStaleUploadsInDb(env: Env, tenantId: unknown, now: Date, maxAgeMinutes: number) {
  const storage = getStorage(env);
  const cutoff = new Date(now.getTime() - maxAgeMinutes * 60_000);
  const stale = await EmployeeDocument.find({
    tenantId,
    status: 'PENDING_UPLOAD',
    createdAt: { $lt: cutoff },
  })
    .select('storageKey')
    .limit(500)
    .lean();
  let removed = 0;
  for (const d of stale) {
    if (storage) await storage.remove(d.storageKey).catch(() => undefined);
    await EmployeeDocument.updateOne(
      { _id: d._id, status: 'PENDING_UPLOAD' },
      { $set: { status: 'DELETED', deletedAt: now } },
    );
    removed += 1;
  }
  const stalePhotos = await PunchPhoto.find({
    tenantId,
    status: 'PENDING_UPLOAD',
    createdAt: { $lt: cutoff },
  })
    .select('storageKey')
    .limit(500)
    .lean();
  for (const p of stalePhotos) {
    if (storage) await storage.remove(p.storageKey).catch(() => undefined);
    await PunchPhoto.updateOne(
      { _id: p._id, status: 'PENDING_UPLOAD' },
      { $set: { status: 'DELETED', deletedAt: now } },
    );
    removed += 1;
  }
  return { removed };
}

/**
 * Retention for punch proof photos: after `retentionDays` the image is deleted from storage and the photo record is
 * marked DELETED. The punch itself (type, server time, verification) is kept; it just no longer has a viewable photo.
 */
async function purgePunchPhotosInDb(env: Env, tenantId: unknown, now: Date, retentionDays: number) {
  const storage = getStorage(env);
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
  const old = await PunchPhoto.find({ tenantId, status: 'USED', usedAt: { $lt: cutoff } })
    .select('storageKey')
    .limit(500)
    .lean();
  let purged = 0;
  for (const p of old) {
    if (!storage) break; // cannot delete the image without storage: keep the record so it is retried later
    await storage.remove(p.storageKey);
    await PunchPhoto.updateOne(
      { _id: p._id, status: 'USED' },
      { $set: { status: 'DELETED', deletedAt: now } },
    );
    purged += 1;
  }
  return { purged, cutoff };
}

/** Runs the stale-upload cleanup in every company's own database (managed or customer-owned). */
export async function cleanupStaleUploads(env: Env, now: Date, maxAgeMinutes = 60) {
  const { results, failed } = await tenantDatabaseManager.forEachTenant((t) =>
    cleanupStaleUploadsInDb(env, t._id, now, maxAgeMinutes),
  );
  return { removed: results.reduce((n, r) => n + r.value.removed, 0), failed };
}

/** Runs the photo retention purge in every company's own database (managed or customer-owned). */
export async function purgePunchPhotos(env: Env, now: Date, retentionDays: number) {
  const { results, failed } = await tenantDatabaseManager.forEachTenant((t) =>
    purgePunchPhotosInDb(env, t._id, now, retentionDays),
  );
  return {
    purged: results.reduce((n, r) => n + r.value.purged, 0),
    cutoff: new Date(now.getTime() - retentionDays * 86_400_000),
    failed,
  };
}

/**
 * Escalates overdue approval steps in every company's own database and tells the people who just became approvers.
 * Idempotent: a step is escalated at most once.
 */
export async function escalateApprovals(env: Env, now: Date) {
  const { results, failed } = await tenantDatabaseManager.forEachTenant(
    async (t) => {
      const r = await escalateOverdue(t._id as Types.ObjectId, now);
      for (const n of r.notify)
        notifyEmployee(env, t._id as Types.ObjectId, n.employeeId as never, {
          title: 'Approval needs attention',
          body: `${n.title} has been waiting too long and was escalated to you.`,
          data: { type: 'approval', requestId: String(n.requestId) },
        });
      return { escalated: r.escalated };
    },
    { filter: { status: 'ACTIVE' } },
  );
  return { escalated: results.reduce((n, r) => n + r.value.escalated, 0), failed };
}
