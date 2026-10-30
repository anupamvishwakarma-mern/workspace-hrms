import type { Router } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { Employee } from '../../database/models/employee.model';
import { LeaveLedger } from '../../database/models/leaveLedger.model';
import { LeaveType } from '../../database/models/leaveType.model';
import { authenticate, requirePermission, resolveTenant } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import type { Clock } from '../../utils/clock';
import { AppError } from '../../utils/errors';
import { route } from '../../utils/route';
import { objectId, paginationQuery, validate } from '../../utils/validate';
import { loadTenant } from '../attendance/attendance.service';
import { localDate } from '../attendance/dates';
import { writeAudit } from '../audit/audit.service';
import { teamScope } from '../attendance/review.service';
import { runCarryForward, runMonthlyAccrual } from './ledger.service';

const accrueBody = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM') }).strict();
const carryBody = z.object({ fromYear: z.number().int().min(2000).max(2100) }).strict();
const adjustBody = z
  .object({
    employeeId: objectId,
    leaveTypeId: objectId,
    year: z.number().int().min(2000).max(2100),
    days: z
      .number()
      .min(-366)
      .max(366)
      .multipleOf(0.5)
      .refine((n) => n !== 0, 'days cannot be zero'),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
const listQuery = z
  .object({
    ...paginationQuery,
    employeeId: objectId.optional(),
    leaveTypeId: objectId.optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
  })
  .strict();

const ser = (d: Record<string, any>) => ({
  id: String(d._id),
  employeeId: String(d.employeeId),
  leaveTypeId: String(d.leaveTypeId),
  year: d.year,
  kind: d.kind,
  days: d.days,
  period: d.period,
  reason: d.reason,
  createdAt: d.createdAt,
});

export function registerLeaveLedgerRoutes(v1: Router, env: Env, deps: { clock: Clock }): void {
  const chain = [authenticate(env), resolveTenant];

  route(
    v1,
    { method: 'get', path: '/leave/ledger', summary: 'Leave credits and adjustments (own by default; others within your read scope).', tags: ['Leave'], auth: 'tenant', permission: 'leave:apply', query: listQuery },
    ...chain,
    requirePermission('leave:apply'),
    validate({ query: listQuery }),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      const q = req.query as unknown as z.infer<typeof listQuery>;
      let target = ctx.employeeId;
      if (q.employeeId && String(q.employeeId) !== String(ctx.employeeId)) {
        const scope = await teamScope(ctx, 'leave:read:all', 'leave:read:team');
        if (scope && !scope.some((i) => String(i) === q.employeeId)) throw AppError.notFound();
        target = q.employeeId as never;
      }
      if (!target) throw AppError.forbidden('Your account has no employee record');
      const filter = {
        tenantId: ctx.tenantId,
        employeeId: target,
        ...(q.leaveTypeId ? { leaveTypeId: q.leaveTypeId } : {}),
        ...(q.year ? { year: q.year } : {}),
      };
      const [items, total] = await Promise.all([
        LeaveLedger.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
        LeaveLedger.countDocuments(filter),
      ]);
      res.json({ success: true, data: items.map(ser), meta: { page: q.page, limit: q.limit, total } });
    }),
  );

  route(
    v1,
    { method: 'post', path: '/leave/ledger/adjustments', summary: 'Add or remove leave days for one person and year, with a reason. Entries are permanent; correct a mistake with another adjustment.', tags: ['Leave'], auth: 'tenant', permission: 'leave:manage', body: adjustBody, successStatus: 201 },
    ...chain,
    requirePermission('leave:manage'),
    validate({ body: adjustBody }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      const b = req.body as z.infer<typeof adjustBody>;
      const [emp, type] = await Promise.all([
        Employee.exists({ _id: b.employeeId, tenantId }),
        LeaveType.exists({ _id: b.leaveTypeId, tenantId }),
      ]);
      if (!emp || !type) throw AppError.notFound('Employee or leave type not found');
      const doc = await LeaveLedger.create({
        ...b,
        tenantId,
        kind: 'ADJUSTMENT',
        createdBy: req.auth!.userId,
      });
      await writeAudit(req, {
        action: 'leave.ledger.adjust',
        entityType: 'LeaveLedger',
        entityId: doc._id,
        reason: b.reason,
        after: { employeeId: b.employeeId, leaveTypeId: b.leaveTypeId, year: b.year, days: b.days },
      });
      res.status(201).json({ success: true, data: ser(doc.toObject()) });
    }),
  );

  route(
    v1,
    { method: 'post', path: '/leave/ledger/accrue', summary: 'Credit one month of leave for every monthly-accrual type. Safe to repeat; people already credited for the month are skipped. A future month is refused.', tags: ['Leave'], auth: 'tenant', permission: 'leave:manage', body: accrueBody },
    ...chain,
    requirePermission('leave:manage'),
    validate({ body: accrueBody }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      const { month } = req.body as z.infer<typeof accrueBody>;
      const tenant = await loadTenant(tenantId);
      if (month > localDate(deps.clock.now(), tenant.timezone).slice(0, 7))
        throw AppError.unprocessable('That month has not started yet');
      const out = await runMonthlyAccrual(tenantId, month, req.auth!.userId);
      await writeAudit(req, { action: 'leave.ledger.accrue', entityType: 'LeaveLedger', after: out });
      res.json({ success: true, data: out });
    }),
  );

  route(
    v1,
    { method: 'post', path: '/leave/ledger/carry-forward', summary: 'Year-end: carry unused days (up to each type\'s limit) into the next year. Only for a year that has ended. Safe to repeat.', tags: ['Leave'], auth: 'tenant', permission: 'leave:manage', body: carryBody },
    ...chain,
    requirePermission('leave:manage'),
    validate({ body: carryBody }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      const { fromYear } = req.body as z.infer<typeof carryBody>;
      const tenant = await loadTenant(tenantId);
      if (fromYear >= Number(localDate(deps.clock.now(), tenant.timezone).slice(0, 4)))
        throw AppError.unprocessable('That year has not ended yet');
      const out = await runCarryForward(tenantId, fromYear, req.auth!.userId);
      await writeAudit(req, { action: 'leave.ledger.carryForward', entityType: 'LeaveLedger', after: out });
      res.json({ success: true, data: out });
    }),
  );
}
