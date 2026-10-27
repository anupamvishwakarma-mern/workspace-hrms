import { randomBytes } from 'node:crypto';
import mongoose, { type Types } from 'mongoose';
import { DateTime } from 'luxon';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { Counter } from '../../database/models/counter.model';
import { Employee } from '../../database/models/employee.model';
import { LeaveType } from '../../database/models/leaveType.model';
import { Membership } from '../../database/models/membership.model';
import { Shift } from '../../database/models/shift.model';
import { ShiftAssignment } from '../../database/models/shiftAssignment.model';
import { Tenant } from '../../database/models/tenant.model';
import { User } from '../../database/models/user.model';
import { runInTenantDb } from '../../database/tenantContext';
import { modelForDb, tenantModelNames } from '../../database/tenantModel';
import { AppError } from '../../utils/errors';
import { isDuplicateKey } from '../../utils/mongo';
import { issueOneTimeToken } from '../auth/token.service';
import { sendEmail } from '../notifications/email.service';
import { timezoneSchema } from './tenants.routes';

// Make sure every company-data model is registered before a database is provisioned.
import '../../database/models/attendanceCorrection.model';
import '../../database/models/attendanceDay.model';
import '../../database/models/attendanceEvent.model';
import '../../database/models/attendanceException.model';
import '../../database/models/auditLog.model';
import '../../database/models/department.model';
import '../../database/models/employeeDocument.model';
import '../../database/models/handbookSection.model';
import '../../database/models/holiday.model';
import '../../database/models/leaveRequest.model';
import '../../database/models/letter.model';
import '../../database/models/payroll.model';
import '../../database/models/punchPhoto.model';
import '../../database/models/salaryStructure.model';
import '../../database/models/workLocation.model';

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
export const MAX_MEMBERS = 10_000;

export const ownerSchema = z
  .object({
    email: z
      .string()
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
  })
  .strict();

export const onboardBody = z
  .object({
    name: z.string().trim().min(2).max(200),
    /** Optional: derived from the company name when omitted. Also names the database (ACME -> ACME_HRM). */
    slug: z.string().trim().toLowerCase().regex(SLUG_RE, 'Use 3-40 lowercase letters, digits or hyphens').optional(),
    timezone: timezoneSchema.default('UTC'),
    /** Number of members (employees) the company will have: enforced as a hard seat limit. */
    maxEmployees: z.number().int().min(1).max(MAX_MEMBERS),
    owner: ownerSchema,
  })
  .strict();
export type OnboardInput = Omit<z.infer<typeof onboardBody>, 'maxEmployees'> & {
  /** Omitted = unlimited (platform operators only; public signup always sets it). */
  maxEmployees?: number;
};

/** "acme-corp" -> "ACME_CORP_HRM" */
export const dbNameForSlug = (slug: string): string => `${slug.toUpperCase().replace(/-/g, '_')}_HRM`;

export function slugFromName(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
  return base.length >= 3 ? base : `${base || 'company'}-hrm`.slice(0, 32);
}

/** Creates the collections and indexes of a brand-new company database. */
export async function createTenantDatabase(dbName: string): Promise<void> {
  for (const name of tenantModelNames()) {
    const m = modelForDb(dbName, name);
    try {
      await m.createCollection();
    } catch (e) {
      if ((e as { code?: number }).code !== 48) throw e; // 48 = already exists
    }
    await m.init();
  }
}

export async function dropTenantDatabase(dbName: string): Promise<void> {
  await mongoose.connection.useDb(dbName, { useCache: true }).dropDatabase();
}

async function resolveSlug(input: OnboardInput): Promise<string> {
  if (input.slug) {
    if (await Tenant.exists({ $or: [{ slug: input.slug }, { dbName: dbNameForSlug(input.slug) }] }))
      throw AppError.conflict('A company with this slug already exists');
    return input.slug;
  }
  const base = slugFromName(input.name);
  for (let i = 0; i < 6; i++) {
    const slug = i === 0 ? base : `${base.slice(0, 33)}-${randomBytes(2).toString('hex')}`;
    if (!(await Tenant.exists({ $or: [{ slug }, { dbName: dbNameForSlug(slug) }] }))) return slug;
  }
  throw AppError.conflict('Could not pick a unique company address, please choose one');
}

const DEFAULT_LEAVE_TYPES = [
  { name: 'Casual Leave', code: 'CL', paid: true, annualAllowanceDays: 12, allowHalfDay: true },
  { name: 'Sick Leave', code: 'SL', paid: true, annualAllowanceDays: 12, allowHalfDay: true },
  { name: 'Earned Leave', code: 'EL', paid: true, annualAllowanceDays: 15, allowHalfDay: true },
  { name: 'Unpaid Leave', code: 'LWP', paid: false, annualAllowanceDays: 0, allowHalfDay: true },
];

