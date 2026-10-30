import type { Request, Router } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { Employee } from '../../database/models/employee.model';
import { PROFILE_KINDS, ProfileItem, SKILL_LEVELS } from '../../database/models/profileItem.model';
import { authenticate, requirePermission, resolveTenant } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/errors';
import { route } from '../../utils/route';
import { idParams, objectId, validate } from '../../utils/validate';
import { WORK_DATE_RE, isRealDate } from '../attendance/dates';
import { writeAudit } from '../audit/audit.service';
import { hasPermission } from '../auth/permissions';

const date = z.string().regex(WORK_DATE_RE, 'Use YYYY-MM-DD').refine(isRealDate, 'Invalid date');
const fields = {
  title: z.string().trim().min(1).max(150),
  organization: z.string().trim().min(1).max(150),
  fromDate: date,
  toDate: date,
  level: z.enum(SKILL_LEVELS),
  credentialId: z.string().trim().min(1).max(80),
  notes: z.string().trim().max(1000),
};
const createBody = z
  .object({ kind: z.enum(PROFILE_KINDS), ...fields })
  .partial()
  .required({ kind: true, title: true })
  .strict();
const patchBody = z
  .object({ ...fields, verified: z.boolean() })
  .partial()
  .extend({
    organization: fields.organization.nullable().optional(),
    fromDate: date.nullable().optional(),
    toDate: date.nullable().optional(),
    level: z.enum(SKILL_LEVELS).nullable().optional(),
    credentialId: fields.credentialId.nullable().optional(),
    notes: fields.notes.nullable().optional(),
  })
  .strict();
const listQuery = z.object({ kind: z.enum(PROFILE_KINDS).optional() }).strict();
const itemParams = z.object({ id: objectId, itemId: objectId }).strict();

type Item = Record<string, any>;
const ser = (i: Item) => ({
  id: String(i._id),
  employeeId: String(i.employeeId),
  kind: i.kind,
  title: i.title,
  organization: i.organization,
  fromDate: i.fromDate,
  toDate: i.toDate,
  level: i.level,
  credentialId: i.credentialId,
  notes: i.notes,
  verified: !!i.verifiedAt,
  verifiedAt: i.verifiedAt,
});

/** What each kind must have, and which dates make sense. Returns an error message or nothing. */
export function checkItem(i: Item): string | undefined {
  if (i.kind === 'QUALIFICATION' && !i.organization) return 'Enter the institution';
  if (i.kind === 'EXPERIENCE') {
    if (!i.organization) return 'Enter the employer';
    if (!i.fromDate) return 'Enter the start date';
  }
  if (i.kind === 'CERTIFICATION' && !i.organization) return 'Enter the issuing body';
  if (i.kind !== 'SKILL' && i.level) return 'Only skills have a level';
  if (i.kind !== 'CERTIFICATION' && i.kind !== 'EXPERIENCE' && i.kind !== 'QUALIFICATION' && (i.fromDate || i.toDate))
    return 'Skills have no dates';
  if (i.fromDate && i.toDate && i.toDate < i.fromDate) return 'The end date is before the start date';
  return undefined;
}

