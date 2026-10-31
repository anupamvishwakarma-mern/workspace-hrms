import { randomBytes } from 'node:crypto';
import mongoose, { Types } from 'mongoose';
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
import { HostingError, classifyMongoError, safeErrorMessage } from '../../database/hosting/errors';
import { initializeSchema } from '../../database/hosting/initialize';
import { tenantDatabaseManager } from '../../database/hosting/manager';
import { LATEST_SCHEMA_VERSION, migrateTenantDatabase } from '../../database/hosting/migrations';
import { parseMongoUri } from '../../database/hosting/connectionString';
import { encryptConnectionString } from '../../database/hosting/secrets';
import { openCustomerConnection, verifyCustomerDatabase } from '../../database/hosting/verify';
import { recordDbEvent } from '../../database/models/tenantDbEvent.model';
import { runInTenantDb, runInTenantScope } from '../../database/tenantContext';
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

/**
 * Where the company's HRMS data will live. MANAGED needs nothing else. CUSTOMER_OWNED carries the customer's MongoDB
 * connection string, which is verified, encrypted and never returned by any API.
 */
export const databaseSelection = z.discriminatedUnion('hostingMode', [
  z.object({ hostingMode: z.literal('MANAGED') }).strict(),
  z
    .object({
      hostingMode: z.literal('CUSTOMER_OWNED'),
      connectionString: z.string().trim().min(10).max(2048),
      /** Only needed when the connection string does not name a database. */
      databaseName: z.string().trim().min(1).max(60).optional(),
    })
    .strict(),
]);
export type DatabaseSelection = z.infer<typeof databaseSelection>;

export const onboardBody = z
  .object({
    name: z.string().trim().min(2).max(200),
    /** Optional: derived from the company name when omitted. Also names the database (ACME -> ACME_HRM). */
    slug: z.string().trim().toLowerCase().regex(SLUG_RE, 'Use 3-40 lowercase letters, digits or hyphens').optional(),
    timezone: timezoneSchema.default('UTC'),
    /** Number of members (employees) the company will have: enforced as a hard seat limit. */
    maxEmployees: z.number().int().min(1).max(MAX_MEMBERS),
    owner: ownerSchema,
    /** Omitted = MANAGED (the HRMS-managed database), so existing clients keep working. */
    database: databaseSelection.default({ hostingMode: 'MANAGED' }),
  })
  .strict();
export type OnboardInput = Omit<z.infer<typeof onboardBody>, 'maxEmployees' | 'database'> & {
  /** Omitted = unlimited (platform operators only; public signup always sets it). */
  maxEmployees?: number;
  database?: DatabaseSelection;
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

/** Creates the collections and indexes of a brand-new company database on the managed cluster. */
export async function createTenantDatabase(dbName: string): Promise<void> {
  await initializeSchema(mongoose.connection.useDb(dbName, { useCache: true }));
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
  /** Managed companies only (customer-owned database names are not exposed here). */
  dbName?: string;
  hostingMode: 'MANAGED' | 'CUSTOMER_OWNED';
  slug: string;
  ownerStatus: string;
  /** Activation link for the owner (set only while the owner still has to activate). */
  activationLink?: string;
}

interface SeedInput {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  userStatus: string;
  empId: Types.ObjectId;
  owner: OnboardInput['owner'];
  timezone: string;
  createdByUserId?: Types.ObjectId;
  session: mongoose.ClientSession;
}

/**
 * The company-owned data of a new company (owner employee, default leave types, default shift). Must run inside the
 * company's database scope. Identical for managed and customer-owned hosting.
 */
async function seedCompanyData(i: SeedInput): Promise<void> {
  const { tenantId, session } = i;
  await Employee.create(
    [
      {
        _id: i.empId,
        tenantId,
        userId: i.userId,
        employeeCode: 'EMP-0001',
        firstName: i.owner.firstName,
        lastName: i.owner.lastName,
        workEmail: i.owner.email,
        employmentStatus: i.userStatus === 'ACTIVE' ? 'ACTIVE' : 'INVITED',
        history: [{ type: 'CREATED', byUserId: i.createdByUserId }],
      },
    ],
    { session },
  );
  // Employee codes continue after EMP-0001.
  await Counter.updateOne({ _id: `employee:${tenantId}` }, { $set: { seq: 1 } }, { upsert: true, session });
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
        employeeId: i.empId,
        shiftId: shift!._id,
        effectiveFrom: DateTime.now().setZone(i.timezone).toISODate()!,
        assignedBy: i.createdByUserId,
      },
    ],
    { session },
  );
}

