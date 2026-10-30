/**
 * DEMO DATA for every collection. LOCAL / TEST ENVIRONMENTS ONLY: refuses to run when NODE_ENV=production.
 *
 *   pnpm --filter @workforce/api seed:demo            create the demo companies (skips ones that exist)
 *   pnpm --filter @workforce/api seed:demo -- --reset remove the demo companies first, then re-create them
 *
 * Creates three companies, each in its own database like a real onboarded company:
 *   Aurora Technologies  (demo-aurora)   every module, ~24 people, 3 months of attendance, payroll, hiring
 *   Bluebird Logistics   (demo-bluebird) limited plan: no Payroll or Recruitment
 *   Cedar Retail         (demo-cedar)    suspended, almost at its seat limit
 *
 * Nothing here is real: names, ID numbers and bank details are invented, and the statutory rules are labelled demo
 * values. No platform administrator is created (use `pnpm create-super-admin`). Uploaded files and punch photos do not
 * exist in object storage, so their records are listed but cannot be downloaded.
 */
import { DateTime } from 'luxon';
import { Types } from 'mongoose';
import { ApprovalDelegation, ApprovalRequest } from '../database/models/approvalRequest.model';
import { ApprovalWorkflow } from '../database/models/approvalWorkflow.model';
import { AttendanceCorrection } from '../database/models/attendanceCorrection.model';
import { AttendanceEvent, type EVENT_TYPES } from '../database/models/attendanceEvent.model';
import { AttendanceException } from '../database/models/attendanceException.model';
import { AuditLog } from '../database/models/auditLog.model';
import { Counter } from '../database/models/counter.model';
import { CustomRole } from '../database/models/customRole.model';
import { Department } from '../database/models/department.model';
import { Designation } from '../database/models/designation.model';
import { EmailOutbox } from '../database/models/emailOutbox.model';
import { Employee } from '../database/models/employee.model';
import { EmployeeDocument } from '../database/models/employeeDocument.model';
import { EmployeeSensitive } from '../database/models/employeeSensitive.model';
import { EmploymentChange } from '../database/models/employmentChange.model';
import { HandbookSection } from '../database/models/handbookSection.model';
import { Holiday } from '../database/models/holiday.model';
import { IssuedLetter, LetterTemplate } from '../database/models/letter.model';
import { LeaveLedger } from '../database/models/leaveLedger.model';
import { LeaveRequest } from '../database/models/leaveRequest.model';
import { LeaveType } from '../database/models/leaveType.model';
import { Membership, type TenantRole } from '../database/models/membership.model';
import { OneTimeToken } from '../database/models/oneTimeToken.model';
import { PayrollAdjustment, StatutoryRule } from '../database/models/statutoryRule.model';
import { PayrollRun } from '../database/models/payroll.model';
import { ProfileItem } from '../database/models/profileItem.model';
import { PunchPhoto } from '../database/models/punchPhoto.model';
import { PushToken } from '../database/models/pushToken.model';
import { Candidate, JobOpening } from '../database/models/recruitment.model';
import { Resignation } from '../database/models/resignation.model';
import { SalaryStructure } from '../database/models/salaryStructure.model';
import { Session } from '../database/models/session.model';
import { Shift } from '../database/models/shift.model';
import { ShiftAssignment } from '../database/models/shiftAssignment.model';
import { Tenant } from '../database/models/tenant.model';
import { runInTenantDb } from '../database/tenantContext';
import { User } from '../database/models/user.model';
import { WfhRequest } from '../database/models/wfhRequest.model';
import { WorkLocation } from '../database/models/workLocation.model';
import { loadTenant, recalculateDay } from '../modules/attendance/attendance.service';
import { generateRun, publishRun } from '../modules/payroll/payroll.service';
import { runMonthlyAccrual } from '../modules/leave/ledger.service';
import { createTenantDatabase, dbNameForSlug, dropTenantDatabase } from '../modules/tenants/provisioning';
import { parseEncryptionKey, encryptField } from '../utils/fieldCrypto';
import { hashPassword } from '../utils/security';
import { runScript } from './bootstrap';

export const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo-Pass-12345';
const SLUGS = ['demo-aurora', 'demo-bluebird', 'demo-cedar'];
const DEMO_EMAIL_RE = /\.demo\.test$/;
const ZONE = 'Asia/Kolkata';

/* ------------------------------ small helpers ------------------------------ */

