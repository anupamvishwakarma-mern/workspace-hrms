import { Types } from 'mongoose';
import { formatNumber, numberingFor } from '../tenants/numbering';
import { isDuplicateKey } from '../../utils/mongo';
import type { Request } from 'express';
import type { Env } from '../../config/env';
import { Department } from '../../database/models/department.model';
import { Designation } from '../../database/models/designation.model';
import { Employee, type EmploymentStatus } from '../../database/models/employee.model';
import { nextSequence } from '../../database/models/counter.model';
import { Membership, type TenantRole } from '../../database/models/membership.model';
import { Session } from '../../database/models/session.model';
import { Tenant } from '../../database/models/tenant.model';
import { User } from '../../database/models/user.model';
import { WorkLocation } from '../../database/models/workLocation.model';
import { AppError } from '../../utils/errors';
import { escapeRegex } from '../../utils/validate';
import { hasPermission, assignableRoles } from '../auth/permissions';
import { issueOneTimeToken } from '../auth/token.service';
import { sendEmail } from '../notifications/email.service';

type Lean = Record<string, unknown> & { _id: Types.ObjectId };
type View = 'FULL' | 'SELF' | 'TEAM' | 'BASIC';

const BASIC = [
  'employeeCode',
  'firstName',
  'lastName',
  'departmentId',
  'designation',
  'designationId',
  'employmentType',
  'employmentStatus',
  'joiningDate',
];
const TEAM = [
  ...BASIC,
  'workEmail',
  'phone',
  'managerId',
  'profileImage',
  'lastWorkingDate',
  'probationStatus',
  'probationEndDate',
];
const SELF = [
  ...TEAM,
  'confirmationDate',
  'dateOfBirth',
  'gender',
  'personalEmail',
  'noticePeriodStartDate',
  'emergencyContacts',
  'address',
  'workLocationIds',
  'attendanceMode',
];
const FULL = [...SELF, 'userId', 'history', 'createdAt', 'updatedAt'];
const FIELDS: Record<View, string[]> = { BASIC, TEAM, SELF, FULL };

export function viewFor(
  ctx: NonNullable<Request['tenantCtx']>,
  emp: { _id: Types.ObjectId; managerId?: Types.ObjectId | null },
): View | null {
  const isSelf = !!ctx.employeeId && String(ctx.employeeId) === String(emp._id);
  if (hasPermission(ctx.roles, 'employee:read:all')) return 'FULL';
  if (isSelf && hasPermission(ctx.roles, 'employee:read:self')) return 'SELF';
  if (
    hasPermission(ctx.roles, 'employee:read:team') &&
    ctx.employeeId &&
    emp.managerId &&
    String(emp.managerId) === String(ctx.employeeId)
  )
    return 'TEAM';
  if (hasPermission(ctx.roles, 'employee:read:basic')) return 'BASIC';
  return null;
}

export function serializeEmployee(emp: Lean, view: View) {
  const out: Record<string, unknown> = { id: String(emp._id) };
  for (const f of FIELDS[view]) {
    const v = emp[f];
    if (v === undefined) continue;
    out[f] =
      v instanceof Types.ObjectId
        ? String(v)
        : Array.isArray(v) && v[0] instanceof Types.ObjectId
          ? v.map(String)
          : v;
  }
  return out;
}

/** Mongo filter limiting which employee records the caller may see at all. */
export function visibilityFilter(ctx: NonNullable<Request['tenantCtx']>): Record<string, unknown> {
  const base = { tenantId: ctx.tenantId };
  if (
    hasPermission(ctx.roles, 'employee:read:all') ||
    hasPermission(ctx.roles, 'employee:read:basic')
  )
    return base;
  const me = ctx.employeeId;
  if (!me) return { ...base, _id: { $in: [] } };
  const or: Record<string, unknown>[] = [];
  if (hasPermission(ctx.roles, 'employee:read:self')) or.push({ _id: me });
  if (hasPermission(ctx.roles, 'employee:read:team')) or.push({ managerId: me });
  return or.length ? { ...base, $or: or } : { ...base, _id: { $in: [] } };
}

