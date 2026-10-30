import type { Router } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env';
import {
  Employee,
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_TYPES,
  isEnded,
  PROBATION_STATUSES,
  SEPARATION_TYPES,
} from '../../database/models/employee.model';
import { TENANT_ROLES } from '../../database/models/membership.model';
import { authenticate, requirePermission, resolveTenant } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/errors';
import { rethrowDuplicate } from '../../utils/mongo';
import { route } from '../../utils/route';
import { idParams, objectId, paginationQuery, validate } from '../../utils/validate';
import { writeAudit } from '../audit/audit.service';
import { hasPermission } from '../auth/permissions';
import * as svc from './employees.service';

const dateInput = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid date')
  .transform((s) => new Date(s));
const address = z
  .object({
    line1: z.string().max(200),
    line2: z.string().max(200),
    city: z.string().max(100),
    state: z.string().max(100),
    postalCode: z.string().max(20),
    country: z.string().max(100),
  })
  .partial()
  .strict();
const emergencyContacts = z
  .array(
    z
      .object({
        name: z.string().max(100),
        relationship: z.string().max(50),
        phone: z.string().max(30),
      })
      .strict(),
  )
  .max(5);
const gender = z.enum(['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED']);
const personalEmail = z
  .string()
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());
const phone = z.string().regex(/^[0-9+()\-\s]{5,30}$/, 'Invalid phone number');

const createBody = z
  .object({
    employeeCode: z.string().trim().min(1).max(40).optional(),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    workEmail: z
      .string()
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    phone: phone.optional(),
    departmentId: objectId.optional(),
    designation: z.string().max(120).optional(),
    designationId: objectId.optional(),
    dateOfBirth: dateInput.optional(),
    gender: gender.optional(),
    personalEmail: personalEmail.optional(),
    managerId: objectId.optional(),
    employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
    attendanceMode: z.enum(['OFFICE', 'FIELD', 'REMOTE']).optional(),
    workLocationIds: z.array(objectId).max(20).optional(),
    joiningDate: dateInput.optional(),
    address: address.optional(),
    emergencyContacts: emergencyContacts.optional(),
  })
  .strict();

const adminPatchBody = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    phone,
    departmentId: objectId.nullable(),
    designation: z.string().max(120),
    designationId: objectId.nullable(),
    dateOfBirth: dateInput,
    gender,
    personalEmail,
    managerId: objectId.nullable(),
    employmentType: z.enum(EMPLOYMENT_TYPES),
    attendanceMode: z.enum(['OFFICE', 'FIELD', 'REMOTE']),
    workLocationIds: z.array(objectId).max(20),
    employmentStatus: z
      .enum(EMPLOYMENT_STATUSES)
      .refine(
        (s) => !isEnded(s) && s !== 'INVITED',
        'Use the deactivate endpoint to end employment',
      ),
    joiningDate: dateInput,
    noticePeriodStartDate: dateInput,
    lastWorkingDate: dateInput,
    address,
    emergencyContacts,
  })
  .partial()
  .strict();

const selfPatchBody = z
  .object({
    phone,
    personalEmail,
    address,
    emergencyContacts,
    profileImage: z.string().url().max(500),
  })
  .partial()
  .strict();
const patchDoc = z.union([adminPatchBody, selfPatchBody]);

const listQuery = z
  .object({
    ...paginationQuery,
    search: z.string().trim().max(100).optional(),
    departmentId: objectId.optional(),
    managerId: objectId.optional(),
    status: z.enum(EMPLOYMENT_STATUSES).optional(),
    employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
    probationStatus: z.enum(PROBATION_STATUSES).optional(),
    probationEndBefore: dateInput.optional(),
    sort: z
      .enum([
        'firstName',
        '-firstName',
        'lastName',
        '-lastName',
        'employeeCode',
        '-employeeCode',
        'joiningDate',
        '-joiningDate',
        'createdAt',
        '-createdAt',
      ])
      .optional(),
  })
  .strict();

const inviteBody = z
  .object({ roles: z.array(z.enum(TENANT_ROLES)).min(1).max(5).default(['EMPLOYEE']) })
  .strict();
const rolesBody = z.object({ roles: z.array(z.enum(TENANT_ROLES)).min(1).max(5) }).strict();
const deactivateBody = z
  .object({
    reason: z.string().trim().min(3).max(500),
    terminate: z.boolean().default(true),
    /** How employment ends: dismissed, resigned or retired. Only used when terminate is true. */
    separationType: z.enum(SEPARATION_TYPES).default('TERMINATED'),
    lastWorkingDate: dateInput.optional(),
  })
  .strict();

