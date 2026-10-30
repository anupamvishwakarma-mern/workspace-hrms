import type { Router } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env';
import {
  CustomRole,
  MAX_CUSTOM_ROLES,
  MAX_CUSTOM_ROLES_PER_PERSON,
} from '../../database/models/customRole.model';
import { Employee } from '../../database/models/employee.model';
import { Membership, TENANT_ROLES } from '../../database/models/membership.model';
import { authenticate, requirePermission, resolveTenant } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/errors';
import { route } from '../../utils/route';
import { escapeRegex, idParams, objectId, validate } from '../../utils/validate';
import { writeAudit } from '../audit/audit.service';
import { GRANTABLE_PERMISSIONS, isGrantable } from '../auth/customRoles';
import { assignableRoles, permissionsFor, type Permission } from '../auth/permissions';
import { moduleForPermission } from '../tenants/modules';

const roleName = z.string().trim().min(2).max(60);
const permissionList = z
  .array(z.string().trim().min(1).max(60))
  .max(120)
  .transform((a) => [...new Set(a)])
  .superRefine((a, ctx) => {
    const bad = a.filter((p) => !isGrantable(p));
    if (bad.length)
      ctx.addIssue({
        code: 'custom',
        message: `Not available for company roles: ${bad.join(', ')}`,
      });
  });
const createBody = z
  .object({
    name: roleName,
    description: z.string().trim().max(300).optional(),
    permissions: permissionList,
  })
  .strict();