export interface ListParams {
  page: number;
  limit: number;
  search?: string;
  departmentId?: string;
  managerId?: string;
  status?: EmploymentStatus;
  employmentType?: string;
  probationStatus?: string;
  probationEndBefore?: Date;
  sort?: string;
}

export async function listEmployees(ctx: NonNullable<Request['tenantCtx']>, p: ListParams) {
  const filter: Record<string, unknown> = visibilityFilter(ctx);
  const and: Record<string, unknown>[] = [];
  if (p.departmentId) and.push({ departmentId: p.departmentId });
  if (p.managerId) and.push({ managerId: p.managerId });
  if (p.status) and.push({ employmentStatus: p.status });
  if (p.employmentType) and.push({ employmentType: p.employmentType });
  if (p.probationStatus) and.push({ probationStatus: p.probationStatus });
  if (p.probationEndBefore) and.push({ probationEndDate: { $lte: p.probationEndBefore } });
  if (p.search) {
    const rx = new RegExp(escapeRegex(p.search), 'i');
    and.push({
      $or: [{ firstName: rx }, { lastName: rx }, { employeeCode: rx }, { workEmail: rx }],
    });
  }
  const finalFilter = and.length ? { $and: [filter, ...and] } : filter;
  const sortField = (p.sort ?? 'lastName').replace(/^-/, '');
  const sort: Record<string, 1 | -1> = { [sortField]: p.sort?.startsWith('-') ? -1 : 1, _id: 1 };
  const [items, total] = await Promise.all([
    Employee.find(finalFilter)
      .sort(sort)
      .skip((p.page - 1) * p.limit)
      .limit(p.limit)
      .lean(),
    Employee.countDocuments(finalFilter),
  ]);
  return {
    items: items
      .map((e) => ({ e, view: viewFor(ctx, e as never) }))
      .filter((x) => x.view)
      .map((x) => serializeEmployee(x.e as unknown as Lean, x.view!)),
    total,
  };
}

export async function getEmployeeScoped(ctx: NonNullable<Request['tenantCtx']>, id: string) {
  const emp = await Employee.findOne({ $and: [visibilityFilter(ctx), { _id: id }] }).lean();
  const view = emp ? viewFor(ctx, emp as never) : null;
  if (!emp || !view) throw AppError.notFound('Employee not found'); // 404 (not 403): do not reveal existence
  return { emp, view };
}

export async function assertRefs(
  tenantId: Types.ObjectId,
  refs: {
    departmentId?: string | null;
    designationId?: string | null;
    managerId?: string | null;
    workLocationIds?: string[];
  },
  selfId?: string,
) {
  if (refs.workLocationIds?.length) {
    const unique = new Set(refs.workLocationIds);
    const n = await WorkLocation.countDocuments({ _id: { $in: [...unique] }, tenantId });
    if (n !== unique.size)
      throw AppError.badRequest(
        'workLocationIds contains a location that does not exist in this company',
      );
  }
  if (refs.departmentId && !(await Department.exists({ _id: refs.departmentId, tenantId })))
    throw AppError.badRequest('departmentId does not reference a department in this company');
  if (refs.designationId) {
    const d = await Designation.findOne({ _id: refs.designationId, tenantId })
      .select('status')
      .lean();
    if (!d)
      throw AppError.badRequest('designationId does not reference a designation in this company');
    if (d.status !== 'ACTIVE') throw AppError.badRequest('That designation is inactive');
  }
  if (refs.managerId) {
    if (selfId && refs.managerId === selfId)
      throw AppError.badRequest('An employee cannot be their own manager');
    if (!(await Employee.exists({ _id: refs.managerId, tenantId })))
      throw AppError.badRequest('managerId does not reference an employee in this company');
    if (selfId) {
      let cursor: string | undefined = refs.managerId;
      for (let i = 0; cursor && i < 50; i++) {
        if (cursor === selfId)
          throw AppError.badRequest('Manager assignment would create a reporting cycle');
        const up: { managerId?: Types.ObjectId | null } | null = await Employee.findOne({
          _id: cursor,
          tenantId,
        })
          .select('managerId')
          .lean();
        cursor = up?.managerId ? String(up.managerId) : undefined;
      }
    }
  }
}

