import type { Request, Router } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { Department } from '../../database/models/department.model';
import { Employee } from '../../database/models/employee.model';
import { CHANGE_TYPES, EmploymentChange } from '../../database/models/employmentChange.model';
import { authenticate, requirePermission, resolveTenant } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/errors';
import { route } from '../../utils/route';
import { idParams, objectId, validate } from '../../utils/validate';
import { WORK_DATE_RE, isRealDate, localDate } from '../attendance/dates';
import { loadTenant } from '../attendance/attendance.service';
import { writeAudit } from '../audit/audit.service';
import { hasPermission } from '../auth/permissions';
import * as svc from './employees.service';

const date = z.string().regex(WORK_DATE_RE, 'Use YYYY-MM-DD').refine(isRealDate, 'Invalid date');
const body = z
  .object({
    type: z.enum(CHANGE_TYPES),
    effectiveDate: date,
    reason: z.string().trim().min(3).max(500),
    designationId: objectId,
    departmentId: objectId,
    managerId: objectId.nullable(),
    workLocationIds: z.array(objectId).max(20),
  })
  .partial()
  .required({ type: true, effectiveDate: true, reason: true })
  .strict();

type Doc = Record<string, any>;
const ser = (c: Doc) => ({
  id: String(c._id),
  employeeId: String(c.employeeId),
  type: c.type,
  effectiveDate: c.effectiveDate,
  reason: c.reason,
  before: c.before ?? undefined,
  after: c.after ?? undefined,
  createdAt: c.createdAt,
});

