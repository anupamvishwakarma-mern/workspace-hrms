import type { Request, Router } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { Department } from '../../database/models/department.model';
import { Employee } from '../../database/models/employee.model';
import {
  IssuedLetter,
  LETTER_CATEGORIES,
  LetterTemplate,
} from '../../database/models/letter.model';
import { nextSequence } from '../../database/models/counter.model';
import { Tenant } from '../../database/models/tenant.model';
import { authenticate, requirePermission, resolveTenant } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import type { Clock } from '../../utils/clock';
import { AppError } from '../../utils/errors';
import { route } from '../../utils/route';
import { idParams, objectId, paginationQuery, validate } from '../../utils/validate';
import { writeAudit } from '../audit/audit.service';
import { localDate } from '../attendance/dates';
import { hasPermission } from '../auth/permissions';
import { effectiveStructure } from '../payroll/payroll.service';
import {
  assertKnownPlaceholders,
  formatLongDate,
  formatMoney,
  renderLetter,
  type Placeholder,
} from './render';

const templateBody = z
  .object({
    title: z.string().trim().min(2).max(150),
    category: z.enum(LETTER_CATEGORIES),
    body: z.string().trim().min(10).max(20000),
  })
  .strict();
const templatePatch = templateBody
  .partial()
  .extend({ status: z.enum(['ACTIVE', 'ARCHIVED']).optional() })
  .strict();
const issueBody = z
  .object({
    employeeId: objectId,
    templateId: objectId.optional(),
    title: z.string().trim().min(2).max(150).optional(),
    category: z.enum(LETTER_CATEGORIES).optional(),
    body: z.string().trim().min(10).max(20000).optional(),
  })
  .strict()
  .refine(
    (b) => b.templateId || (b.title && b.category && b.body),
    'Choose a template or write the letter',
  );
const listQuery = z.object({ ...paginationQuery, employeeId: objectId.optional() }).strict();
const revokeBody = z.object({ reason: z.string().trim().min(3).max(300) }).strict();

const serTemplate = (t: Record<string, unknown> & { _id: unknown }) => ({
  id: String(t._id),
  title: t.title,
  category: t.category,
  body: t.body,
  status: t.status,
  updatedAt: t.updatedAt,
});
const serLetter = (l: Record<string, unknown> & { _id: unknown }, withBody = true) => ({
  id: String(l._id),
  employeeId: String(l.employeeId),
  referenceNo: l.referenceNo,
  title: l.title,
  category: l.category,
  status: l.status,
  issuedAt: l.issuedAt,
  revokedAt: l.revokedAt,
  revokeReason: l.revokeReason,
  ...(withBody ? { body: l.body } : {}),
});