const TRANSITIONS: Record<EmploymentStatus, EmploymentStatus[]> = {
  INVITED: ['ACTIVE', 'TERMINATED'],
  ACTIVE: ['ON_LEAVE', 'NOTICE_PERIOD', 'TERMINATED'],
  ON_LEAVE: ['ACTIVE', 'NOTICE_PERIOD', 'TERMINATED'],
  NOTICE_PERIOD: ['ACTIVE', 'TERMINATED'],
  TERMINATED: [],
};
export const canTransition = (from: EmploymentStatus, to: EmploymentStatus) =>
  TRANSITIONS[from]?.includes(to) ?? false;

/** Seat limit: blocks adding (or bringing back) an employee once the company is at its member count. */
export async function assertSeatAvailable(tenantId: Types.ObjectId) {
  const tenant = await Tenant.findById(tenantId).select('maxEmployees').lean();
  const max = tenant?.maxEmployees;
  if (!max) return; // unlimited (older companies)
  const used = await Employee.countDocuments({
    tenantId,
    employmentStatus: { $ne: 'TERMINATED' },
  });
  if (used >= max)
    throw new AppError(
      409,
      'SEAT_LIMIT_REACHED',
      `This company is limited to ${max} members and already has ${used}. Ask the platform administrator to raise the limit.`,
      { maxEmployees: max, used },
    );
}

/** The display title of a designation (so employees, payslips and letters keep a readable snapshot). */
export async function designationTitle(
  tenantId: Types.ObjectId,
  designationId: unknown,
): Promise<string | undefined> {
  if (!designationId) return undefined;
  const d = await Designation.findOne({ _id: designationId, tenantId }).select('title').lean();
  return d?.title;
}

export async function createEmployee(
  tenantId: Types.ObjectId,
  actorId: Types.ObjectId,
  input: Record<string, unknown> & { employeeCode?: string },
) {
  await assertSeatAvailable(tenantId);
  await assertRefs(
    tenantId,
    input as {
      departmentId?: string;
      designationId?: string;
      managerId?: string;
      workLocationIds?: string[];
    },
  );
  const title = await designationTitle(tenantId, input.designationId);
  if (title) input = { ...input, designation: title };
  const create = (code: string) =>
    Employee.create({
      ...input,
      employeeCode: code,
      tenantId,
      employmentStatus: 'INVITED',
      history: [{ type: 'CREATED', to: 'INVITED', byUserId: actorId }],
    });
  if (input.employeeCode) return create(input.employeeCode);
  const rule = (await numberingFor(tenantId)).employee;
  // Generated codes can collide with codes that were typed in by hand or imported (e.g. EMP-0001).
  // Skip taken codes rather than failing the request; the unique index stays the source of truth.
  for (let attempt = 0; ; attempt++) {
    const code = formatNumber(rule, await nextSequence(`employee:${tenantId}`));
    try {
      return await create(code);
    } catch (e) {
      const pattern = (e as { keyPattern?: Record<string, unknown> }).keyPattern;
      if (attempt < 50 && isDuplicateKey(e) && pattern && 'employeeCode' in pattern) continue;
      throw e;
    }
  }
}

