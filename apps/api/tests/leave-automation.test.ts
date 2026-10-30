import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Employee } from '../src/database/models/employee.model';
import { LeaveLedger } from '../src/database/models/leaveLedger.model';
import { LeaveType } from '../src/database/models/leaveType.model';
import { Tenant } from '../src/database/models/tenant.model';
import { runLeaveAutomation } from '../src/modules/leave/automation';
import { bearer, createTenant, ist, loginAs, startTestApp, stopTestApp, type TestTenant } from './helpers';

let app: Express;
let t: TestTenant;
let off: TestTenant;
let typeId: string;

beforeAll(async () => {
  ({ app } = await startTestApp());
  t = await createTenant('auto-on');
  off = await createTenant('auto-off');
  for (const x of [t, off]) {
    await Tenant.updateOne({ _id: x.tenantId }, { $set: { timezone: 'Asia/Kolkata' } });
    await LeaveType.create({ tenantId: x.tenantId, name: 'Earned', code: 'ERN', annualAllowanceDays: 12, accrualMode: 'MONTHLY', carryForwardMaxDays: 5 });
  }
  typeId = String((await LeaveType.findOne({ tenantId: t.tenantId }).lean())!._id);
});
afterAll(stopTestApp);

const count = (tenant: TestTenant, kind: string) => LeaveLedger.countDocuments({ tenantId: tenant.tenantId, kind });

describe('automatic leave accrual and carry-forward', () => {
  it('is off until a company turns it on, and the switch starts the clock at the current month', async () => {
    const owner = await loginAs(app, t.people.owner.email);
    const get = () => request(app).get('/api/v1/tenants/current').set(bearer(owner)).set('X-Tenant-Id', String(t.tenantId));
    expect((await get()).body.data.settings.leave?.autoAccrual ?? false).toBe(false);
    // nothing happens for a company that has not switched it on
    expect((await runLeaveAutomation(new Date())).accrualEntries).toBe(0);
    expect(await count(t, 'ACCRUAL')).toBe(0);

    const res = await request(app)
      .patch('/api/v1/tenants/current')
      .set(bearer(owner))
      .set('X-Tenant-Id', String(t.tenantId))
      .send({ settings: { leave: { autoAccrual: true } } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const stored = await Tenant.findById(t.tenantId).lean();
    expect(stored!.settings!.leave!.autoAccrual).toBe(true);
    expect(stored!.settings!.leave!.autoSince).toMatch(/^\d{4}-\d{2}$/);
    // other roles cannot change it
    const hr = await loginAs(app, t.people.hr.email);
    expect(
      (await request(app).patch('/api/v1/tenants/current').set(bearer(hr)).set('X-Tenant-Id', String(t.tenantId)).send({ settings: { leave: { autoAccrual: false } } })).status,
    ).toBe(403);
  });

  it('credits each month once, catches up after downtime, never goes back before the start, and never touches other companies', async () => {
    await Tenant.updateOne({ _id: t.tenantId }, { $set: { 'settings.leave.autoSince': '2026-02' } });
    const people = await Employee.countDocuments({ tenantId: t.tenantId, employmentStatus: { $nin: ['TERMINATED', 'RESIGNED', 'RETIRED', 'INVITED'] } });
    expect(people).toBeGreaterThan(0);

    const march = new Date(ist('2026-03-15', '02:30'));
    const first = await runLeaveAutomation(march);
    expect(first.tenants).toBe(1);
    expect(first.accrualEntries).toBe(people! * 2); // February and March, not January
    const periods = (await LeaveLedger.distinct('period', { tenantId: t.tenantId, kind: 'ACCRUAL' })).sort();
    expect(periods).toEqual(['2026-02', '2026-03']);

    // running again, or later the same month, adds nothing
    expect((await runLeaveAutomation(march)).accrualEntries).toBe(0);
    expect((await runLeaveAutomation(new Date(ist('2026-03-20', '02:45')))).accrualEntries).toBe(0);
    // a missed month is made up
    const may = await runLeaveAutomation(new Date(ist('2026-05-02', '02:10')));
    expect(may.accrualEntries).toBe(people! * 2); // April and May
    // the company that never switched it on has nothing
    expect(await count(off, 'ACCRUAL')).toBe(0);
  });

  it('only runs in the company\'s early-morning hours when asked to', async () => {
    const noon = new Date(ist('2026-06-10', '12:00'));
    const r = await runLeaveAutomation(noon, { localHours: [2, 3] });
    expect(r.tenants).toBe(0);
    expect(r.skipped).toBe(1);
    expect(await LeaveLedger.countDocuments({ tenantId: t.tenantId, period: '2026-06' })).toBe(0);
  });

  it('carries leave forward in January for a year it was switched on for, once', async () => {
    await Tenant.updateOne({ _id: t.tenantId }, { $set: { 'settings.leave.autoSince': '2026-01' } });
    const jan = new Date(ist('2027-01-03', '02:30'));
    const a = await runLeaveAutomation(jan);
    expect(a.carryEntries).toBeGreaterThan(0);
    const carried = await LeaveLedger.find({ tenantId: t.tenantId, kind: 'CARRY_FORWARD', leaveTypeId: typeId }).lean();
    expect(carried.every((c) => c.year === 2027 && c.days <= 5)).toBe(true);
    expect((await runLeaveAutomation(jan)).carryEntries).toBe(0);
    expect(await count(off, 'CARRY_FORWARD')).toBe(0);
  });
});
