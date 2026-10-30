import type { Request, Router } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { Employee } from '../../database/models/employee.model';
import { PayrollRun, Payslip } from '../../database/models/payroll.model';
import { SalaryStructure } from '../../database/models/salaryStructure.model';
import { authenticate, requirePermission, resolveTenant } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import type { Clock } from '../../utils/clock';
import { AppError } from '../../utils/errors';
import { route } from '../../utils/route';
import { idParams, objectId, paginationQuery, validate } from '../../utils/validate';
import { writeAudit } from '../audit/audit.service';
import { WORK_DATE_RE, isRealDate, localDate } from '../attendance/dates';
import { loadTenant } from '../attendance/attendance.service';
import { hasPermission } from '../auth/permissions';
import { validateStructure, type PayComponent } from './calc';
import {
  MONTH_RE,
  effectiveStructure,
  generateRun,
  monthBounds,
  publishRun,
} from './payroll.service';

const money = z
  .number()
  .min(0)
  .max(100_000_000)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'At most 2 decimal places');
const percent = z
  .number()
  .min(0)
  .max(100)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'At most 2 decimal places');

const component = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{0,19}$/, 'Use capital letters, digits and _'),
    name: z.string().trim().min(1).max(80),
    kind: z.enum(['EARNING', 'DEDUCTION']),
    calc: z.enum(['FIXED', 'PERCENT_OF_BASIC']),
    amount: money.optional(),
    percent: percent.optional(),
    prorate: z.boolean().optional(),
  })
  .strict();