const patchBody = z
  .object({
    name: roleName.optional(),
    description: z.string().trim().max(300).nullable().optional(),
    permissions: permissionList.optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');
const assignBody = z
  .object({ roleIds: z.array(objectId).max(MAX_CUSTOM_ROLES_PER_PERSON) })
  .strict();

/** Names of built-in roles are reserved, ignoring case, spaces and dashes ("HR Admin", "hr-admin"). */
const norm = (s: string) => s.trim().toUpperCase().replace(/[\s-]+/g, '_');
const RESERVED = new Set<string>([...TENANT_ROLES, 'OWNER', 'ADMIN', 'MANAGER', 'EMPLOYEE']);

const ser = (r: Record<string, unknown> & { _id: unknown }, assigned?: number) => ({
  id: String(r._id),
  name: r.name,
  description: r.description ?? null,
  permissions: r.permissions,
  ...(assigned === undefined ? {} : { assignedCount: assigned }),
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

export function registerRoleRoutes(v1: Router, env: Env): void {
  const chain = [authenticate(env), resolveTenant];

  route(
    v1,
    {
      method: 'get',
      path: '/roles/permissions',
      summary: 'Permissions that may be put into a company-defined role, grouped by area.',
      tags: ['Roles'],
      auth: 'tenant',
      permission: 'role:manage',
    },
    ...chain,
    requirePermission('role:manage'),
    asyncHandler(async (_req, res) => {
      res.json({
        success: true,
        data: GRANTABLE_PERMISSIONS.map((p) => ({
          permission: p,
          area: p.split(':')[0],
          module: moduleForPermission(p) ?? null,
        })),
      });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/roles',
      summary: 'Company-defined roles with how many people hold each.',
      tags: ['Roles'],
      auth: 'tenant',
      permission: 'employee:roles | role:manage',
    },
    ...chain,
    requirePermission('employee:roles', 'role:manage'),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      const roles = await CustomRole.find({ tenantId }).sort({ name: 1 }).lean();
      const counts = await Promise.all(
        roles.map((r) => Membership.countDocuments({ tenantId, customRoleIds: r._id })),
      );
      res.json({
        success: true,
        data: roles.map((r, i) => ser(r as never, counts[i])),
        meta: { max: MAX_CUSTOM_ROLES, maxPerPerson: MAX_CUSTOM_ROLES_PER_PERSON },
      });
    }),
  );

  route(
    v1,
    {
      method: 'post',
      path: '/roles',
      summary: 'Create a company-defined role (owner only).',
      tags: ['Roles'],
      auth: 'tenant',
      permission: 'role:manage',
      body: createBody,
      successStatus: 201,
    },
    ...chain,
    requirePermission('role:manage'),
    validate({ body: createBody }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      if (RESERVED.has(norm(req.body.name)))
        throw AppError.conflict('That name is used by a built-in role');
      if ((await CustomRole.countDocuments({ tenantId })) >= MAX_CUSTOM_ROLES)
        throw AppError.conflict(`A company can have at most ${MAX_CUSTOM_ROLES} custom roles`);
      if (await CustomRole.exists({ tenantId, name: new RegExp(`^${escapeRegex(req.body.name)}$`, 'i') }))
        throw AppError.conflict('A role with this name already exists');
      const role = await CustomRole.create({ ...req.body, tenantId, createdBy: req.auth!.userId });
      await writeAudit(req, {
        action: 'role.create',
        entityType: 'CustomRole',
        entityId: role._id,
        after: { name: role.name, permissions: role.permissions },
      });
      res.status(201).json({ success: true, data: ser(role.toObject() as never, 0) });
    }),
  );

  route(
    v1,
    {
      method: 'patch',
      path: '/roles/:id',
      summary: 'Rename a role or change its permissions (owner only). Takes effect on everyone holding it immediately.',
      tags: ['Roles'],
      auth: 'tenant',
      permission: 'role:manage',
      body: patchBody,
    },
    ...chain,
    requirePermission('role:manage'),
    validate({ params: idParams, body: patchBody }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      const role = await CustomRole.findOne({ _id: req.params.id, tenantId });
      if (!role) throw AppError.notFound('Role not found');
      const b = req.body as z.infer<typeof patchBody>;
      if (b.name && b.name !== role.name) {
        if (RESERVED.has(norm(b.name))) throw AppError.conflict('That name is used by a built-in role');
        if (
          await CustomRole.exists({
            tenantId,
            _id: { $ne: role._id },
            name: new RegExp(`^${escapeRegex(b.name)}$`, 'i'),
          })
        )
          throw AppError.conflict('A role with this name already exists');
      }
      const before = { name: role.name, description: role.description, permissions: [...role.permissions] };
      if (b.name !== undefined) role.name = b.name;
      if (b.description !== undefined) role.description = b.description ?? undefined;
      if (b.permissions !== undefined) role.permissions = b.permissions;
      await role.save();
      await writeAudit(req, {
        action: 'role.update',
        entityType: 'CustomRole',
        entityId: role._id,
        before,
        after: { name: role.name, description: role.description, permissions: role.permissions },
      });
      const assigned = await Membership.countDocuments({ tenantId, customRoleIds: role._id });
      res.json({ success: true, data: ser(role.toObject() as never, assigned) });
    }),
  );

  route(
    v1,
    {
      method: 'delete',
      path: '/roles/:id',
      summary: 'Delete a role nobody holds (owner only). A role that is still assigned is refused.',
      tags: ['Roles'],
      auth: 'tenant',
      permission: 'role:manage',
    },
    ...chain,
    requirePermission('role:manage'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      const role = await CustomRole.findOne({ _id: req.params.id, tenantId });
      if (!role) throw AppError.notFound('Role not found');
      const holders = await Membership.countDocuments({ tenantId, customRoleIds: role._id });
      if (holders > 0)
        throw new AppError(
          409,
          'ROLE_IN_USE',
          `${holders} ${holders === 1 ? 'person holds' : 'people hold'} this role. Remove it from them first.`,
          { holders },
        );
      await CustomRole.deleteOne({ _id: role._id, tenantId });
      await writeAudit(req, {
        action: 'role.delete',
        entityType: 'CustomRole',
        entityId: role._id,
        before: { name: role.name, permissions: role.permissions },
      });
      res.json({ success: true, data: { id: String(role._id) } });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/employees/:id/custom-roles',
      summary: "The company-defined roles an employee holds.",
      tags: ['Roles'],
      auth: 'tenant',
      permission: 'employee:roles | role:manage',
    },
    ...chain,
    requirePermission('employee:roles', 'role:manage'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      const emp = await Employee.findOne({ _id: req.params.id, tenantId }).select('userId').lean();
      const m = emp?.userId ? await Membership.findOne({ tenantId, userId: emp.userId }).lean() : null;
      if (!emp) throw AppError.notFound('Employee not found');
      res.json({ success: true, data: { roleIds: (m?.customRoleIds ?? []).map(String), hasAccount: !!m } });
    }),
  );

  route(
    v1,
    {
      method: 'put',
      path: '/employees/:id/custom-roles',
      summary:
        'Set the company-defined roles an employee holds. The owner may assign any role. HR admins may add only roles whose permissions they hold themselves, only to managers and employees, and never to themselves.',
      tags: ['Roles'],
      auth: 'tenant',
      permission: 'employee:roles | role:manage',
      body: assignBody,
    },
    ...chain,
    requirePermission('employee:roles', 'role:manage'),
    validate({ params: idParams, body: assignBody }),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      const tenantId = ctx.tenantId;
      const roleIds = [...new Set(req.body.roleIds as string[])];
      const emp = await Employee.findOne({ _id: req.params.id, tenantId }).select('userId').lean();
      if (!emp) throw AppError.notFound('Employee not found');
      const m = emp.userId ? await Membership.findOne({ tenantId, userId: emp.userId }) : null;
      if (!m) throw AppError.notFound('Employee has no account in this company');
      if (String(m.userId) === String(req.auth!.userId))
        throw AppError.forbidden('You cannot change your own roles');
      const isOwner = ctx.roles.includes('COMPANY_OWNER');
      if (!isOwner) {
        const allowed = assignableRoles(ctx.roles);
        if (m.roles.some((r) => !allowed.has(r)))
          throw AppError.forbidden('You cannot change the roles of this person');
      }
      const found = await CustomRole.find({ tenantId, _id: { $in: roleIds } }).lean();
      if (found.length !== roleIds.length) throw AppError.unprocessable('One or more roles do not exist');

      const current = new Set(m.customRoleIds.map(String));
      if (!isOwner) {
        // No escalation: HR can add only what HR already holds.
        const mine = new Set<Permission>([...permissionsFor(ctx.roles), ...(ctx.extraPermissions ?? [])]);
        for (const r of found.filter((x) => !current.has(String(x._id))))
          for (const p of r.permissions)
            if (isGrantable(p) && !mine.has(p as Permission))
              throw AppError.forbidden(
                `You cannot assign "${r.name}" because it includes permissions you do not hold yourself`,
              );
      }
      const before = [...current];
      m.customRoleIds = found.map((r) => r._id) as never;
      await m.save();
      await writeAudit(req, {
        action: 'employee.custom_roles',
        entityType: 'Employee',
        entityId: String(req.params.id),
        before: { roleIds: before },
        after: { roleIds: roleIds },
      });
      res.json({ success: true, data: { roleIds } });
    }),
  );
}