/** Deterministic pseudo-random numbers, so every run produces the same demo company. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const oid = () => new Types.ObjectId();
const idOf0 = (d: unknown) => d as { _id: Types.ObjectId };
const idOf = (d: unknown) => (d as { _id: Types.ObjectId })._id;
const utcDay = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const FIRST = ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Ananya', 'Vikram', 'Isha', 'Arjun', 'Neha', 'Karan', 'Riya', 'Sameer', 'Tanvi', 'Yash', 'Zoya', 'Dev', 'Nisha', 'Omar', 'Priya', 'Rahul', 'Sneha', 'Tarun', 'Uma', 'Varun', 'Waseem', 'Kiran', 'Lata', 'Mohan', 'Naina'];
const LAST = ['Sharma', 'Patel', 'Reddy', 'Nair', 'Gupta', 'Iyer', 'Menon', 'Bose', 'Das', 'Khan', 'Joshi', 'Verma', 'Pillai', 'Mehta', 'Rao', 'Shah', 'Kulkarni', 'Singh', 'Chopra', 'Banerjee', 'Desai', 'Kapoor', 'Malhotra', 'Saxena', 'Thakur', 'Ghosh', 'Pandey', 'Bhatt', 'Naidu', 'Sethi'];

interface Person {
  i: number;
  id: Types.ObjectId;
  userId: Types.ObjectId;
  code: string;
  first: string;
  last: string;
  email: string;
  dept: string;
  title: string;
  roles: TenantRole[];
  managerIdx?: number;
  status: 'ACTIVE' | 'INVITED' | 'NOTICE_PERIOD' | 'RESIGNED';
  probation?: boolean;
  joined: string;
  type: 'FULL_TIME' | 'CONTRACT' | 'INTERN';
  mode: 'OFFICE' | 'REMOTE' | 'FIELD';
  salaryMajor: number;
}

interface Spec {
  name: string;
  slug: string;
  domain: string;
  people: number;
  maxEmployees: number;
  status: 'ACTIVE' | 'SUSPENDED';
  modules?: string[];
  seed: number;
  depts: string[];
  attendanceDays: number;
}

const SPECS: Spec[] = [
  { name: 'Aurora Technologies', slug: 'demo-aurora', domain: 'aurora.demo.test', people: 24, maxEmployees: 50, status: 'ACTIVE', seed: 11, depts: ['Engineering', 'Human Resources', 'Sales', 'Finance', 'Operations'], attendanceDays: 95 },
  { name: 'Bluebird Logistics', slug: 'demo-bluebird', domain: 'bluebird.demo.test', people: 10, maxEmployees: 15, status: 'ACTIVE', modules: ['ATTENDANCE', 'LEAVE', 'LETTERS', 'HANDBOOK', 'DOCUMENTS'], seed: 23, depts: ['Operations', 'Human Resources', 'Sales'], attendanceDays: 30 },
  { name: 'Cedar Retail', slug: 'demo-cedar', domain: 'cedar.demo.test', people: 5, maxEmployees: 5, status: 'SUSPENDED', seed: 37, depts: ['Operations', 'Human Resources'], attendanceDays: 20 },
];

const TITLES: Record<string, string[]> = {
  Engineering: ['Software Engineer', 'Senior Software Engineer', 'QA Engineer', 'DevOps Engineer'],
  'Human Resources': ['HR Executive', 'Talent Partner'],
  Sales: ['Sales Executive', 'Account Manager'],
  Finance: ['Accountant', 'Payroll Specialist'],
  Operations: ['Operations Executive', 'Logistics Coordinator'],
};
const DESIGNATIONS = [
  ['Intern', 'INT', 1], ['Executive', 'EXE', 2], ['Software Engineer', 'SE', 3], ['Senior Software Engineer', 'SSE', 4],
  ['Manager', 'MGR', 5], ['Director', 'DIR', 7], ['HR Executive', 'HRE', 2], ['Accountant', 'ACC', 3],
] as const;

function buildRoster(spec: Spec): Person[] {
  const r = rng(spec.seed);
  const out: Person[] = [];
  const managerOf = new Map<string, number>();
  const dom = spec.domain;
  const mk = (p: Partial<Person> & Pick<Person, 'dept' | 'roles' | 'title'>, email?: string): Person => {
    const i = out.length;
    const first = FIRST[(i * 3 + spec.seed) % FIRST.length]!;
    const last = LAST[(i * 7 + spec.seed * 2) % LAST.length]!;
    const person: Person = {
      i, id: oid(), userId: oid(), code: `EMP-${String(i + 1).padStart(4, '0')}`, first, last,
      email: email ?? `${first}.${last}${i >= 30 ? i : ''}@${dom}`.toLowerCase(),
      status: 'ACTIVE', joined: DateTime.now().setZone(ZONE).minus({ days: 200 + Math.floor(r() * 900) }).toISODate()!,
      type: 'FULL_TIME', mode: 'OFFICE', salaryMajor: 30000 + Math.floor(r() * 10) * 5000, ...p,
    };
    out.push(person);
    return person;
  };
  mk({ dept: spec.depts[1] ?? spec.depts[0]!, roles: ['COMPANY_OWNER'], title: 'Director', salaryMajor: 150000 }, `owner@${dom}`);
  const owner = out[0]!;
  const hr = mk({ dept: spec.depts[1] ?? spec.depts[0]!, roles: ['HR_ADMIN'], title: 'HR Executive', managerIdx: 0, salaryMajor: 60000 }, `hr@${dom}`);
  if (spec.people >= 8) mk({ dept: 'Finance', roles: ['PAYROLL_ADMIN'], title: 'Payroll Specialist', managerIdx: 0, salaryMajor: 55000 }, `payroll@${dom}`);
  const opDepts = spec.depts.filter((d) => d !== 'Human Resources' && d !== 'Finance');
  for (const d of opDepts) {
    const m = mk({ dept: d, roles: ['MANAGER'], title: 'Manager', managerIdx: 0, salaryMajor: 90000 }, out.length === 3 || (spec.people < 8 && out.length === 2) ? `manager@${dom}` : undefined);
    managerOf.set(d, m.i);
  }
  void hr;
  let k = 0;
  while (out.length < spec.people) {
    const d = opDepts[k % opDepts.length]!;
    const titles = TITLES[d] ?? ['Associate'];
    const p = mk({ dept: d, roles: ['EMPLOYEE'], title: titles[k % titles.length]!, managerIdx: managerOf.get(d) }, out.length === (spec.people >= 8 ? 5 : 3) ? `employee@${dom}` : undefined);
    if (k % 7 === 3) p.mode = 'REMOTE';
    if (k % 11 === 5) p.type = 'CONTRACT';
    k++;
  }
  // A few life-cycle states, taken from the end of the list so the login people stay ordinary.
  const tail = out.filter((p) => p.roles[0] === 'EMPLOYEE');
  if (tail.length >= 4) {
    tail[tail.length - 1]!.status = 'NOTICE_PERIOD';
    tail[tail.length - 2]!.status = 'RESIGNED';
    tail[tail.length - 3]!.status = 'INVITED';
    const prob = tail[tail.length - 4]!;
    prob.probation = true;
    prob.joined = DateTime.now().setZone(ZONE).minus({ days: 45 }).toISODate()!;
  }
  void owner;
  return out;
}

/* --------------------------------- main --------------------------------- */