const structureBody = z
  .object({
    employeeId: objectId,
    effectiveFrom: z
      .string()
      .regex(WORK_DATE_RE, 'Use YYYY-MM-DD')
      .refine(isRealDate, 'Invalid calendar date'),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default('INR'),
    components: z.array(component).min(1).max(30),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
const runBody = z.object({ month: z.string().regex(MONTH_RE, 'Use YYYY-MM') }).strict();
const structQuery = z.object({ employeeId: objectId }).strict();
const listQuery = z.object({ ...paginationQuery }).strict();
const runQuery = z.object({ ...paginationQuery }).strict();

const toComponents = (raw: z.infer<typeof component>[]): PayComponent[] =>
  raw.map((c) => {
    const isFixed = c.calc === 'FIXED';
    if (isFixed && c.amount === undefined)
      throw AppError.unprocessable(`${c.code}: an amount is required`);
    if (!isFixed && c.percent === undefined)
      throw AppError.unprocessable(`${c.code}: a percent is required`);
    return {
      code: c.code,
      name: c.name,
      kind: c.kind,
      calc: c.calc,
      value: isFixed ? Math.round(c.amount! * 100) : Math.round(c.percent! * 100),
      prorate: c.prorate ?? c.kind === 'EARNING',
    };
  });

const serStructure = (s: Record<string, unknown> & { _id: unknown }) => ({
  id: String(s._id),
  employeeId: String(s.employeeId),
  effectiveFrom: s.effectiveFrom,
  currency: s.currency,
  components: s.components,
  note: s.note,
  createdAt: s.createdAt,
});
const serRun = (r: Record<string, unknown> & { _id: unknown }) => ({
  id: String(r._id),
  month: r.month,
  status: r.status,
  generatedAt: r.generatedAt,
  publishedAt: r.publishedAt,
  totals: r.totals,
  skipped: ((r.skipped as { employeeId: unknown; name: string; reason: string }[]) ?? []).map(
    (s) => ({ employeeId: String(s.employeeId), name: s.name, reason: s.reason }),
  ),
});
const serPayslip = (p: Record<string, unknown> & { _id: unknown }, full = true) => ({
  id: String(p._id),
  employeeId: String(p.employeeId),
  month: p.month,
  status: p.status,
  currency: p.currency,
  employee: p.employee,
  grossMinor: p.grossMinor,
  deductionsMinor: p.deductionsMinor,
  netMinor: p.netMinor,
  warnings: p.warnings,
  publishedAt: p.publishedAt,
  employerMinor: p.employerMinor ?? 0,
  ...(full ? { attendance: p.attendance, lines: p.lines, employerLines: p.employerLines ?? [] } : {}),
});

export function registerPayrollRoutes(v1: Router, env: Env, deps: { clock: Clock }): void {
  const chain = [authenticate(env), resolveTenant];

  route(
    v1,
    {
      method: 'get',
      path: '/payroll/structures',
      summary: "An employee's salary structure versions, newest first (payroll managers only).",
      tags: ['Payroll'],
      auth: 'tenant',
      permission: 'payroll:manage',
      query: structQuery,
    },
    ...chain,
    requirePermission('payroll:manage'),
    validate({ query: structQuery }),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      const { employeeId } = req.query as unknown as z.infer<typeof structQuery>;
      if (!(await Employee.exists({ _id: employeeId, tenantId: ctx.tenantId })))
        throw AppError.notFound('Employee not found');
      const rows = await SalaryStructure.find({ tenantId: ctx.tenantId, employeeId })
        .sort({ effectiveFrom: -1, createdAt: -1 })
        .limit(50)
        .lean();
      await writeAudit(req as Request, {
        action: 'payroll.structure_viewed',
        entityType: 'Employee',
        entityId: employeeId,
      });
      res.json({ success: true, data: rows.map(serStructure) });
    }),
  );

  route(
    v1,
    {
      method: 'post',
      path: '/payroll/structures',
      summary:
        'Set a new salary structure version for an employee. Versions are never edited. You cannot change your own.',
      tags: ['Payroll'],
      auth: 'tenant',
      permission: 'payroll:manage',
      body: structureBody,
      successStatus: 201,
    },
    ...chain,
    requirePermission('payroll:manage'),
    validate({ body: structureBody }),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      const b = req.body as z.infer<typeof structureBody>;
      if (ctx.employeeId && String(ctx.employeeId) === b.employeeId)
        throw AppError.forbidden('You cannot change your own salary structure');
      if (!(await Employee.exists({ _id: b.employeeId, tenantId: ctx.tenantId })))
        throw AppError.notFound('Employee not found');
      const components = toComponents(b.components);
      const problem = validateStructure(components);
      if (problem) throw AppError.unprocessable(problem);
      const doc = await SalaryStructure.create({
        tenantId: ctx.tenantId,
        employeeId: b.employeeId,
        effectiveFrom: b.effectiveFrom,
        currency: b.currency,
        components,
        createdBy: req.auth!.userId,
        note: b.note,
      });
      await writeAudit(req as Request, {
        action: 'payroll.structure_created',
        entityType: 'SalaryStructure',
        entityId: doc._id,
        after: { employeeId: b.employeeId, effectiveFrom: b.effectiveFrom },
      });
      res.status(201).json({ success: true, data: serStructure(doc.toObject()) });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/payroll/my/structure',
      summary: 'Your own current salary structure.',
      tags: ['Payroll'],
      auth: 'tenant',
      permission: 'payroll:read:self',
    },
    ...chain,
    requirePermission('payroll:read:self'),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      if (!ctx.employeeId) throw AppError.forbidden('Your account has no employee record');
      const tenant = await loadTenant(ctx.tenantId);
      const s = await effectiveStructure(
        ctx.tenantId,
        ctx.employeeId,
        localDate(deps.clock.now(), tenant.timezone),
      );
      res.json({ success: true, data: s ? serStructure(s) : null });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/payroll/runs',
      summary: 'Payroll runs, newest month first.',
      tags: ['Payroll'],
      auth: 'tenant',
      permission: 'payroll:manage',
      query: runQuery,
    },
    ...chain,
    requirePermission('payroll:manage'),
    validate({ query: runQuery }),
    asyncHandler(async (req, res) => {
      const q = req.query as unknown as z.infer<typeof runQuery>;
      const filter = { tenantId: req.tenantCtx!.tenantId };
      const [rows, total] = await Promise.all([
        PayrollRun.find(filter)
          .sort({ month: -1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
        PayrollRun.countDocuments(filter),
      ]);
      res.json({
        success: true,
        data: rows.map(serRun),
        meta: { page: q.page, limit: q.limit, total },
      });
    }),
  );

  route(
    v1,
    {
      method: 'post',
      path: '/payroll/runs',
      summary:
        'Generate (or regenerate a draft of) payroll for a finished month from salary structures, attendance and unpaid leave.',
      tags: ['Payroll'],
      auth: 'tenant',
      permission: 'payroll:manage',
      body: runBody,
      successStatus: 201,
    },
    ...chain,
    requirePermission('payroll:manage'),
    validate({ body: runBody }),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      const { month } = req.body as z.infer<typeof runBody>;
      const tenant = await loadTenant(ctx.tenantId);
      const run = await generateRun(tenant, month, req.auth!.userId, deps.clock.now());
      await writeAudit(req as Request, {
        action: 'payroll.run_generated',
        entityType: 'PayrollRun',
        entityId: run._id,
        after: { month, employees: run.totals?.employees },
      });
      res.status(201).json({ success: true, data: serRun(run) });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/payroll/runs/:id',
      summary: 'One run with its payslip summaries.',
      tags: ['Payroll'],
      auth: 'tenant',
      permission: 'payroll:manage',
    },
    ...chain,
    requirePermission('payroll:manage'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      const run = await PayrollRun.findOne({ _id: req.params.id, tenantId: ctx.tenantId }).lean();
      if (!run) throw AppError.notFound('Payroll run not found');
      const slips = await Payslip.find({ tenantId: ctx.tenantId, runId: run._id })
        .sort({ 'employee.code': 1 })
        .limit(2000)
        .lean();
      res.json({
        success: true,
        data: { ...serRun(run), payslips: slips.map((p) => serPayslip(p, false)) },
      });
    }),
  );

  route(
    v1,
    {
      method: 'post',
      path: '/payroll/runs/:id/publish',
      summary:
        'Publish a run: payslips become visible to employees and can no longer be changed. Refused while any net pay is negative.',
      tags: ['Payroll'],
      auth: 'tenant',
      permission: 'payroll:manage',
    },
    ...chain,
    requirePermission('payroll:manage'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const run = await publishRun(
        req.tenantCtx!.tenantId,
        String(req.params.id),
        req.auth!.userId,
        deps.clock.now(),
      );
      await writeAudit(req as Request, {
        action: 'payroll.run_published',
        entityType: 'PayrollRun',
        entityId: run._id,
        after: { month: run.month },
      });
      res.json({ success: true, data: serRun(run) });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/payroll/my/payslips',
      summary: 'Your published payslips, newest first.',
      tags: ['Payroll'],
      auth: 'tenant',
      permission: 'payroll:read:self',
      query: listQuery,
    },
    ...chain,
    requirePermission('payroll:read:self'),
    validate({ query: listQuery }),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      if (!ctx.employeeId) throw AppError.forbidden('Your account has no employee record');
      const q = req.query as unknown as z.infer<typeof listQuery>;
      const filter = { tenantId: ctx.tenantId, employeeId: ctx.employeeId, status: 'PUBLISHED' };
      const [rows, total] = await Promise.all([
        Payslip.find(filter)
          .sort({ month: -1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
        Payslip.countDocuments(filter),
      ]);
      res.json({
        success: true,
        data: rows.map((p) => serPayslip(p, false)),
        meta: { page: q.page, limit: q.limit, total },
      });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/payroll/payslips/:id',
      summary:
        'One payslip. The employee sees their own once published; payroll managers can see any (views of others are audit-logged).',
      tags: ['Payroll'],
      auth: 'tenant',
      permission: 'payroll:read:self',
    },
    ...chain,
    requirePermission('payroll:read:self'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      const p = await Payslip.findOne({ _id: req.params.id, tenantId: ctx.tenantId }).lean();
      const own = !!p && !!ctx.employeeId && String(p.employeeId) === String(ctx.employeeId);
      const manager = hasPermission(ctx.roles, 'payroll:manage');
      if (!p || !((own && p.status === 'PUBLISHED') || manager))
        throw AppError.notFound('Payslip not found');
      if (!own)
        await writeAudit(req as Request, {
          action: 'payroll.payslip_viewed',
          entityType: 'Payslip',
          entityId: p._id,
          after: { employeeId: p.employeeId, month: p.month },
        });
      res.json({ success: true, data: serPayslip(p) });
    }),
  );
  void monthBounds;
}