/**
 * Onboards a company end to end. The hosting choice decides only where its data lives:
 *
 * MANAGED (default; the original flow)
 *  1. creates its own database (<SLUG>_HRM) on our cluster with all collections and indexes;
 *  2. in one transaction: tenant record (with its seat limit), owner login, owner employee, COMPANY_OWNER membership,
 *     default leave types, a default Mon-Fri 09:00-18:00 shift assigned to the owner;
 *  3. emails the owner an activation link. If anything fails the transaction is rolled back and the database dropped.
 *
 * CUSTOMER_OWNED
 *  1. verifies the customer's database (SSRF policy, TLS, auth, version, replica set, permissions, emptiness);
 *  2. records the company (suspended until ready) with the ENCRYPTED connection string, owner login and membership
 *     in the control-plane database;
 *  3. creates collections/indexes in the customer's database through the migration system and seeds the same default
 *     data in a transaction on THEIR cluster (a transaction cannot span two clusters);
 *  4. only then marks the database READY and activates the company; on any failure the control-plane records and
 *     anything seeded are removed. The customer's database itself is never dropped.
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
  const selection: DatabaseSelection = input.database ?? { hostingMode: 'MANAGED' };
  const slug = await resolveSlug(input);

  const done =
    selection.hostingMode === 'CUSTOMER_OWNED'
      ? await provisionCustomerOwned(input, slug, selection, createdByUserId)
      : await provisionManaged(input, slug, createdByUserId);

  let activationLink: string | undefined;
  if (done.ownerStatus === 'INVITED') {
    const raw = await issueOneTimeToken(env, done.ownerUserId, 'ACTIVATION', env.INVITE_TTL_HOURS * 3_600_000);
    activationLink = `${env.WEB_APP_URL}/activate?token=${raw}`;
    await sendEmail(env, {
      tenantId: done.tenantId,
      to: owner.email,
      template: 'ACTIVATION',
      subject: `Your ${input.name} workspace is ready`,
      link: activationLink,
    });
  }
  return {
    tenantId: done.tenantId,
    dbName: done.dbName,
    hostingMode: selection.hostingMode,
    slug,
    ownerStatus: done.ownerStatus,
    activationLink,
  };
}

interface Provisioned {
  tenantId: Types.ObjectId;
  ownerUserId: Types.ObjectId;
  ownerStatus: string;
  dbName?: string;
}

async function provisionManaged(
  input: OnboardInput,
  slug: string,
  createdByUserId: Types.ObjectId | undefined,
): Promise<Provisioned> {
  const { owner } = input;
  const dbName = dbNameForSlug(slug);
  const settings = tenantDatabaseManager.getSettings();

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
            database: {
              hostingMode: 'MANAGED',
              provider: 'MONGODB',
              status: 'READY',
              clusterId: settings.managedClusterId,
              databaseName: dbName,
              schemaVersion: LATEST_SCHEMA_VERSION,
              health: 'HEALTHY',
            },
          },
        ],
        { session },
      );
      tenantId = tenant!._id;
      let user = await User.findOne({ email: owner.email }).session(session);
      user ??= (await User.create([{ email: owner.email, status: 'INVITED' }], { session }))[0]!;
      ownerUserId = user._id;
      ownerStatus = user.status;
      const empId = new Types.ObjectId();
      await Membership.create(
        [{ tenantId, userId: user._id, roles: ['COMPANY_OWNER'], employeeId: empId }],
        { session },
      );
      await runInTenantDb(dbName, () =>
        seedCompanyData({ tenantId, userId: user._id, userStatus: user.status, empId, owner, timezone: input.timezone, createdByUserId, session }),
      );
    });
  } catch (err) {
    if (databaseCreated) await dropTenantDatabase(dbName).catch(() => undefined);
    if (isDuplicateKey(err)) throw AppError.conflict('A company with this slug already exists');
    throw err;
  } finally {
    await session.endSession();
  }
  return { tenantId, ownerUserId, ownerStatus, dbName };
}

async function provisionCustomerOwned(
  input: OnboardInput,
  slug: string,
  selection: Extract<DatabaseSelection, { hostingMode: 'CUSTOMER_OWNED' }>,
  createdByUserId: Types.ObjectId | undefined,
): Promise<Provisioned> {
  const { owner } = input;
  const settings = tenantDatabaseManager.getSettings();
  const ring = settings.keyRing;
  if (!settings.customerOwnedEnabled || !ring)
    throw new HostingError('CUSTOMER_DB_DISABLED', 'Customer-owned databases are not enabled on this platform. Choose the HRMS-managed database.');

  // 1. Verify everything on a throwaway connection before anything is written anywhere.
  const verified = await verifyCustomerDatabase(settings, {
    connectionString: selection.connectionString,
    databaseName: selection.databaseName,
  });
  if (await Tenant.exists({ 'database.connectionConfig.fingerprint': verified.fingerprint }))
    throw new HostingError('DATABASE_IN_USE', 'This database is already in use by an HRMS company. Choose an empty database.');

  const tenantId = new Types.ObjectId();
  const empId = new Types.ObjectId();
  const encrypted = encryptConnectionString(ring, String(tenantId), selection.connectionString);
  const parsed = parseMongoUri(selection.connectionString);
  const conn = await openCustomerConnection(settings, selection.connectionString, verified.databaseName, parsed);

  let ownerUserId!: Types.ObjectId;
  let ownerStatus!: string;
  let userCreated = false;
  try {
    // 2. Control plane: the company (suspended and PROVISIONING until the customer database is ready), owner, membership.
    const control = await mongoose.startSession();
    try {
      await control.withTransaction(async () => {
        await Tenant.create(
          [
            {
              _id: tenantId,
              name: input.name,
              slug,
              status: 'SUSPENDED',
              timezone: input.timezone,
              maxEmployees: input.maxEmployees,
              settings: { attendance: { requirePhoto: true } },
              database: {
                hostingMode: 'CUSTOMER_OWNED',
                provider: 'MONGODB',
                status: 'PROVISIONING',
                databaseName: verified.databaseName,
                connectionConfig: { ...encrypted, fingerprint: verified.fingerprint, updatedAt: new Date() },
                health: 'UNKNOWN',
              },
            },
          ],
          { session: control },
        );
        let user = await User.findOne({ email: owner.email }).session(control);
        if (!user) {
          user = (await User.create([{ email: owner.email, status: 'INVITED' }], { session: control }))[0]!;
          userCreated = true;
        }
        ownerUserId = user._id;
        ownerStatus = user.status;
        await Membership.create(
          [{ tenantId, userId: user._id, roles: ['COMPANY_OWNER'], employeeId: empId }],
          { session: control },
        );
      });
    } finally {
      await control.endSession();
    }

    // 3. Customer database: schema through the migration system, then the default data in a transaction on THEIR cluster.
    const migrated = await migrateTenantDatabase(String(tenantId), conn);
    if (migrated.status === 'FAILED')
      throw new HostingError('VERIFICATION_FAILED', migrated.error ?? 'The database schema could not be created.');
    const seed = await conn.startSession();
    try {
      await seed.withTransaction(() =>
        runInTenantScope({ connection: conn }, () =>
          seedCompanyData({ tenantId, userId: ownerUserId, userStatus: ownerStatus, empId, owner, timezone: input.timezone, createdByUserId, session: seed }),
        ),
      );
    } finally {
      await seed.endSession();
    }

    // 4. Ready: activate the company.
    const now = new Date();
    await Tenant.updateOne(
      { _id: tenantId },
      {
        $set: {
          status: 'ACTIVE',
          'database.status': 'READY',
          'database.health': 'HEALTHY',
          'database.lastConnectionCheck': now,
          'database.lastSuccessfulConnection': now,
        },
      },
    );
    await recordDbEvent({ tenantId, type: 'PROVISIONED', ok: true, actorUserId: createdByUserId, detail: { hostingMode: 'CUSTOMER_OWNED', databaseName: verified.databaseName, serverVersion: verified.serverVersion } });
  } catch (err) {
    await compensateCustomerProvisioning({ tenantId, conn, userCreated, ownerUserId });
    await recordDbEvent({ tenantId, type: 'PROVISION_FAILED', ok: false, actorUserId: createdByUserId, detail: { error: safeErrorMessage(err) } });
    if (isDuplicateKey(err)) {
      const key = JSON.stringify((err as { keyPattern?: unknown }).keyPattern ?? {});
      if (key.includes('fingerprint')) throw new HostingError('DATABASE_IN_USE', 'This database is already in use by an HRMS company. Choose an empty database.');
      throw AppError.conflict('A company with this slug already exists');
    }
    throw err instanceof AppError ? err : classifyMongoError(err);
  } finally {
    await conn.close().catch(() => undefined);
  }
  return { tenantId, ownerUserId, ownerStatus };
}

/**
 * Undoes a failed customer-owned onboarding: control-plane records go; documents WE seeded (all carry this company's
 * tenantId) and our binding marker are removed from the customer's database. The database and its collections are
 * left in place and are never dropped, so a retry finds it empty again.
 */