export function registerEmployeeRoutes(v1: Router, env: Env): void {
  const chain = [authenticate(env), resolveTenant];

  route(
    v1,
    {
      method: 'get',
      path: '/employees',
      summary: 'List employees visible to the caller (search, filter, sort, paginate).',
      tags: ['Employees'],
      auth: 'tenant',
      permission: 'employee:read:*',
      query: listQuery,
    },
    ...chain,
    requirePermission(
      'employee:read:all',
      'employee:read:team',
      'employee:read:basic',
      'employee:read:self',
    ),
    validate({ query: listQuery }),
    asyncHandler(async (req, res) => {
      const q = req.query as unknown as z.infer<typeof listQuery>;
      const { items, total } = await svc.listEmployees(req.tenantCtx!, q);
      res.json({ success: true, data: items, meta: { page: q.page, limit: q.limit, total } });
    }),
  );

  route(
    v1,
    {
      method: 'post',
      path: '/employees',
      summary: 'Create an employee record (status INVITED; no login until invited).',
      tags: ['Employees'],
      auth: 'tenant',
      permission: 'employee:create',
      body: createBody,
      successStatus: 201,
    },
    ...chain,
    requirePermission('employee:create'),
    validate({ body: createBody }),
    asyncHandler(async (req, res) => {
      const doc = await svc
        .createEmployee(req.tenantCtx!.tenantId, req.auth!.userId, req.body)
        .catch((e) =>
          rethrowDuplicate(e, 'An employee with this code or work email already exists'),
        );
      await writeAudit(req, {
        action: 'employee.create',
        entityType: 'Employee',
        entityId: doc._id,
        after: doc,
      });
      res
        .status(201)
        .json({ success: true, data: svc.serializeEmployee(doc.toObject() as never, 'FULL') });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/employees/:id',
      summary: 'Get one employee (field set depends on caller role and relationship).',
      tags: ['Employees'],
      auth: 'tenant',
      permission: 'employee:read:*',
    },
    ...chain,
    requirePermission(
      'employee:read:all',
      'employee:read:team',
      'employee:read:basic',
      'employee:read:self',
    ),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const { emp, view } = await svc.getEmployeeScoped(req.tenantCtx!, String(req.params.id));
      res.json({ success: true, data: svc.serializeEmployee(emp as never, view) });
    }),
  );

  route(
    v1,
    {
      method: 'patch',
      path: '/employees/:id',
      summary:
        'Update an employee. HR/owner: employment fields. Employees: only their own phone, address, emergency contacts, photo.',
      tags: ['Employees'],
      auth: 'tenant',
      permission: 'employee:update | employee:update:self',
      body: patchDoc,
    },
    ...chain,
    requirePermission('employee:update', 'employee:update:self'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      const id = String(req.params.id);
      const admin = hasPermission(ctx, 'employee:update');
      if (!admin && String(ctx.employeeId) !== id) throw AppError.forbidden();
      const body = (admin ? adminPatchBody : selfPatchBody).parse(req.body ?? {}) as Record<
        string,
        unknown
      >;
      const before = await Employee.findOne({ _id: id, tenantId: ctx.tenantId });
      if (!before) throw AppError.notFound('Employee not found');
      if (isEnded(before.employmentStatus))
        throw AppError.conflict('Records of employees whose employment has ended are read-only');
      await svc.assertRefs(
        ctx.tenantId,
        body as {
          departmentId?: string | null;
          designationId?: string | null;
          managerId?: string | null;
          workLocationIds?: string[];
        },
        id,
      );
      const snapshot = before.toObject();
      const history: Record<string, unknown>[] = [];
      const base = { byUserId: req.auth!.userId, at: new Date() };
      if (
        'departmentId' in body &&
        String(before.departmentId ?? '') !== String(body.departmentId ?? '')
      )
        history.push({
          ...base,
          type: 'DEPARTMENT_CHANGE',
          from: String(before.departmentId ?? ''),
          to: String(body.departmentId ?? ''),
        });
      if (
        'designationId' in body &&
        String(before.designationId ?? '') !== String(body.designationId ?? '')
      ) {
        const title = await svc.designationTitle(ctx.tenantId, body.designationId);
        if (title) body.designation = title;
        history.push({
          ...base,
          type: 'DESIGNATION_CHANGE',
          from: String(before.designation ?? ''),
          to: title ?? '',
        });
      }
      if ('managerId' in body && String(before.managerId ?? '') !== String(body.managerId ?? ''))
        history.push({
          ...base,
          type: 'MANAGER_CHANGE',
          from: String(before.managerId ?? ''),
          to: String(body.managerId ?? ''),
        });
      if (
        typeof body.employmentStatus === 'string' &&
        body.employmentStatus !== before.employmentStatus
      ) {
        const to = body.employmentStatus as (typeof EMPLOYMENT_STATUSES)[number];
        if (!svc.canTransition(before.employmentStatus, to))
          throw AppError.conflict(
            `Cannot change employment status from ${before.employmentStatus} to ${to}`,
          );
        history.push({ ...base, type: 'STATUS_CHANGE', from: before.employmentStatus, to });
        if (to === 'NOTICE_PERIOD' && !body.noticePeriodStartDate && !before.noticePeriodStartDate)
          body.noticePeriodStartDate = new Date();
      }
      for (const [k, v] of Object.entries(body))
        (before as unknown as Record<string, unknown>)[k] = v;
      before.history.push(...(history as never[]));
      await before.save();
      await writeAudit(req, {
        action: 'employee.update',
        entityType: 'Employee',
        entityId: before._id,
        before: snapshot,
        after: before,
      });
      const view = svc.viewFor(ctx, before as never) ?? 'SELF';
      res.json({ success: true, data: svc.serializeEmployee(before.toObject() as never, view) });
    }),
  );

  route(
    v1,
    {
      method: 'post',
      path: '/employees/:id/invite',
      summary: 'Create or link a login account and issue a single-use activation link.',
      tags: ['Employees'],
      auth: 'tenant',
      permission: 'employee:invite',
      body: inviteBody,
    },
    ...chain,
    requirePermission('employee:invite'),
    validate({ params: idParams, body: inviteBody }),
    asyncHandler(async (req, res) => {
      const result = await svc.inviteEmployee(
        env,
        req.tenantCtx!,
        req.auth!.userId,
        String(req.params.id),
        req.body.roles,
      );
      await writeAudit(req, {
        action: 'employee.invite',
        entityType: 'Employee',
        entityId: String(req.params.id),
        after: { roles: req.body.roles },
      });
      res.json({ success: true, data: result });
    }),
  );

  route(
    v1,
    {
      method: 'patch',
      path: '/employees/:id/roles',
      summary: "Change a user's company roles (privilege-escalation guarded).",
      tags: ['Employees'],
      auth: 'tenant',
      permission: 'employee:roles',
      body: rolesBody,
    },
    ...chain,
    requirePermission('employee:roles'),
    validate({ params: idParams, body: rolesBody }),
    asyncHandler(async (req, res) => {
      const { before, after } = await svc.setRoles(
        req.tenantCtx!,
        req.auth!.userId,
        String(req.params.id),
        req.body.roles,
      );
      await writeAudit(req, {
        action: 'employee.roles_change',
        entityType: 'Employee',
        entityId: String(req.params.id),
        before: { roles: before },
        after: { roles: after },
      });
      res.json({ success: true, data: { roles: after } });
    }),
  );

  route(
    v1,
    {
      method: 'post',
      path: '/employees/:id/deactivate',
      summary:
        'Disable login and (by default) end employment as TERMINATED, RESIGNED or RETIRED (separationType). Historical records are retained.',
      tags: ['Employees'],
      auth: 'tenant',
      permission: 'employee:deactivate',
      body: deactivateBody,
    },
    ...chain,
    requirePermission('employee:deactivate'),
    validate({ params: idParams, body: deactivateBody }),
    asyncHandler(async (req, res) => {
      const emp = await svc.deactivateEmployee(
        req.tenantCtx!.tenantId,
        req.auth!.userId,
        String(req.params.id),
        req.body,
      );
      await writeAudit(req, {
        action: 'employee.deactivate',
        entityType: 'Employee',
        entityId: emp._id,
        reason: req.body.reason,
        after: { employmentStatus: emp.employmentStatus },
      });
      res.json({ success: true, data: { employmentStatus: emp.employmentStatus } });
    }),
  );

  const noticeBody = z
    .object({
      noticePeriodStartDate: dateInput,
      lastWorkingDate: dateInput,
      reason: z.string().trim().max(500).optional(),
    })
    .strict();
  route(
    v1,
    {
      method: 'post',
      path: '/employees/:id/notice-period',
      summary: 'Start a notice period (status NOTICE_PERIOD) with a last working day.',
      tags: ['Employees'],
      auth: 'tenant',
      permission: 'employee:update',
      body: noticeBody,
    },
    ...chain,
    requirePermission('employee:update'),
    validate({ params: idParams, body: noticeBody }),
    asyncHandler(async (req, res) => {
      const emp = await svc.startNoticePeriod(
        req.tenantCtx!.tenantId,
        req.auth!.userId,
        String(req.params.id),
        req.body,
      );
      await writeAudit(req, {
        action: 'employee.notice_period',
        entityType: 'Employee',
        entityId: emp._id,
        reason: req.body.reason,
        after: { employmentStatus: emp.employmentStatus, lastWorkingDate: emp.lastWorkingDate },
      });
      res.json({
        success: true,
        data: { employmentStatus: emp.employmentStatus, lastWorkingDate: emp.lastWorkingDate },
      });
    }),
  );

  const probationBody = z
    .object({ endDate: dateInput, reason: z.string().trim().max(500).optional() })
    .strict();
  route(
    v1,
    {
      method: 'post',
      path: '/employees/:id/probation',
      summary:
        'Start probation with an end date, or extend it (later end date and a reason). Recorded in the employee history.',
      tags: ['Employees'],
      auth: 'tenant',
      permission: 'employee:update',
      body: probationBody,
    },
    ...chain,
    requirePermission('employee:update'),
    validate({ params: idParams, body: probationBody }),
    asyncHandler(async (req, res) => {
      const emp = await svc.setProbation(
        req.tenantCtx!.tenantId,
        req.auth!.userId,
        String(req.params.id),
        req.body,
      );
      await writeAudit(req, {
        action: 'employee.probation_set',
        entityType: 'Employee',
        entityId: emp._id,
        reason: req.body.reason,
        after: { probationStatus: emp.probationStatus, probationEndDate: emp.probationEndDate },
      });
      res.json({
        success: true,
        data: { probationStatus: emp.probationStatus, probationEndDate: emp.probationEndDate },
      });
    }),
  );

  const confirmBody = z
    .object({
      confirmationDate: dateInput.optional(),
      comment: z.string().trim().max(500).optional(),
    })
    .strict();
  route(
    v1,
    {
      method: 'post',
      path: '/employees/:id/confirm',
      summary:
        'Confirm an employee who is on probation. Cannot be used on your own record. Recorded in the history and audit log.',
      tags: ['Employees'],
      auth: 'tenant',
      permission: 'employee:confirm',
      body: confirmBody,
    },
    ...chain,
    requirePermission('employee:confirm'),
    validate({ params: idParams, body: confirmBody }),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      const emp = await svc.confirmEmployee(
        ctx.tenantId,
        { userId: req.auth!.userId, employeeId: ctx.employeeId },
        String(req.params.id),
        req.body,
      );
      await writeAudit(req, {
        action: 'employee.confirmed',
        entityType: 'Employee',
        entityId: emp._id,
        reason: req.body.comment,
        after: { probationStatus: emp.probationStatus, confirmationDate: emp.confirmationDate },
      });
      res.json({
        success: true,
        data: { probationStatus: emp.probationStatus, confirmationDate: emp.confirmationDate },
      });
    }),
  );

  const reactivateBody = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
  route(
    v1,
    {
      method: 'post',
      path: '/employees/:id/reactivate',
      summary:
        'Re-enable a deactivated or terminated employee. Returns with the EMPLOYEE role only.',
      tags: ['Employees'],
      auth: 'tenant',
      permission: 'employee:reactivate',
      body: reactivateBody,
    },
    ...chain,
    requirePermission('employee:reactivate'),
    validate({ params: idParams, body: reactivateBody }),
    asyncHandler(async (req, res) => {
      const emp = await svc.reactivateEmployee(
        req.tenantCtx!.tenantId,
        req.auth!.userId,
        String(req.params.id),
        req.body.reason,
      );
      await writeAudit(req, {
        action: 'employee.reactivate',
        entityType: 'Employee',
        entityId: emp._id,
        reason: req.body.reason,
        after: { employmentStatus: emp.employmentStatus },
      });
      res.json({ success: true, data: { employmentStatus: emp.employmentStatus } });
    }),
  );
}