export async function inviteEmployee(
  env: Env,
  ctx: NonNullable<Request['tenantCtx']>,
  actorId: Types.ObjectId,
  employeeId: string,
  roles: TenantRole[],
) {
  const tenantId = ctx.tenantId;
  const emp = await Employee.findOne({ _id: employeeId, tenantId });
  if (!emp) throw AppError.notFound('Employee not found');
  if (emp.employmentStatus === 'TERMINATED')
    throw AppError.conflict('Terminated employees cannot be invited');
  const allowed = assignableRoles(ctx.roles);
  if (roles.some((r) => !allowed.has(r)))
    throw AppError.forbidden('You cannot assign one or more of the requested roles');

  let user = await User.findOne({ email: emp.workEmail });
  if (emp.userId && user && String(emp.userId) !== String(user._id))
    throw AppError.conflict('Employee is already linked to a different account');
  if (user?.status === 'DISABLED') throw AppError.conflict('This account is disabled');
  const existingMembership = user ? await Membership.findOne({ tenantId, userId: user._id }) : null;
  if (user?.status === 'ACTIVE' && existingMembership?.status === 'ACTIVE')
    throw AppError.conflict('Employee already has active access');
  user ??= await User.create({ email: emp.workEmail, status: 'INVITED' });

  await Membership.findOneAndUpdate(
    { tenantId, userId: user._id },
    { $set: { roles, employeeId: emp._id, status: 'ACTIVE' } },
    { upsert: true },
  );
  emp.userId = user._id;
  if (user.status === 'ACTIVE' && emp.employmentStatus === 'INVITED')
    emp.employmentStatus = 'ACTIVE';
  emp.history.push({ type: 'INVITED', byUserId: actorId, at: new Date() } as never);
  await emp.save();

  if (user.status === 'INVITED') {
    const raw = await issueOneTimeToken(
      env,
      user._id,
      'ACTIVATION',
      env.INVITE_TTL_HOURS * 3_600_000,
    );
    const tenant = await Tenant.findById(tenantId).select('name').lean();
    await sendEmail(env, {
      tenantId,
      to: emp.workEmail,
      template: 'ACTIVATION',
      subject: `You have been invited to ${tenant?.name ?? 'your company'}`,
      link: `${env.WEB_APP_URL}/activate?token=${raw}`,
    });
  }
  return { userStatus: user.status, employmentStatus: emp.employmentStatus };
}

async function activeOwnerCount(tenantId: Types.ObjectId, excludeUserId?: Types.ObjectId) {
  return Membership.countDocuments({
    tenantId,
    status: 'ACTIVE',
    roles: 'COMPANY_OWNER',
    ...(excludeUserId ? { userId: { $ne: excludeUserId } } : {}),
  });
}

export async function deactivateEmployee(
  tenantId: Types.ObjectId,
  actorUserId: Types.ObjectId,
  employeeId: string,
  opts: { reason: string; terminate: boolean; lastWorkingDate?: Date },
) {
  const emp = await Employee.findOne({ _id: employeeId, tenantId });
  if (!emp) throw AppError.notFound('Employee not found');
  if (emp.userId && String(emp.userId) === String(actorUserId))
    throw AppError.badRequest('You cannot deactivate your own account');
  const membership = emp.userId ? await Membership.findOne({ tenantId, userId: emp.userId }) : null;
  if (
    membership?.status === 'ACTIVE' &&
    membership.roles.includes('COMPANY_OWNER') &&
    (await activeOwnerCount(tenantId, membership.userId)) === 0
  ) {
    throw AppError.conflict('Cannot deactivate the last company owner');
  }
  if (membership) {
    membership.status = 'INACTIVE';
    await membership.save();
    const stillActive = await Membership.exists({ userId: membership.userId, status: 'ACTIVE' });
    if (!stillActive)
      await Session.updateMany(
        { userId: membership.userId, revokedAt: null },
        { $set: { revokedAt: new Date(), revokedReason: 'ACCOUNT_DEACTIVATED' } },
      );
  }
  if (opts.terminate && emp.employmentStatus !== 'TERMINATED') {
    emp.history.push({
      type: 'STATUS_CHANGE',
      from: emp.employmentStatus,
      to: 'TERMINATED',
      byUserId: actorUserId,
      reason: opts.reason,
      at: new Date(),
    } as never);
    emp.employmentStatus = 'TERMINATED';
    emp.lastWorkingDate = opts.lastWorkingDate ?? new Date();
  } else {
    emp.history.push({
      type: 'LOGIN_DEACTIVATED',
      byUserId: actorUserId,
      reason: opts.reason,
      at: new Date(),
    } as never);
  }
  await emp.save();
  return emp;
}