void runScript(async (env) => {
  if (env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
  const reset = process.argv.includes('--reset');
  if (reset) await removeDemo();
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const key = env.FIELD_ENCRYPTION_KEY ? parseEncryptionKey(env.FIELD_ENCRYPTION_KEY) : undefined;
  const created: string[] = [];
  for (const spec of SPECS) {
    if (await Tenant.exists({ slug: spec.slug })) {
      console.log(`- ${spec.name}: already exists (use --reset to rebuild)`);
      continue;
    }
    console.log(`+ ${spec.name}`);
    await seedCompany(spec, passwordHash, key);
    created.push(spec.slug);
  }
  if (created.length) {
    console.log(`\nDone. Password for every demo login: ${DEMO_PASSWORD}`);
    console.log('Logins (per company): owner@, hr@, payroll@, manager@, employee@  + the company domain:');
    for (const s of SPECS.filter((x) => created.includes(x.slug))) console.log(`  ${s.name}: @${s.domain}`);
    if (!key) console.log('Note: FIELD_ENCRYPTION_KEY is not set, so bank and ID numbers were not stored (names and branches were).');
    console.log('Create a platform administrator separately with: pnpm --filter @workforce/api create-super-admin');
  }
});

async function removeDemo() {
  const tenants = await Tenant.find({ slug: { $in: SLUGS } }).lean();
  for (const t of tenants) if (t.dbName) await dropTenantDatabase(t.dbName).catch(() => undefined);
  const ids = tenants.map((t) => t._id);
  const users = await User.find({ email: DEMO_EMAIL_RE }).select('_id').lean();
  const uids = users.map((u) => u._id);
  await Promise.all([
    Membership.deleteMany({ $or: [{ tenantId: { $in: ids } }, { userId: { $in: uids } }] }),
    Session.deleteMany({ userId: { $in: uids } }),
    OneTimeToken.deleteMany({ userId: { $in: uids } }),
    PushToken.deleteMany({ userId: { $in: uids } }),
    EmailOutbox.deleteMany({ to: DEMO_EMAIL_RE }),
  ]);
  await User.deleteMany({ _id: { $in: uids } });
  await Tenant.deleteMany({ _id: { $in: ids } });
  console.log(`Removed ${tenants.length} demo companies.`);
}

async function seedCompany(spec: Spec, passwordHash: string, key?: Buffer) {
  const R = rng(spec.seed * 101);
  const dbName = dbNameForSlug(spec.slug);
  await dropTenantDatabase(dbName).catch(() => undefined);
  await createTenantDatabase(dbName);
  const has = (m: string) => !spec.modules || spec.modules.includes(m);
  const tenant = idOf0(await Tenant.create({
    name: spec.name, slug: spec.slug, timezone: ZONE, dbName, status: spec.status,
    maxEmployees: spec.maxEmployees, modules: spec.modules, planId: spec.modules ? 'starter' : 'business',
    settings: {
      attendance: { requirePhoto: false },
      numbering: { employee: { prefix: 'EMP-', padding: 4 }, letter: { prefix: 'LTR-', padding: 4 }, document: { prefix: 'DOC-', padding: 4 } },
      leave: has('LEAVE') ? { autoAccrual: false } : undefined,
      payroll: { requireSeparatePublisher: true },
    },
  } as never));
  const tid = tenant._id;
  const roster = buildRoster(spec);
  const P = (i: number) => roster[i]!;
  const owner = P(0);
  const hr = P(1);
  const now = DateTime.now().setZone(ZONE);
  const today = now.startOf('day');
  const year = today.year;

  /* ---- global records: users, memberships, sessions, tokens, mail, push ---- */
  const customRoleDefs = [
    { _id: oid(), name: 'Operations Analyst', description: 'Read-only company-wide attendance and leave reports', permissions: ['attendance:read:all', 'leave:read:all'] },
    { _id: oid(), name: 'Policy Editor', description: 'Maintains the handbook and letters', permissions: ['handbook:manage', 'letter:manage'] },
  ];
  await User.insertMany(
    roster.map((p) => ({
      _id: p.userId, email: p.email, status: p.status === 'INVITED' ? 'INVITED' : 'ACTIVE',
      passwordHash: p.status === 'INVITED' ? undefined : passwordHash,
      emailVerifiedAt: p.status === 'INVITED' ? undefined : now.minus({ days: 90 }).toJSDate(),
      lastLoginAt: p.status === 'INVITED' ? undefined : now.minus({ hours: Math.floor(R() * 200) }).toJSDate(),
    })),
  );
  const customHolders = roster.filter((p) => p.roles[0] === 'EMPLOYEE' && p.status === 'ACTIVE').slice(0, 2);
  await Membership.insertMany(
    roster.map((p) => ({
      tenantId: tid, userId: p.userId, roles: p.roles, employeeId: p.id,
      status: p.status === 'RESIGNED' ? 'INACTIVE' : 'ACTIVE',
      customRoleIds: customHolders[0]?.i === p.i ? [customRoleDefs[0]!._id] : customHolders[1]?.i === p.i ? [customRoleDefs[1]!._id] : [],
    })),
  );
  const live = roster.filter((p) => p.status !== 'INVITED' && p.status !== 'RESIGNED');
  await Session.insertMany(
    live.slice(0, 4).map((p, n) => ({
      userId: p.userId, tokenHash: `demo-session-${spec.slug}-${n}`, deviceLabel: n % 2 ? 'Chrome on Windows' : 'Android app',
      ip: `203.0.113.${10 + n}`, lastUsedAt: now.minus({ minutes: n * 40 }).toJSDate(), expiresAt: now.plus({ days: 7 }).toJSDate(),
    })),
  );
  const invited = roster.find((p) => p.status === 'INVITED');
  if (invited)
    await OneTimeToken.create({ userId: invited.userId, purpose: 'ACTIVATION', tokenHash: `demo-activation-${spec.slug}`, expiresAt: now.plus({ hours: 20 }).toJSDate() });
  await PushToken.insertMany(
    live.slice(2, 4).map((p, n) => ({ userId: p.userId, token: `ExponentPushToken[demo${spec.seed}${n}aaaaaaaaaa]`, platform: n ? 'ios' : 'android', deviceId: `demo-device-${n}`, lastSeenAt: now.toJSDate() })),
  );
  await EmailOutbox.insertMany([
    ...(invited ? [{ tenantId: tid, to: invited.email, template: 'ACTIVATION', subject: `You're invited to ${spec.name}`, status: 'SENT', sentAt: now.minus({ days: 1 }).toJSDate(), link: 'https://example.invalid/activate/demo' }] : []),
    { tenantId: tid, to: owner.email, template: 'PASSWORD_RESET', subject: 'Reset your password', status: 'RECORDED_NOT_SENT' },
    { tenantId: tid, to: hr.email, template: 'LEAVE_DECISION', subject: 'A leave request needs your decision', status: 'QUEUED' },
    { tenantId: tid, to: P(2).email, template: 'PAYSLIP', subject: 'Your payslip is ready', status: 'FAILED', error: 'Mailbox unavailable (demo)' },
  ]);

  await runInTenantDb(dbName, async () => {
    /* ---- structure ---- */
    const depts = new Map<string, Types.ObjectId>();
    for (const name of spec.depts) {
      const d = await Department.create({ tenantId: tid, name, description: `${name} team (demo)` });
      depts.set(name, d._id);
    }
    if (!depts.has('Finance') && roster.some((p) => p.dept === 'Finance')) depts.set('Finance', (await Department.create({ tenantId: tid, name: 'Finance' }))._id);
    const desigIds = new Map<string, Types.ObjectId>();
    for (const [title, code, level] of DESIGNATIONS) desigIds.set(title, (await Designation.create({ tenantId: tid, title, code, level }))._id);
    const hq = await WorkLocation.create({ tenantId: tid, name: 'Bengaluru HQ', address: 'MG Road, Bengaluru (demo)', location: { type: 'Point', coordinates: [77.5946, 12.9716] }, radiusMeters: 150, allowedAttendanceMethods: ['GEOFENCE'] });
    const annex = await WorkLocation.create({ tenantId: tid, name: 'Pune Annex', address: 'Hinjewadi, Pune (demo)', location: { type: 'Point', coordinates: [73.7389, 18.5912] }, radiusMeters: 200, allowedAttendanceMethods: ['GEOFENCE', 'REMOTE'] });
    const general = await Shift.create({ tenantId: tid, name: 'General 09:00-18:00', startTime: '09:00', endTime: '18:00', graceMinutes: 10, earlyDepartureGraceMinutes: 5, breakPolicy: { type: 'RECORDED', expectedUnpaidMinutes: 60 }, weeklyOffDays: [0, 6], overtimePolicy: { enabled: true, thresholdMinutes: 30, maxMinutesPerDay: 180 } });
    const flexible = await Shift.create({ tenantId: tid, name: 'Flexible (8 hours)', shiftType: 'FLEXIBLE', startTime: '10:00', endTime: '19:00', minFullDayMinutes: 480, minHalfDayMinutes: 240, breakPolicy: { type: 'AUTO_DEDUCT', autoDeductMinutes: 45 }, weeklyOffDays: [0, 6] });

    const holidayDefs: [string, string, 'PUBLIC' | 'COMPANY' | 'OPTIONAL'][] = [
      [`${year}-01-01`, "New Year's Day", 'PUBLIC'], [`${year}-01-26`, 'Republic Day', 'PUBLIC'], [`${year}-05-01`, 'Labour Day', 'PUBLIC'],
      [`${year}-08-15`, 'Independence Day', 'PUBLIC'], [`${year}-10-02`, 'Gandhi Jayanti', 'PUBLIC'], [`${year}-12-25`, 'Year-end Break', 'COMPANY'],
      [`${year}-11-14`, 'Founders Day', 'COMPANY'], [`${year}-03-20`, 'Spring Festival (optional)', 'OPTIONAL'],
    ];
    await Holiday.insertMany(holidayDefs.map(([date, name, holidayType]) => ({ tenantId: tid, date, name, holidayType })));
    const holidayDates = new Set(holidayDefs.filter((h) => h[2] !== 'OPTIONAL').map((h) => h[0]));

    /* ---- people ---- */
    const probationEnd = (p: Person) => DateTime.fromISO(p.joined).plus({ months: 3 }).toISODate()!;
    await Employee.insertMany(
      roster.map((p) => {
        const noticeStart = today.minus({ days: 10 });
        const ended = p.status === 'RESIGNED';
        return {
          _id: p.id, tenantId: tid, userId: p.userId, employeeCode: p.code, firstName: p.first, lastName: p.last, workEmail: p.email,
          phone: `+91 90000 ${String(10000 + p.i * 37).slice(-5)}`, personalEmail: `${p.first}.${p.last}.personal${p.i}@example.invalid`.toLowerCase(),
          departmentId: depts.get(p.dept), designation: p.title, designationId: desigIds.get(p.title),
          dateOfBirth: utcDay(`${1982 + (p.i % 18)}-${String(1 + (p.i % 12)).padStart(2, '0')}-${String(1 + ((p.i * 5) % 27)).padStart(2, '0')}`),
          gender: p.i % 3 === 0 ? 'FEMALE' : p.i % 3 === 1 ? 'MALE' : 'UNDISCLOSED',
          managerId: p.managerIdx !== undefined ? P(p.managerIdx).id : undefined,
          employmentType: p.type, employmentStatus: p.status, attendanceMode: p.mode, joiningDate: utcDay(p.joined),
          probationStatus: p.probation ? 'ON_PROBATION' : 'CONFIRMED', probationEndDate: p.probation ? utcDay(probationEnd(p)) : undefined,
          confirmationDate: p.probation ? undefined : utcDay(probationEnd(p)),
          noticePeriodStartDate: p.status === 'NOTICE_PERIOD' ? noticeStart.toJSDate() : undefined,
          lastWorkingDate: p.status === 'NOTICE_PERIOD' ? today.plus({ days: 20 }).toJSDate() : ended ? today.minus({ days: 25 }).toJSDate() : undefined,
          workLocationIds: p.mode === 'REMOTE' ? [annex._id] : p.i % 4 === 0 ? [hq._id, annex._id] : [hq._id],
          emergencyContacts: [{ name: `${p.last} Family`, relationship: 'Family', phone: '+91 98000 00000' }],
          address: { line1: `${10 + p.i}, Demo Street`, city: 'Bengaluru', state: 'Karnataka', postalCode: '560001', country: 'India' },
          history: [
            { type: 'CREATED', to: 'ACTIVE', at: utcDay(p.joined), byUserId: owner.userId },
            ...(p.status === 'NOTICE_PERIOD' ? [{ type: 'STATUS_CHANGE', from: 'ACTIVE', to: 'NOTICE_PERIOD', at: noticeStart.toJSDate(), reason: 'Resignation approved', byUserId: hr.userId }] : []),
            ...(ended ? [{ type: 'STATUS_CHANGE', from: 'ACTIVE', to: 'RESIGNED', at: today.minus({ days: 25 }).toJSDate(), reason: 'Notice period completed', byUserId: hr.userId }] : []),
          ],
        };
      }),
    );
    for (const d of spec.depts) {
      const head = roster.find((p) => p.dept === d && p.roles[0] === 'MANAGER') ?? roster.find((p) => p.dept === d);
      if (head) await Department.updateOne({ _id: depts.get(d), tenantId: tid }, { $set: { headEmployeeId: head.id } });
    }
    await Counter.updateOne({ _id: `employee:${tid}` }, { $set: { seq: roster.length } }, { upsert: true });
    const currentIds = roster.filter((p) => p.status !== 'INVITED');
    await ShiftAssignment.insertMany(
      currentIds.map((p, n) => ({ tenantId: tid, employeeId: p.id, shiftId: n % 6 === 5 ? flexible._id : general._id, effectiveFrom: today.minus({ days: 140 }).toISODate()!, assignedBy: hr.userId })),
    );
    await CustomRole.insertMany(customRoleDefs.map((c) => ({ ...c, tenantId: tid, createdBy: owner.userId })));

    await EmploymentChange.insertMany(
      roster.filter((p) => p.roles[0] === 'EMPLOYEE' && p.status === 'ACTIVE' && !p.probation).slice(0, 3).flatMap((p, n) => [
        { tenantId: tid, employeeId: p.id, type: 'SALARY_REVISION', effectiveDate: today.minus({ months: 5 + n }).toISODate()!, reason: 'Annual review (demo)', recordedBy: hr.userId, before: {}, after: {} },
        ...(n === 0 ? [{ tenantId: tid, employeeId: p.id, type: 'PROMOTION', effectiveDate: today.minus({ months: 8 }).toISODate()!, reason: 'Promoted after consistent delivery (demo)', recordedBy: hr.userId, before: { designation: 'Executive' }, after: { designation: p.title } }] : []),
        ...(n === 1 ? [{ tenantId: tid, employeeId: p.id, type: 'TRANSFER', effectiveDate: today.minus({ months: 6 }).toISODate()!, reason: 'Moved closer to the team (demo)', recordedBy: hr.userId, before: { department: 'Operations' }, after: { department: p.dept } }] : []),
      ]),
    );
    await ProfileItem.insertMany(
      currentIds.slice(0, Math.min(currentIds.length, 14)).flatMap((p, n) => [
        { tenantId: tid, employeeId: p.id, kind: 'QUALIFICATION', title: n % 2 ? 'B.Com' : 'B.Tech', organization: 'Demo University', fromDate: '2010-07-01', toDate: '2014-05-31', createdBy: p.userId, verifiedBy: n % 3 ? hr.userId : undefined, verifiedAt: n % 3 ? now.toJSDate() : undefined },
        { tenantId: tid, employeeId: p.id, kind: 'SKILL', title: ['TypeScript', 'Negotiation', 'Excel', 'Customer care'][n % 4]!, level: (['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'] as const)[n % 4], createdBy: p.userId },
        ...(n % 3 === 0 ? [{ tenantId: tid, employeeId: p.id, kind: 'CERTIFICATION', title: 'Workplace safety (demo)', organization: 'Demo Institute', credentialId: `DEMO-${1000 + n}`, fromDate: `${year - 1}-03-01`, createdBy: p.userId }] : []),
        ...(n % 4 === 1 ? [{ tenantId: tid, employeeId: p.id, kind: 'EXPERIENCE', title: 'Associate', organization: 'Earlier Employer Pvt Ltd (demo)', fromDate: '2016-06-01', toDate: '2020-04-30', createdBy: p.userId }] : []),
      ]),
    );
    await EmployeeSensitive.insertMany(
      currentIds.map((p) => {
        const enc = (field: string, v: string) => (key ? encryptField(v, key, `${String(tid)}:${String(p.id)}:${field}`) : undefined);
        return {
          tenantId: tid, employeeId: p.id, accountHolder: `${p.first} ${p.last}`, bankName: 'Demo Bank', branch: 'Main Branch', ifsc: 'DEMO0000001', updatedBy: hr.userId,
          accountNumberEnc: enc('accountNumber', `0000${String(1000000 + p.i * 7919)}`), panEnc: enc('pan', `ZZZZZ${String(1000 + p.i).slice(-4)}Z`),
          aadhaarEnc: enc('aadhaar', `0000${String(10000000 + p.i * 131)}`), uanEnc: enc('uan', `DEMO${String(100000000 + p.i)}`),
        };
      }),
    );

    /* ---- documents ---- */
    if (has('DOCUMENTS')) {
      const cats = ['ID_PROOF', 'CONTRACT', 'OFFER_LETTER', 'CERTIFICATE', 'TAX_FORM'] as const;
      let n = 0;
      const docs = currentIds.slice(0, 12).flatMap((p) => cats.slice(0, 2 + (p.i % 3)).map((category) => {
        n++;
        return { tenantId: tid, employeeId: p.id, referenceNo: `DOC-${year}-${String(n).padStart(4, '0')}`, category, title: `${category.replace('_', ' ').toLowerCase()} - ${p.first} ${p.last}`, fileName: `${category.toLowerCase()}-${p.code}.pdf`, contentType: 'application/pdf', sizeBytes: 40000 + n * 913, storageKey: `demo/${spec.slug}/${p.code}/${category.toLowerCase()}.pdf`, status: 'AVAILABLE', visibleToEmployee: category !== 'CONTRACT', uploadedBy: hr.userId, availableAt: now.minus({ days: n }).toJSDate() };
      }));
      await EmployeeDocument.insertMany(docs);
      await Counter.updateOne({ _id: `document:${tid}:${year}` }, { $set: { seq: n } }, { upsert: true });
    }

    /* ---- leave ---- */
    const lt = new Map<string, Types.ObjectId>();
    if (has('LEAVE')) {
      const types = [
        { name: 'Casual Leave', code: 'CL', paid: true, annualAllowanceDays: 12, carryForwardMaxDays: 0 },
        { name: 'Sick Leave', code: 'SL', paid: true, annualAllowanceDays: 12, carryForwardMaxDays: 0 },
        { name: 'Earned Leave', code: 'EL', paid: true, annualAllowanceDays: 15, accrualMode: 'MONTHLY', carryForwardMaxDays: 10 },
        { name: 'Unpaid Leave', code: 'LWP', paid: false, annualAllowanceDays: 0, carryForwardMaxDays: 0 },
      ];
      for (const t of types) lt.set(t.code, (await LeaveType.create({ ...t, tenantId: tid }))._id);
      for (let m = 1; m <= today.month; m++) await runMonthlyAccrual(tid, `${year}-${String(m).padStart(2, '0')}`, hr.userId);
      await LeaveLedger.insertMany(
        currentIds.slice(0, 3).map((p) => ({ tenantId: tid, employeeId: p.id, leaveTypeId: lt.get('EL')!, year, kind: 'ADJUSTMENT', days: 2, reason: 'Goodwill credit (demo)', createdBy: hr.userId })),
      );
    }

    /* ---- approvals engine ---- */
    const wf = new Map<string, Types.ObjectId>();
    const wfDefs = [
      { requestType: 'LEAVE', name: 'Leave approval', steps: [{ approverType: 'MANAGER' }, { approverType: 'ROLE', role: 'HR_ADMIN', condition: { field: 'days', op: 'GT', value: 3 }, escalation: { afterHours: 48, approverType: 'ROLE', role: 'COMPANY_OWNER' } }] },
      { requestType: 'WFH', name: 'Work from home', steps: [{ approverType: 'MANAGER' }] },
      { requestType: 'RESIGNATION', name: 'Resignation', steps: [{ approverType: 'MANAGER' }, { approverType: 'ROLE', role: 'HR_ADMIN', escalation: { afterHours: 72, approverType: 'ROLE', role: 'COMPANY_OWNER' } }] },
      { requestType: 'ASSET_REQUEST', name: 'Equipment request (two managers)', steps: [{ approverType: 'ROLE', role: 'MANAGER', mode: 'QUORUM', quorum: 2 }] },
    ];
    for (const w of wfDefs) wf.set(w.requestType, idOf(await ApprovalWorkflow.create({ ...w, tenantId: tid } as never)));

    type StepIn = { type?: string; role?: string; approvers: Person[]; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED' | 'WAITING'; by?: Person; comment?: string; at?: Date; mode?: 'ANY' | 'ALL' | 'QUORUM'; required?: number; approvals?: Person[] };
    const mkRequest = async (type: string, title: string, requester: Person, details: object, steps: StepIn[], status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED', created: Date) => {
      const doc = await ApprovalRequest.create({
        tenantId: tid, workflowId: wf.get(type)!, requestType: type, title, details, requesterEmployeeId: requester.id, requesterUserId: requester.userId,
        status, currentStep: Math.max(0, steps.findIndex((s) => s.status === 'PENDING')), decidedAt: status === 'PENDING' ? undefined : created,
        steps: steps.map((s, order) => ({
          order, approverType: s.type ?? (s.role ? 'ROLE' : 'MANAGER'), role: s.role, approverEmployeeIds: s.approvers.map((a) => a.id), status: s.status,
          actedByUserId: s.by?.userId, actedByEmployeeId: s.by?.id, actedAt: s.by ? (s.at ?? created) : undefined, comment: s.comment,
          mode: s.mode ?? 'ANY', required: s.required ?? 1,
          approvals: (s.approvals ?? []).map((a) => ({ employeeId: a.id, actedByUserId: a.userId, actedByEmployeeId: a.id, at: created })),
          pendingSince: s.status === 'PENDING' ? created : undefined,
        })),
        createdAt: created,
      } as never);
      return idOf(doc);
    };
    const mgrOf = (p: Person) => (p.managerIdx !== undefined ? P(p.managerIdx) : owner);

    /* ---- leave requests (some tied to approval requests) ---- */
    const workers = roster.filter((p) => p.roles[0] === 'EMPLOYEE' && p.status === 'ACTIVE');
    const leaveDays = new Map<string, Set<string>>(); // employee -> dates on approved leave
    const workingDays = (from: DateTime, to: DateTime) => {
      const out: string[] = [];
      for (let d = from; d <= to; d = d.plus({ days: 1 })) if (d.weekday < 6 && !holidayDates.has(d.toISODate()!)) out.push(d.toISODate()!);
      return out;
    };
    if (has('LEAVE') && workers.length >= 3) {
      const plan: { w: Person; code: string; offset: number; len: number; status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'CANCELLED'; reason: string }[] = [
        { w: workers[0]!, code: 'CL', offset: -12, len: 2, status: 'APPROVED', reason: 'Family function' },
        { w: workers[1]!, code: 'SL', offset: -20, len: 1, status: 'APPROVED', reason: 'Fever' },
        { w: workers[2]!, code: 'EL', offset: -30, len: 4, status: 'APPROVED', reason: 'Short trip' },
        { w: workers[0]!, code: 'CL', offset: 6, len: 2, status: 'PENDING', reason: 'Personal work' },
        { w: workers[1]!, code: 'EL', offset: 14, len: 5, status: 'PENDING', reason: 'Vacation' },
        { w: workers[2]!, code: 'CL', offset: -6, len: 1, status: 'REJECTED', reason: 'Errand' },
        { w: workers[Math.min(3, workers.length - 1)]!, code: 'CL', offset: 9, len: 1, status: 'CANCELLED', reason: 'Plans changed' },
      ];
      for (const L of plan) {
        let start = today.plus({ days: L.offset });
        while (start.weekday > 5 || holidayDates.has(start.toISODate()!)) start = start.plus({ days: 1 });
        const days = workingDays(start, start.plus({ days: L.len - 1 + (L.len > 1 ? 2 : 0) })).slice(0, L.len);
        if (!days.length) continue;
        const startDate = days[0]!, endDate = days[days.length - 1]!;
        const mgr = mgrOf(L.w);
        const steps: StepIn[] =
          L.status === 'PENDING' ? [{ approvers: [mgr], status: 'PENDING' }, { role: 'HR_ADMIN', approvers: [hr], status: days.length > 3 ? 'WAITING' : 'SKIPPED' }]
          : L.status === 'APPROVED' ? [{ approvers: [mgr], status: 'APPROVED', by: mgr, comment: 'Approved' }, { role: 'HR_ADMIN', approvers: [hr], status: days.length > 3 ? 'APPROVED' : 'SKIPPED', by: days.length > 3 ? hr : undefined }]
          : L.status === 'REJECTED' ? [{ approvers: [mgr], status: 'REJECTED', by: mgr, comment: 'Release deadline that day' }]
          : [{ approvers: [mgr], status: 'WAITING' }];
        const arId = await mkRequest('LEAVE', `Leave ${startDate} to ${endDate}`, L.w, { days: days.length, leaveType: L.code }, steps, L.status, now.minus({ days: Math.abs(L.offset) + 2 }).toJSDate());
        await LeaveRequest.create({
          tenantId: tid, employeeId: L.w.id, leaveTypeId: lt.get(L.code)!, requestedBy: L.w.userId, startDate, endDate, days: days.length, reason: L.reason,
          status: L.status, approvalRequestId: arId, reviewedBy: ['APPROVED', 'REJECTED'].includes(L.status) ? mgr.userId : undefined,
          reviewedAt: ['APPROVED', 'REJECTED'].includes(L.status) ? now.minus({ days: Math.abs(L.offset) }).toJSDate() : undefined, reviewComment: L.status === 'REJECTED' ? 'Release deadline that day' : undefined,
        } as never);
        if (L.status === 'APPROVED') {
          const set = leaveDays.get(String(L.w.id)) ?? new Set<string>();
          days.forEach((d) => set.add(d));
          leaveDays.set(String(L.w.id), set);
        }
      }
    }

    /* ---- attendance: punches for the window, summaries recalculated by the real engine ---- */
    const tinfo = await loadTenant(tid);
    const firstDay = today.minus({ days: spec.attendanceDays });
    const actives = roster.filter((p) => p.status === 'ACTIVE' || p.status === 'NOTICE_PERIOD');
    const events: Record<string, unknown>[] = [];
    for (let d = firstDay; d < today; d = d.plus({ days: 1 })) {
      const iso = d.toISODate()!;
      if (d.weekday > 5 || holidayDates.has(iso)) continue;
      for (const p of actives) {
        if (DateTime.fromISO(p.joined) > d) continue;
        if (leaveDays.get(String(p.id))?.has(iso)) continue;
        if (R() < 0.04) continue; // an unexplained absence
        const late = R() < 0.18 ? 12 + Math.floor(R() * 40) : Math.floor(R() * 9);
        const outMin = R() < 0.1 ? -45 : Math.floor(R() * 40);
        const t = (h: number, m: number) => d.set({ hour: h, minute: 0 }).plus({ minutes: m }).toJSDate();
        const seq: [(typeof EVENT_TYPES)[number], Date][] = [
          ['CHECK_IN', t(9, late)], ['BREAK_START', t(13, 0)], ['BREAK_END', t(13, 40 + Math.floor(R() * 20))], ['CHECK_OUT', t(18, outMin)],
        ];
        for (const [eventType, occurredAt] of seq)
          events.push({
            tenantId: tid, employeeId: p.id, eventType, occurredAt, receivedAt: occurredAt, workDate: iso, shiftId: general._id,
            location: { type: 'Point', coordinates: [77.5946 + (R() - 0.5) * 0.0004, 12.9716 + (R() - 0.5) * 0.0004] }, locationAccuracyMeters: 8 + Math.floor(R() * 20), workLocationId: hq._id,
            verification: p.mode === 'REMOTE' ? { status: 'NOT_REQUIRED', method: 'REMOTE' } : { status: 'VERIFIED', method: 'GEOFENCE', distanceMeters: Math.floor(R() * 60) },
            idempotencyKey: `demo-${p.code}-${iso}-${eventType}`, source: p.i % 2 ? 'MOBILE' : 'WEB',
          });
      }
    }
    for (let i = 0; i < events.length; i += 1000) await AttendanceEvent.insertMany(events.slice(i, i + 1000), { ordered: false });
    // Every day in the window (punched days, leave, holidays, weekly offs, absences) gets its summary from the real engine.
    // Leave days and absences get their summary too (ON_LEAVE, HOLIDAY, WEEKLY_OFF, ABSENT)
    for (let d = firstDay; d < today; d = d.plus({ days: 1 })) for (const p of actives) if (DateTime.fromISO(p.joined) <= d) await recalculateDay(tinfo, p.id, d.toISODate()!, now.toJSDate()).catch(() => undefined);

    const a1 = workers[0] ?? P(roster.length - 1);
    const a2 = workers[1] ?? a1;
    const yday = today.minus({ days: 1 }).toISODate()!;
    const exc = (n: number, status: 'PENDING' | 'APPROVED' | 'REJECTED', person: Person) => ({
      tenantId: tid, employeeId: person.id, eventType: 'CHECK_IN' as const, occurredAt: now.minus({ days: n }).set({ hour: 9, minute: 5 }).toJSDate(), failure: 'OUTSIDE_GEOFENCE', distanceMeters: 420, locationAccuracyMeters: 25,
      location: { type: 'Point' as const, coordinates: [77.6, 12.98] }, workLocationId: hq._id, employeeReason: 'Client site visit before the office', idempotencyKey: `demo-exc-${person.code}-${n}`, status,
      reviewedBy: status === 'PENDING' ? undefined : hr.userId, reviewedAt: status === 'PENDING' ? undefined : now.toJSDate(), reviewComment: status === 'REJECTED' ? 'Please use a correction request' : undefined,
    });
    await AttendanceException.insertMany([exc(40, 'APPROVED', a1), exc(3, 'PENDING', a2), exc(25, 'REJECTED', a1)]);
    await AttendanceCorrection.insertMany([
      { tenantId: tid, employeeId: a1.id, workDate: yday, requestedChanges: { checkOut: now.minus({ days: 1 }).set({ hour: 18, minute: 30 }).toJSDate() }, reason: 'Forgot to punch out', status: 'PENDING', requestedBy: a1.userId },
      { tenantId: tid, employeeId: a2.id, workDate: today.minus({ days: 15 }).toISODate()!, requestedChanges: { checkIn: now.minus({ days: 15 }).set({ hour: 9, minute: 0 }).toJSDate() }, reason: 'Biometric offline', status: 'APPROVED', requestedBy: a2.userId, reviewedBy: hr.userId, reviewedAt: now.minus({ days: 14 }).toJSDate() },
      { tenantId: tid, employeeId: a2.id, workDate: today.minus({ days: 30 }).toISODate()!, requestedChanges: { checkOut: now.minus({ days: 30 }).set({ hour: 19, minute: 0 }).toJSDate() }, reason: 'Recorded by HR from the gate log', status: 'APPROVED', origin: 'HR_MANUAL', requestedBy: hr.userId, reviewedBy: hr.userId, reviewedAt: now.minus({ days: 29 }).toJSDate() },
    ]);
    await PunchPhoto.insertMany([{ tenantId: tid, employeeId: a1.id, contentType: 'image/jpeg', sizeBytes: 52000, storageKey: `demo/${spec.slug}/photos/expired-1.jpg`, status: 'DELETED', deletedAt: now.minus({ days: 5 }).toJSDate() }]);

    if (has('ATTENDANCE')) {
      const w = (offset: number, len: number, status: 'PENDING' | 'APPROVED' | 'REJECTED', person: Person, reason: string) => ({
        tenantId: tid, employeeId: person.id, requestedBy: person.userId, startDate: today.plus({ days: offset }).toISODate()!, endDate: today.plus({ days: offset + len - 1 }).toISODate()!, reason, status,
        decidedAt: status === 'PENDING' ? undefined : now.toJSDate(), decisionComment: status === 'REJECTED' ? 'Team day in the office' : undefined,
      });
      const wfh = [w(2, 1, 'PENDING', a1, 'Plumber visit'), w(-9, 2, 'APPROVED', a2, 'Internet installation'), w(-20, 1, 'REJECTED', a1, 'Prefer to avoid commute')];
      const pend = await mkRequest('WFH', `Work from home: ${wfh[0]!.startDate}`, a1, { startDate: wfh[0]!.startDate, endDate: wfh[0]!.endDate }, [{ approvers: [mgrOf(a1)], status: 'PENDING' }], 'PENDING', now.minus({ hours: 20 }).toJSDate());
      await WfhRequest.insertMany(wfh.map((x, n) => ({ ...x, approvalRequestId: n === 0 ? pend : undefined })));
    }

    /* ---- in-flight approvals: quorum, delegation, resignations ---- */
    const managers = roster.filter((p) => p.roles[0] === 'MANAGER');
    if (managers.length >= 2)
      await mkRequest('ASSET_REQUEST', 'Laptop replacement', a1, { item: 'Laptop', estimateMajor: 70000 }, [{ role: 'MANAGER', approvers: managers, status: 'PENDING', mode: 'QUORUM', required: 2, approvals: [managers[0]!] }], 'PENDING', now.minus({ days: 1 }).toJSDate());
    if (managers.length) await ApprovalDelegation.create({ tenantId: tid, delegatorEmployeeId: managers[0]!.id, delegateEmployeeId: hr.id, from: today.minus({ days: 1 }).toJSDate(), to: today.plus({ days: 6 }).toJSDate() });

    const leaver = roster.find((p) => p.status === 'NOTICE_PERIOD');
    if (leaver) {
      const arId = await mkRequest('RESIGNATION', `Resignation: last day ${today.plus({ days: 20 }).toISODate()}`, leaver, { proposedLastDay: today.plus({ days: 20 }).toISODate() }, [{ approvers: [mgrOf(leaver)], status: 'APPROVED', by: mgrOf(leaver), comment: 'Sorry to see you go' }, { role: 'HR_ADMIN', approvers: [hr], status: 'APPROVED', by: hr }], 'APPROVED', now.minus({ days: 10 }).toJSDate());
      await Resignation.create({ tenantId: tid, employeeId: leaver.id, requestedBy: leaver.userId, proposedLastDay: today.plus({ days: 20 }).toISODate()!, reason: 'Moving to another city', status: 'APPROVED', approvalRequestId: arId, decidedAt: now.minus({ days: 10 }).toJSDate() });
    }
    const rpending = workers[workers.length - 1];
    if (rpending && rpending !== leaver) {
      const arId = await mkRequest('RESIGNATION', `Resignation: last day ${today.plus({ days: 45 }).toISODate()}`, rpending, { proposedLastDay: today.plus({ days: 45 }).toISODate() }, [{ approvers: [mgrOf(rpending)], status: 'PENDING' }, { role: 'HR_ADMIN', approvers: [hr], status: 'WAITING' }], 'PENDING', now.minus({ hours: 6 }).toJSDate());
      await Resignation.create({ tenantId: tid, employeeId: rpending.id, requestedBy: rpending.userId, proposedLastDay: today.plus({ days: 45 }).toISODate()!, reason: 'Higher studies', status: 'PENDING', approvalRequestId: arId });
    }

    /* ---- letters and handbook ---- */
    if (has('LETTERS')) {
      const tpls = await LetterTemplate.insertMany([
        { tenantId: tid, title: 'Offer letter', category: 'OFFER', body: 'Dear {{employee.name}},\n\nWe are pleased to offer you the position of {{employee.designation}} at {{company.name}}.\n\nSincerely,\nHR', createdBy: hr.userId },
        { tenantId: tid, title: 'Confirmation letter', category: 'CONFIRMATION', body: 'Dear {{employee.name}},\n\nYour employment is confirmed with effect from your probation end date.\n\nHR', createdBy: hr.userId },
        { tenantId: tid, title: 'Experience letter', category: 'EXPERIENCE', body: 'This certifies that {{employee.name}} worked with {{company.name}}.\n\nHR', createdBy: hr.userId },
        { tenantId: tid, title: 'Address proof', category: 'ADDRESS_PROOF', body: 'This certifies that {{employee.name}} is employed with {{company.name}}.', status: 'ARCHIVED', createdBy: hr.userId },
      ]);
      const issuedFor = currentIds.slice(0, 6);
      await IssuedLetter.insertMany(issuedFor.map((p, n) => ({
        tenantId: tid, employeeId: p.id, templateId: tpls[n % 3]!._id, referenceNo: `LTR-${year}-${String(n + 1).padStart(4, '0')}`, title: tpls[n % 3]!.title, category: tpls[n % 3]!.category,
        body: `Dear ${p.first} ${p.last},\n\n(Demo letter body issued by ${spec.name}.)`, issuedBy: hr.userId, issuedAt: now.minus({ days: 40 - n * 5 }).toJSDate(),
        status: n === 5 ? 'REVOKED' : 'ISSUED', revokedAt: n === 5 ? now.toJSDate() : undefined, revokeReason: n === 5 ? 'Issued with the wrong date (demo)' : undefined,
      })));
      await Counter.updateOne({ _id: `letter:${tid}:${year}` }, { $set: { seq: issuedFor.length } }, { upsert: true });
    }
    if (has('HANDBOOK')) {
      const sections = ['Welcome', 'Working hours and attendance', 'Leave policy', 'Code of conduct', 'Using company equipment', 'Draft: remote work guidelines'];
      await HandbookSection.insertMany(sections.map((title, order) => ({ tenantId: tid, title, order, body: `${title}\n\nThis is demo handbook text for ${spec.name}. Replace it with your own policy.`, status: order === 5 ? 'DRAFT' : 'PUBLISHED', publishedAt: order === 5 ? undefined : now.minus({ days: 60 }).toJSDate(), updatedBy: hr.userId })));
    }

    /* ---- payroll ---- */
    if (has('PAYROLL')) {
      const payroll = roster.find((p) => p.roles[0] === 'PAYROLL_ADMIN') ?? hr;
      await StatutoryRule.insertMany([
        { tenantId: tid, code: 'DEMO_PF', name: 'Demo provident contribution (employee)', party: 'EMPLOYEE', method: 'PERCENT', wageComponents: ['BASIC'], percentBp: 1000, wageCeilingMinor: 1500000, effectiveFrom: `${year - 1}-01-01`, reference: 'DEMO VALUE, not a statutory rate. Set your own in Payroll.', createdBy: payroll.userId },
        { tenantId: tid, code: 'DEMO_PF_ER', name: 'Demo provident contribution (employer)', party: 'EMPLOYER', method: 'PERCENT', wageComponents: ['BASIC'], percentBp: 1000, wageCeilingMinor: 1500000, effectiveFrom: `${year - 1}-01-01`, reference: 'DEMO VALUE, not a statutory rate.', createdBy: payroll.userId },
        { tenantId: tid, code: 'DEMO_LEVY', name: 'Demo professional levy', party: 'EMPLOYEE', method: 'SLAB', slabs: [{ fromMinor: 0, toMinor: 2000000, amountMinor: 0 }, { fromMinor: 2000000, amountMinor: 20000 }], effectiveFrom: `${year - 1}-01-01`, reference: 'DEMO VALUE, not a statutory rate.', createdBy: payroll.userId },
      ]);
      await SalaryStructure.insertMany(
        currentIds.map((p) => ({
          tenantId: tid, employeeId: p.id, effectiveFrom: p.joined, currency: 'INR', createdBy: payroll.userId, note: 'Demo structure',
          components: [
            { code: 'BASIC', name: 'Basic', kind: 'EARNING', calc: 'FIXED', value: Math.round(p.salaryMajor * 0.5) * 100 },
            { code: 'HRA', name: 'House rent allowance', kind: 'EARNING', calc: 'PERCENT_OF_BASIC', value: 4000 },
            { code: 'SPECIAL', name: 'Special allowance', kind: 'EARNING', calc: 'FIXED', value: Math.round(p.salaryMajor * 0.3) * 100 },
            { code: 'TRANSPORT', name: 'Transport', kind: 'EARNING', calc: 'FIXED', value: 160000, prorate: false },
          ],
        })),
      );
      const prev = today.startOf('month').minus({ months: 1 });
      await PayrollAdjustment.insertMany([
        { tenantId: tid, employeeId: P(2 % roster.length).id, month: prev.toFormat('yyyy-MM'), kind: 'EARNING', code: 'BONUS', label: 'Performance bonus', amountMinor: 500000, reason: 'Quarterly target met (demo)', createdBy: payroll.userId },
        { tenantId: tid, employeeId: a1.id, month: prev.toFormat('yyyy-MM'), kind: 'DEDUCTION', code: 'ADV', label: 'Salary advance recovery', amountMinor: 250000, reason: 'Advance given last month (demo)', createdBy: payroll.userId },
        { tenantId: tid, employeeId: a2.id, month: prev.toFormat('yyyy-MM'), kind: 'EARNING', code: 'ADJ', label: 'Mistaken entry', amountMinor: 100000, reason: 'Entered by mistake (demo)', status: 'VOIDED', createdBy: payroll.userId, voidedBy: payroll.userId, voidedAt: now.toJSDate() },
      ]);
      const older = await generateRun(tinfo, prev.minus({ months: 1 }).toFormat('yyyy-MM'), payroll.userId, now.toJSDate());
      await publishRun(tid, String(older._id), hr.userId, now.toJSDate());
      await generateRun(tinfo, prev.toFormat('yyyy-MM'), payroll.userId, now.toJSDate());
      await PayrollRun.countDocuments({ tenantId: tid });
    }

    /* ---- recruitment ---- */
    if (has('RECRUITMENT')) {
      const jobs = await JobOpening.insertMany([
        { tenantId: tid, title: 'Senior Software Engineer', departmentId: depts.get('Engineering'), designationId: desigIds.get('Senior Software Engineer'), hiringManagerId: managers[0]?.id, headcount: 2, description: 'Build and run our core product (demo).', status: 'OPEN', openedAt: now.minus({ days: 30 }).toJSDate(), createdBy: hr.userId },
        { tenantId: tid, title: 'Sales Executive', departmentId: depts.get('Sales'), designationId: desigIds.get('Executive'), hiringManagerId: managers[1]?.id, headcount: 1, status: 'OPEN', openedAt: now.minus({ days: 12 }).toJSDate(), createdBy: hr.userId },
        { tenantId: tid, title: 'Operations Intern', departmentId: depts.get('Operations'), employmentType: 'INTERN', headcount: 1, status: 'CLOSED', openedAt: now.minus({ days: 90 }).toJSDate(), closedAt: now.minus({ days: 40 }).toJSDate(), closeReason: 'Filled', createdBy: hr.userId },
        { tenantId: tid, title: 'Finance Analyst (draft)', departmentId: depts.get('Finance'), headcount: 1, status: 'DRAFT', createdBy: hr.userId },
      ]);
      const hired = roster.find((p) => p.probation);
      const stages = ['APPLIED', 'APPLIED', 'SCREENING', 'SCREENING', 'INTERVIEW', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN', 'APPLIED', 'INTERVIEW'] as const;
      const interviewer = managers[0] ?? hr;
      await Candidate.insertMany(stages.map((stage, n) => {
        const job = jobs[stage === 'HIRED' ? 2 : n % 2]!;
        const at = now.minus({ days: 25 - n });
        const interviews = ['INTERVIEW', 'OFFER', 'HIRED'].includes(stage)
          ? [{ scheduledAt: at.plus({ days: 3 }).toJSDate(), interviewerId: interviewer.id, mode: 'VIDEO', round: 'Technical', feedback: stage === 'INTERVIEW' && n % 2 ? undefined : { rating: 4, recommendation: 'YES', comment: 'Solid fundamentals (demo)', submittedAt: at.plus({ days: 3 }).toJSDate() } }]
          : [];
        return {
          tenantId: tid, jobId: job._id, firstName: FIRST[(n * 5 + 2) % FIRST.length]!, lastName: LAST[(n * 3 + 9) % LAST.length]!, email: `candidate${n + 1}@example.invalid`, phone: `+91 97000 0${String(1000 + n).slice(-4)}`,
          source: ['Referral', 'Job board', 'Careers page'][n % 3], stage, rejectionReason: stage === 'REJECTED' ? 'Not enough relevant experience (demo)' : undefined,
          stageHistory: [{ from: undefined, to: 'APPLIED', at: at.toJSDate(), byUserId: hr.userId }, ...(stage !== 'APPLIED' ? [{ from: 'APPLIED', to: stage, at: at.plus({ days: 2 }).toJSDate(), byUserId: hr.userId }] : [])],
          notes: n % 2 ? [{ text: 'Good first call (demo).', byUserId: hr.userId, at: at.plus({ days: 1 }).toJSDate() }] : [], interviews,
          offer: ['OFFER', 'HIRED'].includes(stage) ? { status: stage === 'HIRED' ? 'ACCEPTED' : 'MADE', designationId: desigIds.get('Executive'), proposedJoiningDate: today.plus({ days: 30 }).toISODate()!, note: 'Subject to checks (demo)', madeAt: at.plus({ days: 8 }).toJSDate(), decidedAt: stage === 'HIRED' ? at.plus({ days: 9 }).toJSDate() : undefined } : undefined,
          hiredEmployeeId: stage === 'HIRED' ? hired?.id : undefined, createdBy: hr.userId,
        };
      }));
    }

    /* ---- audit trail ---- */
    const audit = (actor: Person, action: string, entityType: string, entityId: unknown, daysAgo: number, extra: object = {}) => ({
      tenantId: tid, actorUserId: actor.userId, action, entityType, entityId: String(entityId), requestId: `demo-${spec.slug}-${daysAgo}`, createdAt: now.minus({ days: daysAgo }).toJSDate(), ...extra,
    });
    await AuditLog.insertMany([
      audit(owner, 'tenant.update', 'Tenant', tid, 80, { sanitizedAfter: { timezone: ZONE } }),
      ...roster.slice(0, 6).map((p, n) => audit(hr, 'employee.create', 'Employee', p.id, 85 - n)),
      audit(hr, 'employee.deactivate', 'Employee', roster.find((p) => p.status === 'RESIGNED')?.id ?? owner.id, 25, { reason: 'Notice period completed' }),
      audit(hr, 'leave.review', 'LeaveRequest', a1.id, 12, { sanitizedAfter: { status: 'APPROVED' } }),
      audit(owner, 'role.create', 'CustomRole', customRoleDefs[0]!._id, 50, { sanitizedAfter: { name: customRoleDefs[0]!.name } }),
      audit(hr, 'letter.issue', 'IssuedLetter', owner.id, 35),
      audit(hr, 'payroll.generate', 'PayrollRun', tid, 20),
    ] as never);
  });
}
