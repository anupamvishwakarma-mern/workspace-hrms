import type { Types } from 'mongoose';
import { Tenant } from '../models/tenant.model';
import { recordDbEvent } from '../models/tenantDbEvent.model';
import type { HostingError } from './errors';
import type { DatabaseHealth } from './types';

const HEALTHY_RECHECK_MS_FALLBACK = 4 * 60_000;

/**
 * Records the outcome of a connection attempt/check for a customer-owned tenant in the control-plane database.
 * Failures back off exponentially (the health job honours `nextCheckAt`) so an unreachable customer database is not
 * hammered. A health change is logged as an event. Never throws: monitoring must not break the caller.
 */
export async function recordConnectionResult(
  tenantId: Types.ObjectId | string,
  result: { ok: true } | { ok: false; error: HostingError },
  opts: { recheckMs?: number; maxBackoffMs?: number; actorUserId?: unknown } = {},
): Promise<DatabaseHealth | undefined> {
  try {
    const now = new Date();
    const prev = await Tenant.findById(tenantId).select('database.health database.consecutiveFailures').lean();
    if (!prev) return undefined;
    const before = (prev.database?.health ?? 'UNKNOWN') as DatabaseHealth;
    let health: DatabaseHealth;
    if (result.ok) {
      health = 'HEALTHY';
      await Tenant.updateOne(
        { _id: tenantId },
        {
          $set: {
            'database.health': health,
            'database.lastConnectionCheck': now,
            'database.lastSuccessfulConnection': now,
            'database.consecutiveFailures': 0,
            'database.nextCheckAt': new Date(now.getTime() + (opts.recheckMs ?? HEALTHY_RECHECK_MS_FALLBACK)),
          },
          $unset: { 'database.lastError': '', 'database.lastErrorCode': '' },
        },
      );
    } else {
      const failures = (prev.database?.consecutiveFailures ?? 0) + 1;
      health = failures >= 3 ? 'UNREACHABLE' : 'DEGRADED';
      const backoff = Math.min(60_000 * 2 ** (failures - 1), opts.maxBackoffMs ?? 3_600_000);
      await Tenant.updateOne(
        { _id: tenantId },
        {
          $set: {
            'database.health': health,
            'database.lastConnectionCheck': now,
            'database.lastFailureAt': now,
            'database.lastError': result.error.message.slice(0, 300),
            'database.lastErrorCode': result.error.hostingCode,
            'database.consecutiveFailures': failures,
            'database.nextCheckAt': new Date(now.getTime() + backoff),
          },
        },
      );
    }
    if (health !== before)
      await recordDbEvent({
        tenantId,
        type: 'HEALTH_CHANGED',
        ok: result.ok,
        actorUserId: opts.actorUserId,
        detail: { from: before, to: health, ...(result.ok ? {} : { code: result.error.hostingCode }) },
      });
    return health;
  } catch {
    return undefined;
  }
}
