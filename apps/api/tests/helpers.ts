import type { Express } from 'express';
import mongoose, { Types } from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app';
import type { Env } from '../src/config/env';
import { parseEnv } from '../src/config/env';
import { createLogger } from '../src/config/logger';
import { connectDatabase, disconnectDatabase } from '../src/database/connection';
import { Department } from '../src/database/models/department.model';
import { EmailOutbox } from '../src/database/models/emailOutbox.model';
import { Employee } from '../src/database/models/employee.model';
import { Membership, type TenantRole } from '../src/database/models/membership.model';
import { Tenant } from '../src/database/models/tenant.model';
import { User } from '../src/database/models/user.model';
import { hashPassword } from '../src/utils/security';
import type { Clock } from '../src/utils/clock';
import { DateTime } from 'luxon';
import { Shift } from '../src/database/models/shift.model';
import { ShiftAssignment } from '../src/database/models/shiftAssignment.model';
import { WorkLocation } from '../src/database/models/workLocation.model';

export const PASSWORD = 'Sup3r-Secret-Pass';

export function testEnv(overrides: Record<string, string> = {}): Env {
  return parseEnv({
    NODE_ENV: 'test',
    MONGODB_URI: process.env.TEST_MONGODB_URI ?? 'mongodb://localhost:27017/workforce_test',
    JWT_ACCESS_SECRET: 'test-access-secret-test-access-secret-0000',
    REFRESH_TOKEN_SECRET: 'test-refresh-secret-test-refresh-secret-0000',
    RATE_LIMIT_LOGIN_MAX: '10000',
    RATE_LIMIT_SENSITIVE_MAX: '10000',
    ...overrides,
  });
}

export async function startTestApp(
  overrides: Record<string, string> = {},
  deps: { clock?: Clock } = {},
): Promise<{ app: Express; env: Env }> {
  const env = testEnv(overrides);
  const logger = createLogger(env);
  await connectDatabase(env.MONGODB_URI, logger);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  return { app: createApp(env, logger, deps), env };
}
export const stopTestApp = () => disconnectDatabase();

let cachedHash: Promise<string> | undefined;
export const testPasswordHash = () => (cachedHash ??= hashPassword(PASSWORD));

export interface TestPerson {
  userId: Types.ObjectId;
  employeeId: Types.ObjectId;
  email: string;
  roles: TenantRole[];
}
export interface TestTenant {
  tenantId: Types.ObjectId;
  slug: string;
  department: Types.ObjectId;
  people: Record<'owner' | 'hr' | 'manager' | 'employee' | 'employee2' | 'payroll', TestPerson>;
}

export async function addPerson(
  tenantId: Types.ObjectId,
  slug: string,
  key: string,
  roles: TenantRole[],
  dept: Types.ObjectId,
  managerId?: Types.ObjectId,
): Promise<TestPerson> {
  const email = `${key}@${slug}.test`;
  const user = await User.create({
    email,
    passwordHash: await testPasswordHash(),
    status: 'ACTIVE',
  });
  const emp = await Employee.create({
    tenantId,
    userId: user._id,
    employeeCode: key.toUpperCase(),
    firstName: key,
    lastName: slug,
    workEmail: email,
    departmentId: dept,
    managerId,
    employmentStatus: 'ACTIVE',
  });
  await Membership.create({ tenantId, userId: user._id, roles, employeeId: emp._id });
  return { userId: user._id, employeeId: emp._id, email, roles };
}

export async function createTenant(slug: string): Promise<TestTenant> {
  const tenant = await Tenant.create({ name: `Company ${slug}`, slug });
  const dept = await Department.create({ tenantId: tenant._id, name: 'Engineering' });
  const owner = await addPerson(tenant._id, slug, 'owner', ['COMPANY_OWNER'], dept._id);
  const hr = await addPerson(tenant._id, slug, 'hr', ['HR_ADMIN'], dept._id);
  const manager = await addPerson(tenant._id, slug, 'manager', ['MANAGER'], dept._id);
  const employee = await addPerson(
    tenant._id,
    slug,
    'employee',
    ['EMPLOYEE'],
    dept._id,
    manager.employeeId,
  );
  const employee2 = await addPerson(tenant._id, slug, 'employee2', ['EMPLOYEE'], dept._id);
  const payroll = await addPerson(tenant._id, slug, 'payroll', ['PAYROLL_ADMIN'], dept._id);
  return {
    tenantId: tenant._id,
    slug,
    department: dept._id,
    people: { owner, hr, manager, employee, employee2, payroll },
  };
}

export async function loginAs(app: Express, email: string, password = PASSWORD): Promise<string> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200)
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.accessToken as string;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Extracts the token from the latest recorded email for an address (dev outbox). */
export async function latestEmailToken(to: string, template: string): Promise<string> {
  const mail = await EmailOutbox.findOne({ to, template }).sort({ createdAt: -1 }).lean();
  const token = mail?.link && new URL(mail.link).searchParams.get('token');
  if (!token) throw new Error(`no ${template} email recorded for ${to}`);
  return token;
}

export class FakeClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current);
  }
  set(d: Date): void {
    this.current = d;
  }
  advanceMinutes(m: number): void {
    this.current = new Date(this.current.getTime() + m * 60_000);
  }
}

export const IST = 'Asia/Kolkata';
/** Wall-clock time in India -> Date. */
export const ist = (date: string, time: string): Date =>
  DateTime.fromISO(`${date}T${time}`, { zone: IST }).toJSDate();

export const OFFICE = { latitude: 12.9716, longitude: 77.5946 };
export const inside = (accuracyMeters = 12) => ({ ...OFFICE, accuracyMeters });
export const outside = (accuracyMeters = 12) => ({
  latitude: OFFICE.latitude + 0.02,
  longitude: OFFICE.longitude,
  accuracyMeters,
}); // ~2.2 km away

let keySeq = 0;
export const newKey = (prefix = 'k') => `${prefix}-${Date.now()}-${++keySeq}-abcdefgh`;

/** Standard schedule fixtures: IST tenant, one office fence, 09:00-18:00 shift assigned to everyone from 2026-01-01. */
export async function setupSchedule(t: TestTenant, shiftOver: Record<string, unknown> = {}) {
  await Tenant.updateOne({ _id: t.tenantId }, { $set: { timezone: IST } });
  const office = await WorkLocation.create({
    tenantId: t.tenantId,
    name: 'HQ',
    location: { type: 'Point', coordinates: [OFFICE.longitude, OFFICE.latitude] },
    radiusMeters: 100,
  });
  const shift = await Shift.create({
    tenantId: t.tenantId,
    name: 'Day',
    startTime: '09:00',
    endTime: '18:00',
    graceMinutes: 10,
    earlyDepartureGraceMinutes: 5,
    breakPolicy: { type: 'RECORDED', expectedUnpaidMinutes: 60 },
    weeklyOffDays: [0],
    ...shiftOver,
  });
  for (const p of Object.values(t.people))
    await ShiftAssignment.create({
      tenantId: t.tenantId,
      employeeId: p.employeeId,
      shiftId: shift._id,
      effectiveFrom: '2026-01-01',
    });
  return { office, shift };
}
