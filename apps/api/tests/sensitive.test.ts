import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/database/models/auditLog.model';
import { Employee } from '../src/database/models/employee.model';
import { EmployeeSensitive } from '../src/database/models/employeeSensitive.model';
import {
  bearer,
  createTenant,
  loginAs,
  startTestApp,
  stopTestApp,
  type TestTenant,
} from './helpers';

let app: Express;
let a: TestTenant;
let b: TestTenant;
const tok: Record<string, string> = {};
const h = (role: string, t: TestTenant = a) => ({
  ...bearer(tok[`${t === a ? 'a' : 'b'}-${role}`]!),
  'X-Tenant-Id': String(t.tenantId),
});
const put = (role: string, id: unknown, body: Record<string, unknown>, t = a) =>
  request(app)
    .put(`/api/v1/employees/${String(id)}/sensitive`)
    .set(h(role, t))
    .send(body);
const get = (role: string, id: unknown, qs = '', t = a) =>
  request(app)
    .get(`/api/v1/employees/${String(id)}/sensitive${qs}`)
    .set(h(role, t));

const DETAILS = {
  accountHolder: 'Asha Rao',
  bankName: 'Test Bank',
  ifsc: 'abcd0123456',
  accountNumber: '123456789012',
  pan: 'abcde1234f',
  aadhaar: '1234 5678 9012',
};

beforeAll(async () => {
  ({ app } = await startTestApp());
  a = await createTenant('sens-a');
  b = await createTenant('sens-b');
  for (const r of ['owner', 'hr', 'manager', 'employee', 'employee2', 'payroll'] as const)
    tok[`a-${r}`] = await loginAs(app, a.people[r].email);
  tok['b-owner'] = await loginAs(app, b.people.owner.email);
});
afterAll(stopTestApp);

describe('bank and statutory details', () => {
  const emp = () => a.people.employee.employeeId;

  it('HR saves details; only people with the permission may write', async () => {
    for (const r of ['employee', 'manager', 'payroll'])
      expect((await put(r, emp(), DETAILS)).status).toBe(403);
    const r = await put('hr', emp(), DETAILS);
    expect(r.status).toBe(200);
    expect(r.body.data.bank.accountNumber).toBe('XXXXXXXX9012');
    expect(r.body.data.statutory.pan).toBe('XXXXXX234F');
    expect(r.body.data.statutory.aadhaar).toBe('XXXXXXXX9012');
    expect(r.body.data.bank.ifsc).toBe('ABCD0123456');
    expect(JSON.stringify(r.body)).not.toContain('123456789012');
  });

  it('stores identifiers encrypted, never in plain text', async () => {
    const row = await EmployeeSensitive.findOne({ tenantId: a.tenantId, employeeId: emp() }).lean();
    const raw = JSON.stringify(row);
    expect(raw).not.toContain('123456789012');
    expect(raw).not.toContain('ABCDE1234F');
    expect(row!.panEnc!.startsWith('v1.')).toBe(true);
  });

  it('rejects malformed values and unknown fields', async () => {
    expect((await put('hr', emp(), { pan: 'nope' })).status).toBe(422);
    expect((await put('hr', emp(), { aadhaar: '123' })).status).toBe(422);
    expect((await put('hr', emp(), { ifsc: 'X' })).status).toBe(422);
    expect((await put('hr', emp(), {})).status).toBe(422);
    expect((await put('hr', emp(), { salary: 1 })).status).toBe(422);
  });

  it('who can read: the employee, HR and owner (masked); not peers, managers or payroll', async () => {
    for (const r of ['employee', 'hr', 'owner']) {
      const g = await get(r, emp());
      expect(g.status).toBe(200);
      expect(g.body.data.statutory.pan).toBe('XXXXXX234F');
    }
    for (const r of ['employee2', 'manager', 'payroll'])
      expect((await get(r, emp())).status).toBe(404);
  });

  it('reveal returns full values and is audited without the values', async () => {
    const before = await AuditLog.countDocuments({
      tenantId: a.tenantId,
      action: 'employee.sensitive_revealed',
    });
    const g = await get('hr', emp(), '?reveal=true');
    expect(g.body.data.statutory.pan).toBe('ABCDE1234F');
    expect(g.body.data.bank.accountNumber).toBe('123456789012');
    // a plain employee can reveal only their own
    expect((await get('employee', emp(), '?reveal=true')).body.data.statutory.aadhaar).toBe(
      '123456789012',
    );
    expect((await get('employee2', emp(), '?reveal=true')).status).toBe(404);
    const logs = await AuditLog.find({
      tenantId: a.tenantId,
      action: 'employee.sensitive_revealed',
    }).lean();
    expect(logs.length).toBe(before + 2);
    expect(JSON.stringify(logs)).not.toContain('ABCDE1234F');
    expect(JSON.stringify(logs)).not.toContain('123456789012');
  });

  it('a plain read is not audited as a reveal', async () => {
    const before = await AuditLog.countDocuments({ action: 'employee.sensitive_revealed' });
    await get('hr', emp());
    expect(await AuditLog.countDocuments({ action: 'employee.sensitive_revealed' })).toBe(before);
  });

  it('records which fields changed (not values) in audit and history; null clears a field', async () => {
    const r = await put('owner', emp(), { pan: null, branch: 'Main' });
    expect(r.status).toBe(200);
    expect(r.body.data.statutory.pan).toBeUndefined();
    expect(r.body.data.bank.branch).toBe('Main');
    const log = await AuditLog.findOne({
      tenantId: a.tenantId,
      action: 'employee.sensitive_updated',
    })
      .sort({ createdAt: -1 })
      .lean();
    expect(JSON.stringify(log)).toContain('changedFields');
    expect(JSON.stringify(log)).not.toContain('ABCDE1234F');
    const e = await Employee.findOne({ _id: emp(), tenantId: a.tenantId }).lean();
    expect(e!.history.some((x) => x.type === 'SENSITIVE_UPDATE')).toBe(true);
  });

  it('nobody can change their own details, even HR or the owner', async () => {
    expect((await put('hr', a.people.hr.employeeId, { pan: 'ABCDE1234F' })).status).toBe(403);
    expect((await put('owner', a.people.owner.employeeId, { pan: 'ABCDE1234F' })).status).toBe(403);
    expect((await put('owner', a.people.hr.employeeId, { pan: 'ABCDE1234F' })).status).toBe(200);
  });

  it('never leaks through the ordinary employee endpoints', async () => {
    for (const role of ['hr', 'owner']) {
      const one = await request(app)
        .get(`/api/v1/employees/${String(emp())}`)
        .set(h(role));
      const list = await request(app).get('/api/v1/employees?limit=100').set(h(role));
      for (const body of [one.text, list.text]) {
        expect(body).not.toContain('ABCDE1234F');
        expect(body).not.toContain('123456789012');
        expect(body).not.toMatch(/Enc"/);
      }
    }
  });

  it("another company cannot read or write this company's details", async () => {
    expect((await get('owner', emp(), '', b)).status).toBe(404);
    expect((await get('owner', emp(), '?reveal=true', b)).status).toBe(404);
    expect((await put('owner', emp(), { pan: 'ABCDE1234F' }, b)).status).toBe(404);
  });
});