async function compensateCustomerProvisioning(c: {
  tenantId: Types.ObjectId;
  conn: mongoose.Connection;
  userCreated: boolean;
  ownerUserId?: Types.ObjectId;
}): Promise<void> {
  try {
    await runInTenantScope({ connection: c.conn }, async () => {
      for (const M of [Employee, Counter, LeaveType, Shift, ShiftAssignment] as const) {
        const filter = M === Counter ? { _id: `employee:${c.tenantId}` } : { tenantId: c.tenantId };
        await (M as unknown as mongoose.Model<unknown>).deleteMany(filter as never).catch(() => undefined);
      }
    });
    await c.conn.db!.collection('_hrms_meta').deleteOne({ _id: 'binding' as never, tenantId: String(c.tenantId) } as never).catch(() => undefined);
  } catch {
    /* best effort: the customer's data is never touched beyond what we seeded */
  }
  await Membership.deleteMany({ tenantId: c.tenantId }).catch(() => undefined);
  if (c.userCreated && c.ownerUserId) await User.deleteOne({ _id: c.ownerUserId, status: 'INVITED' }).catch(() => undefined);
  await Tenant.deleteOne({ _id: c.tenantId, 'database.hostingMode': 'CUSTOMER_OWNED', status: 'SUSPENDED' }).catch(() => undefined);
}
