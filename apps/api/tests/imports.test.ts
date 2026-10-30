import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Tenant } from '../src/database/models/tenant.model';
import { User } from '../src/database/models/user.model';
import { bearer, createTenant, loginAs, startTestApp, stopTestApp, type TestTenant } from './helpers';

let app: Express;
let a: TestTenant;
const tok: Record<string, string> = {};
const post = (url: string, who: string, body: object) =>
  request(app).post(`/api/v1${url}`).set({ ...bearer(tok[who]!), 'X-Tenant-Id': String(a.tenantId) }).send(body);
const get = (url: string, who: string) =>
  request(app).get(`/api/v1${url}`).set({ ...bearer(tok[who]!), 'X-Tenant-Id': String(a.tenantId) });
const rows = (...data: Record<string, unknown>[]) => data.map((d, i) => ({ row: i + 2, data: d }));

beforeAll(async () => {
  ({ app } = await startTestApp());
  a = await createTenant('import-a');
  for (const r of ['owner', 'hr', 'manager', 'employee'] as const) tok[r] = await loginAs(app, a.people[r].email);
});
afterAll(stopTestApp);

describe('employee import', () => {
  const good = [
    { firstName: 'Ira', lastName: 'Bose', workEmail: 'ira@import.test', department: 'Design', designation: 'Designer', manager: 'lead@import.test', joiningDate: '2025-04-01' },
    { firstName: 'Leo', lastName: 'Das', workEmail: 'lead@import.test', department: 'design', role: 'MANAGER' },
    { firstName: '', lastName: 'Broken', workEmail: 'bad' },
  ];

  it('is closed to people without employee:create', async () => {
    expect((await post('/employees/import', 'employee', { rows: rows(good[0]!) })).status).toBe(403);
    expect((await post('/employees/import', 'manager', { rows: rows(good[0]!) })).status).toBe(403);
  });

  it('checks a file without writing anything (dry run is the default)', async () => {
    const r = await post('/employees/import', 'hr', { rows: rows(...good), createMissing: true });
    expect(r.status).toBe(200);
    expect(r.body.data.dryRun).toBe(true);
    expect(r.body.data.summary).toMatchObject({ total: 3, valid: 2, failed: 1, created: 0 });
    expect(r.body.data.summary.newDepartments).toEqual(['Design']);
    expect(r.body.data.rows[2].errors.join()).toContain('First name');
    expect((await get('/employees?search=ira@import.test', 'hr')).body.data).toHaveLength(0);
  });

  it('refuses unknown departments unless asked to create them', async () => {
    const r = await post('/employees/import', 'hr', { rows: rows(good[0]!), dryRun: false });
    expect(r.body.data.rows[0].errors.join()).toContain('Department "Design" does not exist');
    expect(r.body.data.summary.created).toBe(0);
  });

  it('creates the good rows, links managers inside the file, and reports the bad one', async () => {
    const r = await post('/employees/import', 'hr', { rows: rows(...good), createMissing: true, dryRun: false });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.summary).toMatchObject({ created: 2, failed: 1, departmentsCreated: 1, designationsCreated: 1 });
    expect(r.body.data.rows[0].status).toBe('CREATED');
    expect(r.body.data.rows[0].employeeCode).toMatch(/^EMP-/);
    const list = (await get('/employees?search=import.test', 'hr')).body.data;
    const ira = list.find((e: any) => e.workEmail === 'ira@import.test');
    const leo = list.find((e: any) => e.workEmail === 'lead@import.test');
    expect(ira.managerId).toBe(leo.id);
    expect(ira.employmentStatus).toBe('INVITED');
    expect(ira.designation).toBe('Designer');
    // the same file again changes nothing
    const again = await post('/employees/import', 'hr', { rows: rows(good[0]!), createMissing: true, dryRun: false });
    expect(again.body.data.summary.created).toBe(0);
    expect(again.body.data.rows[0].errors.join()).toContain('already exists');
  });

  it('catches repeats and manager loops inside the file', async () => {
    const r = await post('/employees/import', 'hr', {
      rows: rows(
        { firstName: 'A', lastName: 'One', workEmail: 'loop-a@import.test', manager: 'loop-b@import.test' },
        { firstName: 'B', lastName: 'Two', workEmail: 'loop-b@import.test', manager: 'loop-a@import.test' },
        { firstName: 'C', lastName: 'Three', workEmail: 'loop-a@import.test' },
      ),
    });
    const errs = r.body.data.rows.map((x: any) => x.errors.join());
    expect(errs[0]).toContain('loop');
    expect(errs[1]).toContain('loop');
    expect(errs[2]).toContain('Same work email as row 2');
  });

  it('sends invitations only when asked, and creates the login', async () => {
    const r = await post('/employees/import', 'hr', { rows: rows({ firstName: 'Nia', lastName: 'Roy', workEmail: 'nia@import.test' }), invite: true, dryRun: false });
    expect(r.body.data.summary).toMatchObject({ created: 1, invited: 1 });
    expect(await User.exists({ email: 'nia@import.test' })).toBeTruthy();
  });

  it('stops at the seat limit', async () => {
    const t = await Tenant.findById(a.tenantId).lean();
    const used = (await get('/employees?limit=100', 'hr')).body.meta.total;
    await Tenant.updateOne({ _id: a.tenantId }, { $set: { maxEmployees: used + 1 } });
    const r = await post('/employees/import', 'hr', { rows: rows({ firstName: 'S1', lastName: 'x', workEmail: 's1@import.test' }, { firstName: 'S2', lastName: 'x', workEmail: 's2@import.test' }), dryRun: false });
    expect(r.body.data.summary.created).toBe(1);
    expect(r.body.data.rows[1].errors.join()).toContain('seat limit');
    await Tenant.updateOne({ _id: a.tenantId }, { $set: { maxEmployees: t?.maxEmployees } });
  });

  it('rejects an empty or oversized file', async () => {
    expect((await post('/employees/import', 'hr', { rows: [] })).status).toBe(422);
    const many = Array.from({ length: 1001 }, (_, i) => ({ row: i + 2, data: { firstName: 'x' } }));
    expect((await post('/employees/import', 'hr', { rows: many })).status).toBe(422);
  });
});