export async function setRoles(
  ctx: NonNullable<Request['tenantCtx']>,
  actorUserId: Types.ObjectId,
  employeeId: string,
  roles: TenantRole[],
) {
  const tenantId = ctx.tenantId;
  const emp = await Employee.findOne({ _id: employeeId, tenantId }).lean();
  const membership = emp?.userId
    ? await Membership.findOne({ tenantId, userId: emp.userId })
    : null;
  if (!emp || !membership) throw AppError.notFound('Employee has no account in this company');
  if (String(membership.userId) === String(actorUserId))
    throw AppError.forbidden('You cannot change your own roles');
  const allowed = assignableRoles(ctx.roles);
  if ([...roles, ...membership.roles].some((r) => !allowed.has(r)))
    throw AppError.forbidden('You cannot assign or remove one or more of these roles');
  if (
    membership.roles.includes('COMPANY_OWNER') &&
    !roles.includes('COMPANY_OWNER') &&
    (await activeOwnerCount(tenantId, membership.userId)) === 0
  ) {
    throw AppError.conflict('Cannot remove the last company owner');
  }
  const before = [...membership.roles];
  membership.roles = roles;
  await membership.save();
  return { before, after: roles };
}

/** Start (or move) the notice period. Login and attendance continue until the last working day. */
export async function startNoticePeriod(
  tenantId: Types.ObjectId,
  actorUserId: Types.ObjectId,
  employeeId: string,
  opts: { noticePeriodStartDate: Date; lastWorkingDate: Date; reason?: string },
) {
  if (opts.lastWorkingDate < opts.noticePeriodStartDate)
    throw AppError.badRequest('lastWorkingDate is before noticePeriodStartDate');
  const emp = await Employee.findOne({ _id: employeeId, tenantId });
  if (!emp) throw AppError.notFound('Employee not found');
  if (emp.employmentStatus !== 'ACTIVE' && emp.employmentStatus !== 'NOTICE_PERIOD')
    throw AppError.conflict(
      `Cannot start a notice period for an employee who is ${emp.employmentStatus}`,
    );
  if (emp.joiningDate && opts.lastWorkingDate < emp.joiningDate)
    throw AppError.badRequest('lastWorkingDate is before the joining date');
  emp.history.push({
    type: 'STATUS_CHANGE',
    from: emp.employmentStatus,
    to: 'NOTICE_PERIOD',
    byUserId: actorUserId,
    reason: opts.reason,
    at: new Date(),
  } as never);
  emp.employmentStatus = 'NOTICE_PERIOD';
  emp.noticePeriodStartDate = opts.noticePeriodStartDate;
  emp.lastWorkingDate = opts.lastWorkingDate;
  await emp.save();
  return emp;
}

/**
 * Re-enable a deactivated/terminated employee. Roles are NOT restored automatically: the membership
 * comes back as plain EMPLOYEE so a returning person never silently regains admin rights.
 */
export async function reactivateEmployee(
  tenantId: Types.ObjectId,
  actorUserId: Types.ObjectId,
  employeeId: string,
  reason: string,
) {
  const emp = await Employee.findOne({ _id: employeeId, tenantId });
  if (!emp) throw AppError.notFound('Employee not found');
  if (emp.employmentStatus === 'TERMINATED') await assertSeatAvailable(tenantId);
  const membership = emp.userId ? await Membership.findOne({ tenantId, userId: emp.userId }) : null;
  const loginDisabled = membership?.status === 'INACTIVE';
  if (emp.employmentStatus !== 'TERMINATED' && !loginDisabled)
    throw AppError.conflict('Employee is not deactivated');
  if (membership) {
    membership.status = 'ACTIVE';
    membership.roles = ['EMPLOYEE'];
    await membership.save();
  }
  emp.history.push({
    type: 'STATUS_CHANGE',
    from: emp.employmentStatus,
    to: membership ? 'ACTIVE' : 'INVITED',
    byUserId: actorUserId,
    reason,
    at: new Date(),
  } as never);
  // Someone who never had a login goes back to INVITED, not ACTIVE.
  emp.employmentStatus = membership ? 'ACTIVE' : 'INVITED';
  emp.lastWorkingDate = undefined;
  emp.noticePeriodStartDate = undefined;
  await emp.save();
  return emp;
}

