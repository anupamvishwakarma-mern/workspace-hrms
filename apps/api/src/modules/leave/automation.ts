import { DateTime } from 'luxon';
import type { Logger } from 'pino';
import { Tenant } from '../../database/models/tenant.model';
import { runInTenantDb } from '../../database/tenantContext';
import { isValidTimezone, localDate } from '../attendance/dates';
import { enabledModules } from '../tenants/modules';
import { runCarryForward, runMonthlyAccrual } from './ledger.service';

/** How many months back an enabled company is topped up, so a few days of downtime self-heal. */
export const MAX_CATCH_UP_MONTHS = 3;

/** 'YYYY-MM' of `today` shifted by `delta` months. */
function shiftMonth(ym: string, delta: number): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + delta;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}`;
}

/**
 * Months to credit, oldest first: from the month automation was switched on (never earlier), up to the current
 * local month, at most MAX_CATCH_UP_MONTHS back. Never a future month.
 */
export function monthsToRun(since: string | null | undefined, today: string): string[] {
  const current = today.slice(0, 7);
  if (!since || !/^\d{4}-\d{2}$/.test(since) || since > current) return [];
  const out: string[] = [];
  for (let back = MAX_CATCH_UP_MONTHS - 1; back >= 0; back--) {
    const m = shiftMonth(current, -back);
    if (m >= since) out.push(m);
  }
  return out;
}

/**
 * The year to carry forward, if now is the time: during January, for the year that just ended, and only if automation
 * was on before that year finished (switching it on in the new year does not retro-process last year).
 */
export function carryYearToRun(since: string | null | undefined, today: string): number | null {
  if (!since || !/^\d{4}-\d{2}$/.test(since)) return null;
  if (today.slice(5, 7) !== '01') return null;
  const fromYear = Number(today.slice(0, 4)) - 1;
  return since <= `${fromYear}-12` ? fromYear : null;
}

export interface LeaveAutomationResult {
  tenants: number;
  skipped: number;
  failed: number;
  accrualEntries: number;
  carryEntries: number;
}

/**
 * Credits monthly leave and carries leave forward for companies that switched on automatic leave
 * (settings.leave.autoAccrual). Idempotent: running it any number of times changes nothing after the first success.
 * One company failing never stops the others.
 */
export async function runLeaveAutomation(
  now: Date,
  opts: { localHours?: number[]; log?: Pick<Logger, 'error' | 'info'> } = {},
): Promise<LeaveAutomationResult> {
  const out: LeaveAutomationResult = { tenants: 0, skipped: 0, failed: 0, accrualEntries: 0, carryEntries: 0 };
  const tenants = await Tenant.find({ status: 'ACTIVE', 'settings.leave.autoAccrual': true })
    .select('_id timezone dbName modules settings.leave')
    .lean();
  for (const t of tenants) {
    try {
      if (!enabledModules(t.modules as string[] | undefined).includes('LEAVE') || !isValidTimezone(t.timezone)) {
        out.skipped += 1;
        continue;
      }
      if (opts.localHours && !opts.localHours.includes(DateTime.fromJSDate(now, { zone: t.timezone }).hour)) {
        out.skipped += 1;
        continue;
      }
      const since = (t.settings as { leave?: { autoSince?: string } } | undefined)?.leave?.autoSince;
      const today = localDate(now, t.timezone);
      await runInTenantDb(t.dbName ?? undefined, async () => {
        for (const month of monthsToRun(since, today))
          out.accrualEntries += (await runMonthlyAccrual(t._id, month)).entriesCreated;
        const year = carryYearToRun(since, today);
        if (year !== null) out.carryEntries += (await runCarryForward(t._id, year)).entriesCreated;
      });
      out.tenants += 1;
    } catch (err) {
      out.failed += 1;
      opts.log?.error({ err, tenantId: String(t._id) }, 'leave automation failed for company');
    }
  }
  return out;
}