export interface ProvisionResult {
  tenantId: Types.ObjectId;
  dbName: string;
  slug: string;
  ownerStatus: string;
  /** Activation link for the owner (set only while the owner still has to activate). */
  activationLink?: string;
}

/**
 * Onboards a company end to end:
 *  1. creates its own MongoDB database (<SLUG>_HRM) with all collections and indexes;
 *  2. in one transaction: tenant record (with its seat limit), owner login, owner employee, COMPANY_OWNER membership,
 *     default leave types, a default Mon-Fri 09:00-18:00 shift assigned to the owner;
 *  3. emails the owner an activation link.
 * If anything fails the transaction is rolled back and the new database is dropped, so nothing is left half-made.
 */
export async function provisionTenant(
  env: Env,
  input: OnboardInput,
  opts: {
    createdByUserId?: Types.ObjectId;
    /** Public signup passes false: a stranger must not be able to attach a company to someone else's account. */
    allowExistingOwner?: boolean;
  } = {},
): Promise<ProvisionResult> {
  const { owner } = input;
  const { createdByUserId, allowExistingOwner = true } = opts;
  if (await User.exists({ email: owner.email, status: 'DISABLED' }))
    throw AppError.conflict('Owner account is disabled');
  if (!allowExistingOwner && (await User.exists({ email: owner.email })))
    throw new AppError(
      409,
      'EMAIL_IN_USE',
      'An account with this email already exists. Sign in instead, or use a different email.',
    );
  const slug = await resolveSlug(input);
  const dbName = dbNameForSlug(slug);

  let databaseCreated = false;
  const session = await mongoose.startSession();
  let tenantId!: Types.ObjectId;
  let ownerUserId!: Types.ObjectId;
  let ownerStatus!: string;
  try {
    await createTenantDatabase(dbName);
    databaseCreated = true;
    await session.withTransaction(async () => {
      const [tenant] = await Tenant.create(
        [
          {
            name: input.name,
            slug,
            timezone: input.timezone,
            dbName,
            maxEmployees: input.maxEmployees,
            settings: { attendance: { requirePhoto: true } },
          },
        ],
        { session },
      );
      tenantId = tenant!._id;
      let user = await User.findOne({ email: owner.email }).session(session);
      user ??= (await User.create([{ email: owner.email, status: 'INVITED' }], { session }))[0]!;
      ownerUserId = user._id;
      ownerStatus = user.status;
      await runInTenantDb(dbName, async () => {
        const [emp] = await Employee.create(
          [
            {
              tenantId,
              userId: user._id,
              employeeCode: 'EMP-0001',
              firstName: owner.firstName,
              lastName: owner.lastName,
              workEmail: owner.email,
              employmentStatus: user.status === 'ACTIVE' ? 'ACTIVE' : 'INVITED',
              history: [{ type: 'CREATED', byUserId: createdByUserId }],
            },
          ],
          { session },
        );
        await Membership.create(
          [{ tenantId, userId: user._id, roles: ['COMPANY_OWNER'], employeeId: emp!._id }],
          { session },
        );
        // Employee codes continue after EMP-0001.
        await Counter.updateOne(
          { _id: `employee:${tenantId}` },
          { $set: { seq: 1 } },
          { upsert: true, session },
        );
        await LeaveType.create(
          DEFAULT_LEAVE_TYPES.map((l) => ({ ...l, tenantId })),
          { session, ordered: true },
        );
        const [shift] = await Shift.create(
          [
            {
              tenantId,
              name: 'General 09:00-18:00',
              startTime: '09:00',
              endTime: '18:00',
              graceMinutes: 10,
              earlyDepartureGraceMinutes: 5,
              breakPolicy: { type: 'RECORDED', expectedUnpaidMinutes: 60 },
              weeklyOffDays: [0, 6],
            },
          ],
          { session },
        );
        await ShiftAssignment.create(
          [
            {
              tenantId,
              employeeId: emp!._id,
              shiftId: shift!._id,
              effectiveFrom: DateTime.now().setZone(input.timezone).toISODate()!,
              assignedBy: createdByUserId,
            },
          ],
          { session },
        );
      });
    });
  } catch (err) {
    if (databaseCreated) await dropTenantDatabase(dbName).catch(() => undefined);
    if (isDuplicateKey(err)) throw AppError.conflict('A company with this slug already exists');
    throw err;
  } finally {
    await session.endSession();
  }

  let activationLink: string | undefined;
  if (ownerStatus === 'INVITED') {
    const raw = await issueOneTimeToken(
      env,
      ownerUserId,
      'ACTIVATION',
      env.INVITE_TTL_HOURS * 3_600_000,
    );
    activationLink = `${env.WEB_APP_URL}/activate?token=${raw}`;
    await sendEmail(env, {
      tenantId,
      to: owner.email,
      template: 'ACTIVATION',
      subject: `Your ${input.name} workspace is ready`,
      link: activationLink,
    });
  }
  return { tenantId, dbName, slug, ownerStatus, activationLink };
}