export function registerProfileRoutes(v1: Router, env: Env): void {
  const chain = [authenticate(env), resolveTenant];

  /** HR and the owner act on anyone; everyone else only on their own record. Others get 404, so existence is not revealed. */
  async function access(req: Request, id: string, write: boolean) {
    const ctx = req.tenantCtx!;
    const isSelf = !!ctx.employeeId && String(ctx.employeeId) === id;
    const hr = hasPermission(ctx.roles, write ? 'employee:update' : 'employee:read:all');
    if (!hr && !(isSelf && hasPermission(ctx.roles, write ? 'employee:update:self' : 'employee:read:self')))
      throw AppError.notFound('Employee not found');
    const emp = await Employee.findOne({ _id: id, tenantId: ctx.tenantId }).select('employmentStatus').lean();
    if (!emp) throw AppError.notFound('Employee not found');
    if (write && emp.employmentStatus === 'TERMINATED')
      throw AppError.conflict('Terminated employee records are read-only');
    return { ctx, isSelf, hr: hasPermission(ctx.roles, 'employee:update') };
  }

  route(
    v1,
    { method: 'get', path: '/employees/:id/profile-items', summary: 'Qualifications, previous employment, skills and certifications. HR/owner for anyone; employees for themselves.', tags: ['Employees'], auth: 'tenant', permission: 'employee:read:all | employee:read:self', query: listQuery },
    ...chain,
    requirePermission('employee:read:all', 'employee:read:self'),
    validate({ params: idParams, query: listQuery }),
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      const { ctx } = await access(req, id, false);
      const kind = (req.query as { kind?: string }).kind;
      const items = await ProfileItem.find({ tenantId: ctx.tenantId, employeeId: id, ...(kind ? { kind } : {}) })
        .sort({ kind: 1, fromDate: -1, createdAt: -1 })
        .limit(500)
        .lean();
      res.json({ success: true, data: items.map(ser) });
    }),
  );

  route(
    v1,
    { method: 'post', path: '/employees/:id/profile-items', summary: 'Add a profile item. Items added by HR are marked verified; items added by the employee are not.', tags: ['Employees'], auth: 'tenant', permission: 'employee:update | employee:update:self', body: createBody, successStatus: 201 },
    ...chain,
    requirePermission('employee:update', 'employee:update:self'),
    validate({ params: idParams, body: createBody }),
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      const { ctx, hr, isSelf } = await access(req, id, true);
      const bad = checkItem(req.body);
      if (bad) throw AppError.unprocessable(bad);
      if (await ProfileItem.countDocuments({ tenantId: ctx.tenantId, employeeId: id }) >= 200)
        throw AppError.conflict('Too many profile entries; remove some first');
      const now = new Date();
      const doc = await ProfileItem.create({
        ...req.body,
        tenantId: ctx.tenantId,
        employeeId: id,
        createdBy: req.auth!.userId,
        // HR entering a record about someone else vouches for it; self-entered records wait for HR.
        ...(hr && !isSelf ? { verifiedBy: req.auth!.userId, verifiedAt: now } : {}),
      });
      await writeAudit(req, { action: 'employee.profile_item_add', entityType: 'Employee', entityId: id, after: { kind: doc.kind, title: doc.title } });
      res.status(201).json({ success: true, data: ser(doc.toObject()) });
    }),
  );

  route(
    v1,
    { method: 'patch', path: '/employees/:id/profile-items/:itemId', summary: 'Edit an item (null clears an optional field). Employees editing their own item clear its verification; only HR can set `verified`, and never on their own record.', tags: ['Employees'], auth: 'tenant', permission: 'employee:update | employee:update:self', body: patchBody },
    ...chain,
    requirePermission('employee:update', 'employee:update:self'),
    validate({ params: itemParams, body: patchBody }),
    asyncHandler(async (req, res) => {
      const { id, itemId } = req.params as { id: string; itemId: string };
      const { ctx, hr, isSelf } = await access(req, id, true);
      const before = await ProfileItem.findOne({ _id: itemId, tenantId: ctx.tenantId, employeeId: id }).lean();
      if (!before) throw AppError.notFound('Entry not found');
      const { verified, ...rest } = req.body as Record<string, any>;
      if (verified !== undefined && (!hr || isSelf))
        throw AppError.forbidden('Only HR can verify entries, and not on their own record');
      const $set: Item = {};
      const $unset: Item = {};
      for (const [k, v] of Object.entries(rest)) (v === null ? $unset : $set)[k] = v === null ? 1 : v;
      const merged: Item = { ...before, ...$set };
      for (const k of Object.keys($unset)) delete merged[k];
      const bad = checkItem(merged);
      if (bad) throw AppError.unprocessable(bad);
      const edited = Object.keys(rest).length > 0;
      if (verified === true) {
        $set.verifiedBy = req.auth!.userId;
        $set.verifiedAt = new Date();
      } else if (verified === false || (edited && !(hr && !isSelf))) {
        $unset.verifiedBy = 1;
        $unset.verifiedAt = 1;
      }
      if (!Object.keys($set).length && !Object.keys($unset).length) throw AppError.badRequest('Nothing to change');
      const after = await ProfileItem.findOneAndUpdate(
        { _id: itemId, tenantId: ctx.tenantId, employeeId: id },
        { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) },
        { new: true },
      ).lean();
      await writeAudit(req, { action: 'employee.profile_item_update', entityType: 'Employee', entityId: id, after: { itemId, fields: Object.keys(req.body) } });
      res.json({ success: true, data: ser(after!) });
    }),
  );

  route(
    v1,
    { method: 'delete', path: '/employees/:id/profile-items/:itemId', summary: 'Remove an item.', tags: ['Employees'], auth: 'tenant', permission: 'employee:update | employee:update:self' },
    ...chain,
    requirePermission('employee:update', 'employee:update:self'),
    validate({ params: itemParams }),
    asyncHandler(async (req, res) => {
      const { id, itemId } = req.params as { id: string; itemId: string };
      const { ctx } = await access(req, id, true);
      const gone = await ProfileItem.findOneAndDelete({ _id: itemId, tenantId: ctx.tenantId, employeeId: id }).lean();
      if (!gone) throw AppError.notFound('Entry not found');
      await writeAudit(req, { action: 'employee.profile_item_delete', entityType: 'Employee', entityId: id, before: { kind: gone.kind, title: gone.title } });
      res.json({ success: true, data: { id: itemId } });
    }),
  );
}