describe('opening leave balance import', () => {
  it('needs leave:manage', async () => {
    expect((await post('/leave/balances/import', 'employee', { rows: rows({ employee: 'x', leaveType: 'CL', days: '1' }) })).status).toBe(403);
  });
  it('credits each person once per leave type and year', async () => {
    const emp = a.people.employee;
    const row = { employee: emp.email, leaveType: 'CL', days: '4.5', reason: 'Carried from the old system' };
    const dry = await post('/leave/balances/import', 'hr', { rows: rows(row, { employee: 'nobody@x.test', leaveType: 'CL', days: '1' }, { ...row, leaveType: 'ZZ' }) });
    expect(dry.body.data.summary).toMatchObject({ valid: 1, failed: 2, created: 0 });
    const real = await post('/leave/balances/import', 'hr', { rows: rows(row), dryRun: false });
    expect(real.body.data.summary.created).toBe(1);
    const again = await post('/leave/balances/import', 'hr', { rows: rows(row), dryRun: false });
    expect(again.body.data.summary.created).toBe(0);
    expect(again.body.data.rows[0].errors.join()).toContain('already imported');
  });
});

describe('attendance export formats', () => {
  const exp = (q: string) =>
    request(app).get(`/api/v1/reports/attendance/export?${q}`).set({ ...bearer(tok.hr!), 'X-Tenant-Id': String(a.tenantId) }).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  it('gives CSV by default and Excel on request', async () => {
    const csv = await exp('from=2026-01-05&to=2026-01-09&type=summary');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('.csv');
    const xlsx = await exp('from=2026-01-05&to=2026-01-09&type=summary&format=xlsx');
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml.sheet');
    expect(xlsx.headers['content-disposition']).toContain('.xlsx');
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK'); // an .xlsx is a zip file
    expect((await exp('from=2026-01-05&to=2026-01-09&format=pdf')).status).toBe(422);
  });
});