export function registerChangeRoutes(v1: Router, env: Env): void {
  const chain = [authenticate(env), resolveTenant];

  route(
    v1,
    { method: 'get', path: '/employees/:id/changes', summary: 'Promotions, transfers and salary revisions, newest first. HR/owner for anyone; employees for themselves.', tags: ['Employees'], auth: 'tenant', permission: 'employee:read:all | employee:read:self' },
    ...chain,
    requirePermission('employee:read:all', 'employee:read:self'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      const id = String(req.params.id);
      const self = !!ctx.employeeId && String(ctx.employeeId) === id;
      if (!hasPermission(ctx.roles, 'employee:read:all') && !self) throw AppError.notFound('Employee not found');
      if (!(await Employee.exists({ _id: id, tenantId: ctx.tenantId }))) throw AppError.notFound('Employee not found');
      const items = await EmploymentChange.find({ tenantId: ctx.tenantId, employeeId: id })
        .sort({ effectiveDate: -1, createdAt: -1 })
        .limit(200)
        .lean();
      res.json({ success: true, data: items.map(ser) });
    }),
  );

  route(
    v1,
    { method: 'post', path: '/employees/:id/changes', summary: 'Record a promotion (needs a new designation), a transfer (department, manager or locations) or a salary revision (no field change). Applies at once; the effective date cannot be in the future, before the joining date or before the previous change.', tags: ['Employees'], auth: 'tenant', permission: 'employee:change', body, successStatus: 201 },
    ...chain,
    requirePermission('employee:change'),
    validate({ params: idParams, body }),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      const id = String(req.params.id);
      const b = req.body as z.infer<typeof body>;
      if (ctx.employeeId && String(ctx.employeeId) === id)
        throw AppError.forbidden('You cannot record a change on your own record');
      const emp = await Employee.findOne({ _id: id, tenantId: ctx.tenantId });
      if (!emp) throw AppError.notFound('Employee not found');
      if (emp.employmentStatus === 'TERMINATED') throw AppError.conflict('Terminated employee records are read-only');

      const touches = ['designationId', 'departmentId', 'managerId', 'workLocationIds'].filter((k) => k in b);
      if (b.type === 'PROMOTION' && !b.designationId) throw AppError.unprocessable('A promotion needs the new designation');
      if (b.type === 'TRANSFER' && !touches.some((k) => k !== 'designationId'))
        throw AppError.unprocessable('A transfer needs a new department, manager or work location');
      if (b.type === 'SALARY_REVISION' && touches.length)
        throw AppError.unprocessable('A salary revision does not change role fields; set the new pay under Payroll');
      if (b.type === 'TRANSFER' && b.designationId) throw AppError.unprocessable('Use a promotion to change the designation');
      if (b.type === 'PROMOTION' && touches.some((k) => k !== 'designationId'))
        throw AppError.unprocessable('A promotion changes the designation only; record a transfer separately');

      const tenant = await loadTenant(ctx.tenantId);
      const today = localDate(new Date(), tenant.timezone);
      if (b.effectiveDate > today) throw AppError.unprocessable('The effective date cannot be in the future');
      const joined = emp.joiningDate ? localDate(emp.joiningDate, tenant.timezone) : undefined;
      if (joined && b.effectiveDate < joined) throw AppError.unprocessable('The effective date is before the joining date');
      const last = await EmploymentChange.findOne({ tenantId: ctx.tenantId, employeeId: id }).sort({ effectiveDate: -1 }).select('effectiveDate').lean();
      if (last && b.effectiveDate < last.effectiveDate)
        throw AppError.unprocessable(`The effective date is before the previous change (${last.effectiveDate})`);

      await svc.assertRefs(ctx.tenantId, b as never, id);
      const nameOf = async (empId?: unknown) =>
        empId ? (await Employee.findOne({ _id: empId, tenantId: ctx.tenantId }).select('firstName lastName').lean().then((m) => (m ? `${m.firstName} ${m.lastName}` : undefined))) : undefined;
      const deptName = async (d?: unknown) =>
        d ? (await Department.findOne({ _id: d, tenantId: ctx.tenantId }).select('name').lean())?.name : undefined;

      const before: Doc = {};
      const after: Doc = {};
      const $set: Doc = {};
      const guard: Doc = { _id: emp._id, tenantId: ctx.tenantId };
      const history: Doc[] = [];
      const h = { byUserId: req.auth!.userId, at: new Date(), reason: b.reason };
      if (b.designationId) {
        const title = await svc.designationTitle(ctx.tenantId, b.designationId);
        before.designation = emp.designation ?? undefined;
        after.designation = title;
        $set.designationId = b.designationId;
        $set.designation = title;
        guard.designationId = emp.designationId ?? null;
        history.push({ ...h, type: 'DESIGNATION_CHANGE', from: String(emp.designation ?? ''), to: title ?? '' });
      }
      if (b.departmentId) {
        before.departmentId = emp.departmentId ?? undefined;
        before.department = await deptName(emp.departmentId);
        after.departmentId = b.departmentId;
        after.department = await deptName(b.departmentId);
        $set.departmentId = b.departmentId;
        guard.departmentId = emp.departmentId ?? null;
        history.push({ ...h, type: 'DEPARTMENT_CHANGE', from: String(emp.departmentId ?? ''), to: b.departmentId });
      }
      if ('managerId' in b) {
        before.managerId = emp.managerId ?? undefined;
        before.manager = await nameOf(emp.managerId);
        after.managerId = b.managerId ?? undefined;
        after.manager = await nameOf(b.managerId);
        $set.managerId = b.managerId ?? null;
        guard.managerId = emp.managerId ?? null;
        history.push({ ...h, type: 'MANAGER_CHANGE', from: String(emp.managerId ?? ''), to: String(b.managerId ?? '') });
      }
      if (b.workLocationIds) {
        before.workLocationIds = emp.workLocationIds ?? [];
        after.workLocationIds = b.workLocationIds;
        $set.workLocationIds = b.workLocationIds;
        guard.workLocationIds = emp.workLocationIds ?? [];
        history.push({ ...h, type: 'LOCATION_CHANGE', from: (emp.workLocationIds ?? []).join(','), to: b.workLocationIds.join(',') });
      }
      if (history.length) {
        const same = Object.entries($set).every(([k, v]) => String((emp as Doc)[k] ?? '') === String(v ?? ''));
        if (same) throw AppError.unprocessable('Nothing would change');
        // The guard stops two people overwriting each other's change.
        const applied = await Employee.findOneAndUpdate(guard, { $set, $push: { history: { $each: history } } }, { new: true }).lean();
        if (!applied) throw AppError.conflict('The employee was changed by someone else; reload and retry');
      }
      const rec = await EmploymentChange.create({
        tenantId: ctx.tenantId,
        employeeId: id,
        type: b.type,
        effectiveDate: b.effectiveDate,
        reason: b.reason,
        ...(Object.keys(before).length ? { before } : {}),
        ...(Object.keys(after).length ? { after } : {}),
        recordedBy: req.auth!.userId,
      });
      await writeAudit(req as Request, { action: 'employee.change_recorded', entityType: 'Employee', entityId: id, before, after: { type: b.type, effectiveDate: b.effectiveDate, ...after }, reason: b.reason });
      res.status(201).json({ success: true, data: ser(rec.toObject()) });
    }),
  );
}