/* ------------------------------ probation ------------------------------ */

/**
 * Start probation, or extend it (a later end date plus a reason). A confirmed employee cannot go back on probation,
 * and an ended employee cannot be changed.
 */
export async function setProbation(
  tenantId: Types.ObjectId,
  actorUserId: Types.ObjectId,
  employeeId: string,
  opts: { endDate: Date; reason?: string },
) {
  const emp = await Employee.findOne({ _id: employeeId, tenantId });
  if (!emp) throw AppError.notFound('Employee not found');
  if (emp.employmentStatus === 'TERMINATED')
    throw AppError.conflict('Terminated employee records are read-only');
  if (emp.probationStatus === 'CONFIRMED')
    throw AppError.conflict('This employee is already confirmed');
  if (emp.joiningDate && opts.endDate <= emp.joiningDate)
    throw AppError.badRequest('endDate must be after the joining date');
  const extending = emp.probationStatus === 'ON_PROBATION';
  if (extending) {
    if (!emp.probationEndDate || opts.endDate <= emp.probationEndDate)
      throw AppError.badRequest('An extension must end after the current probation end date');
    if (!opts.reason || opts.reason.length < 3)
      throw AppError.badRequest('A reason is required to extend probation');
  }
  emp.history.push({
    type: extending ? 'PROBATION_EXTENDED' : 'PROBATION_START',
    from: emp.probationEndDate ? emp.probationEndDate.toISOString().slice(0, 10) : '',
    to: opts.endDate.toISOString().slice(0, 10),
    byUserId: actorUserId,
    reason: opts.reason,
    at: new Date(),
  } as never);
  emp.probationStatus = 'ON_PROBATION';
  emp.probationEndDate = opts.endDate;
  await emp.save();
  return emp;
}

/**
 * Confirm an employee who is on probation. The decision is an atomic flip, so two simultaneous confirmations record
 * one history entry. Nobody confirms their own record, and someone serving notice is not confirmed.
 */
export async function confirmEmployee(
  tenantId: Types.ObjectId,
  actor: { userId: Types.ObjectId; employeeId?: Types.ObjectId },
  employeeId: string,
  opts: { confirmationDate?: Date; comment?: string },
) {
  if (actor.employeeId && String(actor.employeeId) === String(employeeId))
    throw AppError.forbidden('You cannot confirm your own employment');
  const at = new Date();
  const existing = await Employee.findOne({ _id: employeeId, tenantId })
    .select('joiningDate')
    .lean();
  if (!existing) throw AppError.notFound('Employee not found');
  const date = opts.confirmationDate ?? at;
  if (existing.joiningDate && date < existing.joiningDate)
    throw AppError.badRequest('confirmationDate is before the joining date');
  const done = await Employee.findOneAndUpdate(
    {
      _id: employeeId,
      tenantId,
      probationStatus: 'ON_PROBATION',
      employmentStatus: { $in: ['ACTIVE', 'ON_LEAVE'] },
    },
    {
      $set: { probationStatus: 'CONFIRMED', confirmationDate: date },
      $push: {
        history: {
          type: 'CONFIRMED',
          from: 'ON_PROBATION',
          to: 'CONFIRMED',
          byUserId: actor.userId,
          reason: opts.comment,
          at,
        },
      },
    },
    { new: true },
  );
  if (!done)
    throw AppError.conflict(
      'Only an active employee who is on probation can be confirmed (it may already have been confirmed)',
    );
  return done;
}