export function registerLetterRoutes(v1: Router, env: Env, deps: { clock: Clock }): void {
  const chain = [authenticate(env), resolveTenant];

  route(
    v1,
    {
      method: 'get',
      path: '/letter-templates',
      summary: 'Letter templates (HR/owner).',
      tags: ['Letters'],
      auth: 'tenant',
      permission: 'letter:manage',
    },
    ...chain,
    requirePermission('letter:manage'),
    asyncHandler(async (req, res) => {
      const rows = await LetterTemplate.find({ tenantId: req.tenantCtx!.tenantId })
        .sort({ status: 1, title: 1 })
        .limit(200)
        .lean();
      res.json({ success: true, data: rows.map(serTemplate) });
    }),
  );

  route(
    v1,
    {
      method: 'post',
      path: '/letter-templates',
      summary:
        'Create a template. Use placeholders such as {{employee.name}}, {{employee.designation}}, {{company.name}}, {{date.today}}, {{salary.monthlyGross}}.',
      tags: ['Letters'],
      auth: 'tenant',
      permission: 'letter:manage',
      body: templateBody,
      successStatus: 201,
    },
    ...chain,
    requirePermission('letter:manage'),
    validate({ body: templateBody }),
    asyncHandler(async (req, res) => {
      const b = req.body as z.infer<typeof templateBody>;
      assertKnownPlaceholders(b.body);
      const t = await LetterTemplate.create({
        ...b,
        tenantId: req.tenantCtx!.tenantId,
        createdBy: req.auth!.userId,
      });
      await writeAudit(req as Request, {
        action: 'letter.template_created',
        entityType: 'LetterTemplate',
        entityId: t._id,
      });
      res.status(201).json({ success: true, data: serTemplate(t.toObject()) });
    }),
  );

  route(
    v1,
    {
      method: 'patch',
      path: '/letter-templates/:id',
      summary: 'Edit or archive a template. Letters already issued are never changed.',
      tags: ['Letters'],
      auth: 'tenant',
      permission: 'letter:manage',
      body: templatePatch,
    },
    ...chain,
    requirePermission('letter:manage'),
    validate({ params: idParams, body: templatePatch }),
    asyncHandler(async (req, res) => {
      const b = req.body as z.infer<typeof templatePatch>;
      if (b.body) assertKnownPlaceholders(b.body);
      const t = await LetterTemplate.findOneAndUpdate(
        { _id: req.params.id, tenantId: req.tenantCtx!.tenantId },
        { $set: b },
        { new: true },
      ).lean();
      if (!t) throw AppError.notFound('Template not found');
      await writeAudit(req as Request, {
        action: 'letter.template_updated',
        entityType: 'LetterTemplate',
        entityId: t._id,
      });
      res.json({ success: true, data: serTemplate(t) });
    }),
  );

  route(
    v1,
    {
      method: 'post',
      path: '/letters',
      summary:
        'Issue a letter to an employee from a template (or custom text). Placeholders are filled once and the issued text is kept as-is.',
      tags: ['Letters'],
      auth: 'tenant',
      permission: 'letter:manage',
      body: issueBody,
      successStatus: 201,
    },
    ...chain,
    requirePermission('letter:manage'),
    validate({ body: issueBody }),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      const b = req.body as z.infer<typeof issueBody>;
      const emp = await Employee.findOne({ _id: b.employeeId, tenantId: ctx.tenantId }).lean();
      if (!emp) throw AppError.notFound('Employee not found');
      let title = b.title!;
      let category = b.category!;
      let body = b.body!;
      if (b.templateId) {
        const t = await LetterTemplate.findOne({
          _id: b.templateId,
          tenantId: ctx.tenantId,
          status: 'ACTIVE',
        }).lean();
        if (!t) throw AppError.notFound('Template not found');
        title = b.title ?? t.title;
        category = b.category ?? (t.category as typeof category);
        body = b.body ?? t.body;
      }
      const tenant = await Tenant.findById(ctx.tenantId).select('name timezone').lean();
      const tz = tenant?.timezone ?? 'UTC';
      const dept = emp.departmentId
        ? await Department.findOne({ _id: emp.departmentId, tenantId: ctx.tenantId })
            .select('name')
            .lean()
        : null;
      const values: Partial<Record<Placeholder, string | undefined>> = {
        'employee.name': `${emp.firstName} ${emp.lastName}`,
        'employee.firstName': emp.firstName,
        'employee.code': emp.employeeCode,
        'employee.designation': emp.designation ?? undefined,
        'employee.department': dept?.name,
        'employee.email': emp.workEmail,
        'employee.joiningDate': emp.joiningDate ? formatLongDate(emp.joiningDate) : undefined,
        'employee.lastWorkingDate': emp.lastWorkingDate
          ? formatLongDate(emp.lastWorkingDate)
          : undefined,
        'company.name': tenant?.name,
        'date.today': formatLongDate(localDate(deps.clock.now(), tz)),
      };
      if (/\{\{\s*salary\./.test(body)) {
        if (!hasPermission(ctx.roles, 'payroll:manage'))
          throw AppError.forbidden('You cannot use salary placeholders');
        const s = await effectiveStructure(ctx.tenantId, emp._id, localDate(deps.clock.now(), tz));
        if (s) {
          const gross = (s.components as { kind: string; calc: string; value: number }[])
            .filter((c) => c.kind === 'EARNING')
            .reduce((sum, c) => {
              const basic = (s.components as { code: string; value: number }[]).find(
                (x) => x.code === 'BASIC',
              )!.value;
              return sum + (c.calc === 'FIXED' ? c.value : Math.round((basic * c.value) / 10000));
            }, 0);
          values['salary.monthlyGross'] = formatMoney(gross, s.currency);
          values['salary.annualGross'] = formatMoney(gross * 12, s.currency);
        }
      }
      const text = renderLetter(body, values);
      const now = deps.clock.now();
      const year = now.getUTCFullYear();
      const seq = await nextSequence(`letter:${ctx.tenantId}:${year}`);
      const letter = await IssuedLetter.create({
        tenantId: ctx.tenantId,
        employeeId: emp._id,
        templateId: b.templateId,
        referenceNo: `LTR-${year}-${String(seq).padStart(4, '0')}`,
        title,
        category,
        body: text,
        issuedBy: req.auth!.userId,
        issuedAt: now,
      });
      await writeAudit(req as Request, {
        action: 'letter.issued',
        entityType: 'IssuedLetter',
        entityId: letter._id,
        after: { employeeId: emp._id, category, referenceNo: letter.referenceNo },
      });
      res.status(201).json({ success: true, data: serLetter(letter.toObject()) });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/letters',
      summary: 'Issued letters, optionally for one employee (HR/owner).',
      tags: ['Letters'],
      auth: 'tenant',
      permission: 'letter:manage',
      query: listQuery,
    },
    ...chain,
    requirePermission('letter:manage'),
    validate({ query: listQuery }),
    asyncHandler(async (req, res) => {
      const q = req.query as unknown as z.infer<typeof listQuery>;
      const filter: Record<string, unknown> = { tenantId: req.tenantCtx!.tenantId };
      if (q.employeeId) filter.employeeId = q.employeeId;
      const [rows, total] = await Promise.all([
        IssuedLetter.find(filter)
          .sort({ issuedAt: -1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
        IssuedLetter.countDocuments(filter),
      ]);
      const emps = await Employee.find({
        tenantId: req.tenantCtx!.tenantId,
        _id: { $in: rows.map((r) => r.employeeId) },
      })
        .select('employeeCode firstName lastName')
        .lean();
      const by = new Map(emps.map((e) => [String(e._id), e]));
      res.json({
        success: true,
        data: rows.map((r) => {
          const e = by.get(String(r.employeeId));
          return {
            ...serLetter(r, false),
            employee: e
              ? {
                  id: String(e._id),
                  employeeCode: e.employeeCode,
                  firstName: e.firstName,
                  lastName: e.lastName,
                }
              : undefined,
          };
        }),
        meta: { page: q.page, limit: q.limit, total },
      });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/letters/my',
      summary: 'Letters issued to you (revoked ones are listed but marked).',
      tags: ['Letters'],
      auth: 'tenant',
      permission: 'letter:read:self',
    },
    ...chain,
    requirePermission('letter:read:self'),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      if (!ctx.employeeId) throw AppError.forbidden('Your account has no employee record');
      const rows = await IssuedLetter.find({ tenantId: ctx.tenantId, employeeId: ctx.employeeId })
        .sort({ issuedAt: -1 })
        .limit(200)
        .lean();
      res.json({ success: true, data: rows.map((r) => serLetter(r, false)) });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/letters/:id',
      summary: 'One letter with its text: the employee it was issued to, or HR/owner.',
      tags: ['Letters'],
      auth: 'tenant',
      permission: 'letter:read:self',
    },
    ...chain,
    requirePermission('letter:read:self'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      const l = await IssuedLetter.findOne({ _id: req.params.id, tenantId: ctx.tenantId }).lean();
      const own = !!l && !!ctx.employeeId && String(l.employeeId) === String(ctx.employeeId);
      if (!l || !(own || hasPermission(ctx.roles, 'letter:manage')))
        throw AppError.notFound('Letter not found');
      res.json({ success: true, data: serLetter(l) });
    }),
  );

  route(
    v1,
    {
      method: 'post',
      path: '/letters/:id/revoke',
      summary: 'Mark a letter as revoked (the text is kept for the record).',
      tags: ['Letters'],
      auth: 'tenant',
      permission: 'letter:manage',
      body: revokeBody,
    },
    ...chain,
    requirePermission('letter:manage'),
    validate({ params: idParams, body: revokeBody }),
    asyncHandler(async (req, res) => {
      const l = await IssuedLetter.findOneAndUpdate(
        { _id: req.params.id, tenantId: req.tenantCtx!.tenantId, status: 'ISSUED' },
        {
          $set: {
            status: 'REVOKED',
            revokedAt: deps.clock.now(),
            revokeReason: (req.body as z.infer<typeof revokeBody>).reason,
          },
        },
        { new: true },
      ).lean();
      if (!l) throw AppError.notFound('Letter not found or already revoked');
      await writeAudit(req as Request, {
        action: 'letter.revoked',
        entityType: 'IssuedLetter',
        entityId: l._id,
      });
      res.json({ success: true, data: serLetter(l) });
    }),
  );
}
