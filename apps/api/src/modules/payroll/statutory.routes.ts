import type { Router } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { Employee } from '../../database/models/employee.model';
import { PayrollRun } from '../../database/models/payroll.model';
import { RULE_METHODS, RULE_PARTIES, PayrollAdjustment, StatutoryRule } from '../../database/models/statutoryRule.model';
import { authenticate, requirePermission, resolveTenant } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/errors';
import { rethrowDuplicate } from '../../utils/mongo';
import { route } from '../../utils/route';
import { idParams, objectId, paginationQuery, validate } from '../../utils/validate';
import { WORK_DATE_RE, isRealDate } from '../attendance/dates';
import { writeAudit } from '../audit/audit.service';
import { MONTH_RE } from './payroll.service';
import { validateRule, type RuleLike } from './statutory';

const date = z.string().regex(WORK_DATE_RE, 'Use YYYY-MM-DD').refine(isRealDate, 'Invalid date');
/** Amounts are entered in whole currency units with up to 2 decimals (as in salary structures) and stored in minor units. */
const money = z
  .number()
  .min(0)
  .max(100_000_000)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'At most 2 decimal places');
const pct = z
  .number()
  .gt(0)
  .max(100)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'At most 2 decimal places');
const toMinor = (n: number) => Math.round(n * 100);
const toMajor = (n?: number | null) => (n == null ? undefined : n / 100);
const ruleFields = {
  name: z.string().trim().min(1).max(80),
  party: z.enum(RULE_PARTIES),
  method: z.enum(RULE_METHODS),
  wageComponents: z.array(z.string().trim().toUpperCase().max(20)).max(30),
  percent: pct,
  wageCeiling: money,
  cap: money,
  slabs: z.array(z.object({ from: money, to: money.optional(), amount: money }).strict()).max(40),
  fixed: money,
  minWage: money,
  maxWage: money,
  months: z.array(z.number().int().min(1).max(12)).max(12),
  workLocationIds: z.array(objectId).max(100),
  effectiveFrom: date,
  effectiveTo: date,
  reference: z.string().trim().max(300),
};
const createRule = z
  .object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{1,20}$/, 'Letters, digits and _ only'), ...ruleFields })
  .partial()
  .required({ code: true, name: true, party: true, method: true, effectiveFrom: true })
  .strict();
const patchRule = z
  .object({ ...ruleFields, status: z.enum(['ACTIVE', 'INACTIVE']) })
  .partial()
  .extend({ effectiveTo: date.nullable().optional() })
  .strict();
const ruleList = z.object({ ...paginationQuery, status: z.enum(['ACTIVE', 'INACTIVE']).optional() }).strict();

