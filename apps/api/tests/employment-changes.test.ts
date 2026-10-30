import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Employee } from '../src/database/models/employee.model';
import { AuditLog } from '../src/database/models/auditLog.model';
import { bearer, createTenant, loginAs, startTestApp, stopTestApp, type TestTenant } from './helpers';

let app: Express;
let t: TestTenant;
let other: TestTenant;
const tok: Record<string, string> = {};
const call = (m: 'get' | 'post' | 'patch', who: string, path: string, body?: object) => {
  const r = request(app)[m](`/api/v1${path}`).set(bearer(tok[who]!));
  return body ? r.send(body) : r;
};
const emp = () => String(t.people.employee.employeeId);
let seniorId = '';
let leadId = '';
let deptId = '';

beforeAll(async () => {
  ({ app } = await startTestApp());
  t = await createTenant('changes');
  other = await createTenant('changes-other');
  for (const k of ['owner', 'hr', 'manager', 'employee', 'employee2'] as const) tok[k] = await loginAs(app, t.people[k].email);
  tok.otherHr = await loginAs(app, other.people.hr.email);
  seniorId = String((await call('post', 'hr', '/designations', { title: 'Senior Analyst' })).body.data.id);
  leadId = String((await call('post', 'hr', '/designations', { title: 'Lead Analyst' })).body.data.id);
  deptId = String((await call('post', 'hr', '/departments', { name: 'Research' })).body.data.id);
  await Employee.updateOne({ _id: emp(), tenantId: t.tenantId }, { $set: { joiningDate: new Date('2020-01-01T00:00:00Z') } });
});
afterAll(stopTestApp);

const rec = (body: object, who = 'hr') => call('post', who, `/employees/${emp()}/changes`, body);

describe('employment changes', () => {
  it('are recorded by HR only, never on your own record', async () => {
    const b = { type: 'PROMOTION', effectiveDate: '2024-04-01', reason: 'Annual review', designationId: seniorId };
    expect((await rec(b, 'employee')).status).toBe(403);
    expect((await rec(b, 'manager')).status).toBe(403);
    expect((await call('post', 'hr', `/employees/${t.people.hr.employeeId}/changes`, b)).status).toBe(403);
    expect((await rec(b, 'otherHr')).status).toBe(404);
  });

  it('a promotion changes the designation and keeps a before/after trail', async () => {
    const r = await rec({ type: 'PROMOTION', effectiveDate: '2024-04-01', reason: 'Annual review', designationId: seniorId });
    expect(r.status).toBe(201);
    expect(r.body.data.after.designation).toBe('Senior Analyst');
    const e = await Employee.findOne({ _id: emp(), tenantId: t.tenantId }).lean();
    expect(String(e!.designationId)).toBe(seniorId);
    expect(e!.designation).toBe('Senior Analyst');
    expect(e!.history.some((h: { type: string; reason?: string | null }) => h.type === 'DESIGNATION_CHANGE' && h.reason === 'Annual review')).toBe(true);
    expect(await AuditLog.countDocuments({ tenantId: t.tenantId, action: 'employee.change_recorded' })).toBe(1);
  });

  it('enforces the shape of each type', async () => {
    const base = { effectiveDate: '2024-05-01', reason: 'Because' };
    expect((await rec({ ...base, type: 'PROMOTION' })).status).toBe(422);
    expect((await rec({ ...base, type: 'PROMOTION', designationId: seniorId, departmentId: deptId })).status).toBe(422);
    expect((await rec({ ...base, type: 'TRANSFER' })).status).toBe(422);
    expect((await rec({ ...base, type: 'TRANSFER', designationId: leadId })).status).toBe(422);
    expect((await rec({ ...base, type: 'SALARY_REVISION', departmentId: deptId })).status).toBe(422);
    expect((await rec({ ...base, type: 'TRANSFER', departmentId: deptId, reason: 'x' })).status).toBe(422);
    expect((await rec({ ...base, type: 'PROMOTION', designationId: seniorId })).status).toBe(422); // nothing would change
  });

  it('dates must be today or earlier, after joining and after the previous change', async () => {
    const mk = (effectiveDate: string) => rec({ type: 'TRANSFER', effectiveDate, reason: 'Team move', departmentId: deptId });
    expect((await mk('2999-01-01')).status).toBe(422);
    expect((await mk('2019-12-31')).status).toBe(422);
    expect((await mk('2024-03-31')).status).toBe(422);
    const ok = await mk('2024-06-01');
    expect(ok.status).toBe(201);
    expect(ok.body.data.after.department).toBe('Research');
  });

  it('manager changes cannot create a reporting cycle; a transfer can clear the manager', async () => {
    // The test employee already reports to the manager, so move them under the owner.
    const boss = String(t.people.owner.employeeId);
    await Employee.updateOne({ _id: boss, tenantId: t.tenantId }, { $set: { managerId: emp() } });
    const cyc = await rec({ type: 'TRANSFER', effectiveDate: '2024-07-01', reason: 'Report to owner', managerId: boss });
    expect(cyc.status).toBe(400);
    await Employee.updateOne({ _id: boss, tenantId: t.tenantId }, { $unset: { managerId: 1 } });
    const moved = await rec({ type: 'TRANSFER', effectiveDate: '2024-07-01', reason: 'Report to owner', managerId: boss });
    expect(moved.status).toBe(201);
    expect(moved.body.data.after.manager).toBeTruthy();
    expect((await rec({ type: 'TRANSFER', effectiveDate: '2024-07-15', reason: 'Same again', managerId: boss })).status).toBe(422);
    const cleared = await rec({ type: 'TRANSFER', effectiveDate: '2024-08-01', reason: 'Now independent', managerId: null });
    expect(cleared.status).toBe(201);
    expect((await Employee.findOne({ _id: emp(), tenantId: t.tenantId }).lean())!.managerId ?? null).toBeNull();
  });

  it('a salary revision is a record only', async () => {
    const before = await Employee.findOne({ _id: emp(), tenantId: t.tenantId }).lean();
    const r = await rec({ type: 'SALARY_REVISION', effectiveDate: '2024-09-01', reason: 'Annual increment' });
    expect(r.status).toBe(201);
    expect(r.body.data.after).toBeUndefined();
    const after = await Employee.findOne({ _id: emp(), tenantId: t.tenantId }).lean();
    expect(after!.designation).toBe(before!.designation);
  });

  it('are listed newest first for HR and the employee only', async () => {
    const hr = await call('get', 'hr', `/employees/${emp()}/changes`);
    expect(hr.body.data.map((c: { type: string }) => c.type)).toEqual(['SALARY_REVISION', 'TRANSFER', 'TRANSFER', 'TRANSFER', 'PROMOTION']);
    expect((await call('get', 'employee', `/employees/${emp()}/changes`)).status).toBe(200);
    expect((await call('get', 'employee2', `/employees/${emp()}/changes`)).status).toBe(404);
    expect((await call('get', 'manager', `/employees/${emp()}/changes`)).status).toBe(404);
    expect((await call('get', 'otherHr', `/employees/${emp()}/changes`)).status).toBe(404);
  });

  it('terminated employees are read-only', async () => {
    await Employee.updateOne({ _id: t.people.employee2.employeeId, tenantId: t.tenantId }, { $set: { employmentStatus: 'TERMINATED' } });
    const r = await call('post', 'hr', `/employees/${t.people.employee2.employeeId}/changes`, { type: 'SALARY_REVISION', effectiveDate: '2024-09-01', reason: 'Late entry' });
    expect(r.status).toBe(409);
  });
});
