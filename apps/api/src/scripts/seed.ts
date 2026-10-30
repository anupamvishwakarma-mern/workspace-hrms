/**
 * LOCAL DEVELOPMENT ONLY. Creates a demo company with known credentials.
 * Refuses to run when NODE_ENV=production.
 *   pnpm --filter @workforce/api seed
 */
import { DateTime } from 'luxon';
import { AttendanceEvent } from '../database/models/attendanceEvent.model';
import { Department } from '../database/models/department.model';
import { Holiday } from '../database/models/holiday.model';
import { Shift } from '../database/models/shift.model';
import { ShiftAssignment } from '../database/models/shiftAssignment.model';
import { WorkLocation } from '../database/models/workLocation.model';
import { loadTenant, recalculateDay } from '../modules/attendance/attendance.service';
import { Employee } from '../database/models/employee.model';
import { Membership, type TenantRole } from '../database/models/membership.model';
import { Tenant } from '../database/models/tenant.model';
import { User } from '../database/models/user.model';
import { hashPassword } from '../utils/security';
import { runScript } from './bootstrap';

export const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo-Pass-12345';

void runScript(async (env) => {
  if (env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
  if (await Tenant.exists({ slug: 'demo-co' }))
    throw new Error('Demo tenant already exists. Drop the database to re-seed.');
  const tenant = await Tenant.create({
    name: 'Demo Company',
    slug: 'demo-co',
    timezone: 'Asia/Kolkata',
    // Live camera photo at every punch is on for new companies; HR can turn it off in Settings.
    settings: { attendance: { requirePhoto: true } },
  });
  const depts = Object.fromEntries(
    await Promise.all(
      ['Engineering', 'Human Resources', 'Sales'].map(async (name) => [
        name,
        await Department.create({ tenantId: tenant._id, name }),
      ]),
    ),
  );
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const people: {
    code: string;
    first: string;
    last: string;
    email: string;
    dept: string;
    roles: TenantRole[];
    manager?: string;
  }[] = [
    {
      code: 'EMP-0001',
      first: 'Olivia',
      last: 'Owner',
      email: 'owner@demo.test',
      dept: 'Human Resources',
      roles: ['COMPANY_OWNER'],
    },
    {
      code: 'EMP-0002',
      first: 'Hannah',
      last: 'Rao',
      email: 'hr@demo.test',
      dept: 'Human Resources',
      roles: ['HR_ADMIN'],
    },
    {
      code: 'EMP-0003',
      first: 'Manish',
      last: 'Kapoor',
      email: 'manager@demo.test',
      dept: 'Engineering',
      roles: ['MANAGER'],
    },
    {
      code: 'EMP-0004',
      first: 'Asha',
      last: 'Nair',
      email: 'asha@demo.test',
      dept: 'Engineering',
      roles: ['EMPLOYEE'],
      manager: 'EMP-0003',
    },
    {
      code: 'EMP-0005',
      first: 'Ravi',
      last: 'Menon',
      email: 'ravi@demo.test',
      dept: 'Engineering',
      roles: ['EMPLOYEE'],
      manager: 'EMP-0003',
    },
    {
      code: 'EMP-0006',
      first: 'Sara',
      last: 'Khan',
      email: 'sara@demo.test',
      dept: 'Sales',
      roles: ['EMPLOYEE'],
    },
    {
      code: 'EMP-0007',
      first: 'Pooja',
      last: 'Iyer',
      email: 'payroll@demo.test',
      dept: 'Human Resources',
      roles: ['PAYROLL_ADMIN'],
    },
  ];
  // $env:SUPER_ADMIN_PASSWORD="Super-Admin-12345"; pnpm --filter @workforce/api create-super-admin --email super@admin.com              
  const byCode = new Map<string, InstanceType<typeof Employee>>();
  for (const p of people) {
    const user = await User.create({
      email: p.email,
      passwordHash,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    });
    const emp = await Employee.create({
      tenantId: tenant._id,
      userId: user._id,
      employeeCode: p.code,
      firstName: p.first,
      lastName: p.last,
      workEmail: p.email,
      departmentId: depts[p.dept]!._id,
      managerId: p.manager ? byCode.get(p.manager)!._id : undefined,
      employmentStatus: 'ACTIVE',
      joiningDate: new Date('2024-01-15'),
      designation: p.roles[0],
      history: [{ type: 'CREATED', to: 'ACTIVE' }],
    });
    byCode.set(p.code, emp);
    await Membership.create({
      tenantId: tenant._id,
      userId: user._id,
      roles: p.roles,
      employeeId: emp._id,
    });
  }
  // ---- Phase 3: location, shift, holiday and a week or two of sample punches ----
  const HQ = { latitude: 12.9716, longitude: 77.5946 };
  const office = await WorkLocation.create({
    tenantId: tenant._id,
    name: 'Bengaluru HQ',
    address: 'Demo address, Bengaluru',
    location: { type: 'Point', coordinates: [HQ.longitude, HQ.latitude] },
    radiusMeters: 150,
  });
  const shift = await Shift.create({
    tenantId: tenant._id,
    name: 'General 09:00-18:00',
    startTime: '09:00',
    endTime: '18:00',
    graceMinutes: 10,
    earlyDepartureGraceMinutes: 5,
    breakPolicy: { type: 'RECORDED', expectedUnpaidMinutes: 60 },
    weeklyOffDays: [0, 6],
  });
  const zone = tenant.timezone;
  const today = DateTime.now().setZone(zone).startOf('day');
  for (const emp of byCode.values()) {
    await Employee.updateOne({ _id: emp._id }, { $set: { workLocationIds: [office._id] } });
    await ShiftAssignment.create({
      tenantId: tenant._id,
      employeeId: emp._id,
      shiftId: shift._id,
      effectiveFrom: today.minus({ days: 30 }).toISODate()!,
    });
  }
  const holiday = today.minus({ days: 3 });
  await Holiday.create({
    tenantId: tenant._id,
    name: 'Demo Company Day',
    date: holiday.toISODate()!,
    holidayType: 'COMPANY',
  });

  // Sample punches (inserted directly; real punches always go through the API with server time).
  const tenantInfo = await loadTenant(tenant._id);
  const sampleEmployees = ['EMP-0004', 'EMP-0005', 'EMP-0006'];
  let n = 0;
  for (let back = 1; back <= 10; back++) {
    const day = today.minus({ days: back });
    if ([6, 7].includes(day.weekday) || day.toISODate() === holiday.toISODate()) continue;
    for (const [i, code] of sampleEmployees.entries()) {
      const emp = byCode.get(code)!;
      const lateBy = (back + i) % 4 === 0 ? 25 : (i * 3) % 8; // some late arrivals
      const at = (h: number, m: number) => day.set({ hour: h, minute: m }).toJSDate();
      const times: ['CHECK_IN' | 'BREAK_START' | 'BREAK_END' | 'CHECK_OUT', Date][] = [
        ['CHECK_IN', at(9, lateBy)],
        ['BREAK_START', at(13, 0)],
        ['BREAK_END', at(13, 45)],
        ['CHECK_OUT', at(18, i === 2 && back % 3 === 0 ? 0 : 5)],
      ];
      if (code === 'EMP-0006' && back % 5 === 0) continue; // an absence
      for (const [eventType, occurredAt] of times) {
        await AttendanceEvent.create({
          tenantId: tenant._id,
          employeeId: emp._id,
          eventType,
          occurredAt,
          receivedAt: occurredAt,
          workDate: day.toISODate()!,
          shiftId: shift._id,
          location: { type: 'Point', coordinates: [HQ.longitude, HQ.latitude] },
          locationAccuracyMeters: 15,
          workLocationId: office._id,
          verification: { status: 'VERIFIED', method: 'GEOFENCE', distanceMeters: 20 },
          idempotencyKey: `seed-${code}-${day.toISODate()}-${eventType}`,
          source: 'MOBILE',
        });
        n++;
      }
      await recalculateDay(tenantInfo, emp._id, day.toISODate()!, new Date());
    }
  }
  console.log(
    `Seeded location "${office.name}", shift "${shift.name}", 1 holiday, ${n} sample punches.`,
  );
  console.log(
    `Seeded "Demo Company" with ${people.length} users. Password for all: ${DEMO_PASSWORD}`,
  );
  console.log(people.map((p) => `  ${p.email.padEnd(20)} ${p.roles.join(',')}`).join('\n'));
});