const adjBody = z
  .object({
    employeeId: objectId,
    month: z.string().regex(MONTH_RE, 'Use YYYY-MM'),
    kind: z.enum(['EARNING', 'DEDUCTION']),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{1,20}$/).optional(),
    label: z.string().trim().min(1).max(80),
    amount: money.refine((n) => n > 0, 'Must be above 0'),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
const adjList = z
  .object({ ...paginationQuery, month: z.string().regex(MONTH_RE).optional(), employeeId: objectId.optional() })
  .strict();

/** Request body (major units, % ) -> stored fields (minor units, basis points). */
function toStored(b: Record<string, any>): Record<string, unknown> {
  const { percent, wageCeiling, cap, slabs, fixed, minWage, maxWage, ...rest } = b;
  const out: Record<string, unknown> = { ...rest };
  if (percent !== undefined) out.percentBp = Math.round(percent * 100);
  if (wageCeiling !== undefined) out.wageCeilingMinor = toMinor(wageCeiling);
  if (cap !== undefined) out.capMinor = toMinor(cap);
  if (fixed !== undefined) out.fixedMinor = toMinor(fixed);
  if (minWage !== undefined) out.minWageMinor = toMinor(minWage);
  if (maxWage !== undefined) out.maxWageMinor = toMinor(maxWage);
  if (slabs !== undefined)
    out.slabs = slabs.map((x: { from: number; to?: number; amount: number }) => ({
      fromMinor: toMinor(x.from),
      ...(x.to !== undefined ? { toMinor: toMinor(x.to) } : {}),
      amountMinor: toMinor(x.amount),
    }));
  return out;
}

const serRule = (r: Record<string, any>) => ({
  id: String(r._id),
  code: r.code,
  name: r.name,
  party: r.party,
  method: r.method,
  wageComponents: r.wageComponents ?? [],
  percent: r.percentBp == null ? undefined : r.percentBp / 100,
  wageCeiling: toMajor(r.wageCeilingMinor),
  cap: toMajor(r.capMinor),
  slabs: (r.slabs ?? []).map((x: { fromMinor: number; toMinor?: number; amountMinor: number }) => ({
    from: x.fromMinor / 100,
    to: toMajor(x.toMinor),
    amount: x.amountMinor / 100,
  })),
  fixed: toMajor(r.fixedMinor),
  minWage: toMajor(r.minWageMinor),
  maxWage: toMajor(r.maxWageMinor),
  months: r.months ?? [],
  workLocationIds: (r.workLocationIds ?? []).map(String),
  effectiveFrom: r.effectiveFrom,
  effectiveTo: r.effectiveTo,
  reference: r.reference,
  status: r.status,
});
const serAdj = (a: Record<string, any>) => ({
  id: String(a._id),
  employeeId: String(a.employeeId),
  month: a.month,
  kind: a.kind,
  code: a.code,
  label: a.label,
  amount: a.amountMinor / 100,
  reason: a.reason,
  status: a.status,
  createdAt: a.createdAt,
});

export function registerStatutoryRoutes(v1: Router, env: Env): void {
  const chain = [authenticate(env), resolveTenant];

  route(
    v1,
    { method: 'get', path: '/payroll/statutory-rules', summary: 'Statutory and policy contribution rules the company configured. The product supplies no rates.', tags: ['Payroll'], auth: 'tenant', permission: 'payroll:manage', query: ruleList },
    ...chain,
    requirePermission('payroll:manage'),
    validate({ query: ruleList }),
    asyncHandler(async (req, res) => {
      const q = req.query as unknown as z.infer<typeof ruleList>;
      const filter = { tenantId: req.tenantCtx!.tenantId, ...(q.status ? { status: q.status } : {}) };
      const [items, total] = await Promise.all([
        StatutoryRule.find(filter).sort({ code: 1, effectiveFrom: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
        StatutoryRule.countDocuments(filter),
      ]);
      res.json({ success: true, data: items.map(serRule), meta: { page: q.page, limit: q.limit, total } });
    }),
  );

  route(
    v1,
    { method: 'post', path: '/payroll/statutory-rules', summary: 'Add a rule version. Applies to payroll months from effectiveFrom; published payslips never change. Record where the figures came from in `reference`.', tags: ['Payroll'], auth: 'tenant', permission: 'payroll:manage', body: createRule, successStatus: 201 },
    ...chain,
    requirePermission('payroll:manage'),
    validate({ body: createRule }),
    asyncHandler(async (req, res) => {
      const stored = toStored(req.body);
      const err = validateRule(stored as unknown as RuleLike);
      if (err) throw AppError.unprocessable(err);
      const doc = await StatutoryRule.create({ ...stored, tenantId: req.tenantCtx!.tenantId, createdBy: req.auth!.userId }).catch((e) =>
        rethrowDuplicate(e, 'A version of this rule already starts on that date'),
      );
      await writeAudit(req, { action: 'payroll.statutory.create', entityType: 'StatutoryRule', entityId: doc._id, after: doc });
      res.status(201).json({ success: true, data: serRule(doc.toObject()) });
    }),
  );

  route(
    v1,
    { method: 'patch', path: '/payroll/statutory-rules/:id', summary: 'Edit or deactivate a rule version. Draft runs pick it up when regenerated; published payslips are frozen.', tags: ['Payroll'], auth: 'tenant', permission: 'payroll:manage', body: patchRule },
    ...chain,
    requirePermission('payroll:manage'),
    validate({ params: idParams, body: patchRule }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      const before = await StatutoryRule.findOne({ _id: req.params.id, tenantId }).lean();
      if (!before) throw AppError.notFound('Rule not found');
      const { effectiveTo, ...body } = req.body as z.infer<typeof patchRule>;
      const rest = toStored(body);
      const merged = { ...before, ...rest, effectiveTo: effectiveTo === null ? undefined : (effectiveTo ?? before.effectiveTo) };
      const update: Record<string, unknown> = { $set: rest };
      const unset: Record<string, 1> = {};
      if (effectiveTo === null) unset.effectiveTo = 1;
      if (rest.method && rest.method !== before.method)
        // Switching method drops the old method's figures unless the request supplies new ones.
        for (const k of ['percentBp', 'fixedMinor', 'wageCeilingMinor', 'capMinor'])
          if (!(k in rest)) {
            unset[k] = 1;
            (merged as Record<string, unknown>)[k] = undefined;
          }
      if (rest.method && rest.method !== before.method && !('slabs' in rest)) {
        (update.$set as Record<string, unknown>).slabs = [];
        (merged as Record<string, unknown>).slabs = [];
      }
      if (Object.keys(unset).length) update.$unset = unset;
      if (effectiveTo) (update.$set as Record<string, unknown>).effectiveTo = effectiveTo;
      const err = validateRule(merged as unknown as RuleLike);
      if (err) throw AppError.unprocessable(err);
      const after = await StatutoryRule.findOneAndUpdate({ _id: before._id, tenantId }, update, { new: true })
        .lean()
        .catch((e) => rethrowDuplicate(e, 'A version of this rule already starts on that date'));
      await writeAudit(req, { action: 'payroll.statutory.update', entityType: 'StatutoryRule', entityId: before._id, before, after });
      res.json({ success: true, data: serRule(after!) });
    }),
  );

  /* ------------------------------- adjustments ------------------------------- */
  const assertOpen = async (tenantId: unknown, month: string) => {
    const run = await PayrollRun.findOne({ tenantId: tenantId as never, month }).select('status').lean();
    if (run?.status === 'PUBLISHED') throw AppError.conflict('That month is already published and cannot be changed');
  };

  route(
    v1,
    { method: 'post', path: '/payroll/adjustments', summary: 'Add a one-off earning or deduction for one person and month (bonus, arrears, advance recovery, tax already deducted...). Applied the next time that month is generated; not prorated.', tags: ['Payroll'], auth: 'tenant', permission: 'payroll:manage', body: adjBody, successStatus: 201 },
    ...chain,
    requirePermission('payroll:manage'),
    validate({ body: adjBody }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      const b = req.body as z.infer<typeof adjBody>;
      if (!(await Employee.exists({ _id: b.employeeId, tenantId }))) throw AppError.notFound('Employee not found');
      await assertOpen(tenantId, b.month);
      const { amount, ...fields } = b;
      const doc = await PayrollAdjustment.create({ ...fields, amountMinor: toMinor(amount), tenantId, createdBy: req.auth!.userId });
      await writeAudit(req, { action: 'payroll.adjustment.create', entityType: 'PayrollAdjustment', entityId: doc._id, reason: b.reason, after: { employeeId: b.employeeId, month: b.month, kind: b.kind, amount: b.amount } });
      res.status(201).json({ success: true, data: serAdj(doc.toObject()) });
    }),
  );

  route(
    v1,
    { method: 'get', path: '/payroll/adjustments', summary: 'List adjustments, optionally for one month or person.', tags: ['Payroll'], auth: 'tenant', permission: 'payroll:manage', query: adjList },
    ...chain,
    requirePermission('payroll:manage'),
    validate({ query: adjList }),
    asyncHandler(async (req, res) => {
      const q = req.query as unknown as z.infer<typeof adjList>;
      const filter = { tenantId: req.tenantCtx!.tenantId, ...(q.month ? { month: q.month } : {}), ...(q.employeeId ? { employeeId: q.employeeId } : {}) };
      const [items, total] = await Promise.all([
        PayrollAdjustment.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
        PayrollAdjustment.countDocuments(filter),
      ]);
      res.json({ success: true, data: items.map(serAdj), meta: { page: q.page, limit: q.limit, total } });
    }),
  );

  route(
    v1,
    { method: 'post', path: '/payroll/adjustments/:id/void', summary: 'Cancel an adjustment before its month is published.', tags: ['Payroll'], auth: 'tenant', permission: 'payroll:manage' },
    ...chain,
    requirePermission('payroll:manage'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      const adj = await PayrollAdjustment.findOne({ _id: req.params.id, tenantId }).lean();
      if (!adj) throw AppError.notFound('Adjustment not found');
      await assertOpen(tenantId, adj.month);
      const done = await PayrollAdjustment.findOneAndUpdate(
        { _id: adj._id, tenantId, status: 'ACTIVE' },
        { $set: { status: 'VOIDED', voidedBy: req.auth!.userId, voidedAt: new Date() } },
        { new: true },
      ).lean();
      if (!done) throw AppError.conflict('Already voided');
      await writeAudit(req, { action: 'payroll.adjustment.void', entityType: 'PayrollAdjustment', entityId: adj._id });
      res.json({ success: true, data: serAdj(done) });
    }),
  );
}
