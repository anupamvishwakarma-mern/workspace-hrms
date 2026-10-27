import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Express } from 'express';
import S3rver from 's3rver';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/database/models/auditLog.model';
import { EmployeeDocument } from '../src/database/models/employeeDocument.model';
import { cleanupStaleUploads } from '../src/jobs/handlers';
import {
  bearer,
  createTenant,
  loginAs,
  startTestApp,
  stopTestApp,
  testEnv,
  type TestTenant,
} from './helpers';

let app: Express;
let t: TestTenant;
let beta: TestTenant;
let s3: S3rver;
let dir: string;
let env: ReturnType<typeof testEnv>;
const tok: Record<string, string> = {};
const call = (m: 'get' | 'post' | 'delete', who: string, path: string) =>
  request(app)[m](`/api/v1${path}`).set(bearer(tok[who]!));
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n');
const PORT = 4569 + Math.floor(Math.random() * 300);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 's3-'));
  s3 = new S3rver({
    port: PORT,
    address: '127.0.0.1',
    silent: true,
    directory: dir,
    configureBuckets: [{ name: 'docs', configs: [] }],
  });
  await s3.run();
  const storageEnv = {
    OBJECT_STORAGE_ENDPOINT: `http://127.0.0.1:${PORT}`,
    OBJECT_STORAGE_BUCKET: 'docs',
    OBJECT_STORAGE_ACCESS_KEY: 'S3RVER',
    OBJECT_STORAGE_SECRET_KEY: 'S3RVER',
  };
  ({ app, env } = await startTestApp(storageEnv));
  env = testEnv(storageEnv);
  t = await createTenant('acme');
  beta = await createTenant('beta');
  for (const k of Object.keys(t.people) as (keyof TestTenant['people'])[])
    tok[k] = await loginAs(app, t.people[k].email);
  tok.betaHr = await loginAs(app, beta.people.hr.email);
});
afterAll(async () => {
  await s3.close();
  rmSync(dir, { recursive: true, force: true });
  await stopTestApp();
});

const meta = (over: object = {}) => ({
  category: 'CONTRACT',
  title: 'Employment contract',
  fileName: 'contract.pdf',
  contentType: 'application/pdf',
  sizeBytes: PDF.length,
  ...over,
});
const empId = () => String(t.people.employee.employeeId);

async function uploadAndConfirm(over: object = {}, body: Buffer = PDF) {
  const start = await call('post', 'hr', `/employees/${empId()}/documents`).send(meta(over));
  expect(start.status).toBe(201);
  const put = await fetch(start.body.data.upload.url, {
    method: 'PUT',
    headers: start.body.data.upload.headers,
    body,
  });
  return { start, put, id: start.body.data.document.id as string };
}

describe('upload, confirm, download (real S3 protocol via a local server)', () => {
  it('HR uploads with a signed URL, confirms, and the employee can download only what is shared', async () => {
    const { put, id } = await uploadAndConfirm();
    expect(put.status).toBe(200);
    // not visible until confirmed
    expect((await call('get', 'hr', `/employees/${empId()}/documents`)).body.data).toHaveLength(0);
    const ok = await call('post', 'hr', `/employees/${empId()}/documents/${id}/confirm`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('AVAILABLE');
    expect(JSON.stringify(ok.body)).not.toMatch(/storageKey|tenants\//);

    const list = await call('get', 'employee', `/employees/${empId()}/documents`);
    expect(list.body.data).toHaveLength(1);
    const dl = await call('get', 'employee', `/employees/${empId()}/documents/${id}/download`);
    expect(dl.status).toBe(200);
    const file = await fetch(dl.body.data.url);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-disposition')).toMatch(/attachment; filename="contract\.pdf"/);
    expect(Buffer.from(await file.arrayBuffer()).equals(PDF)).toBe(true);
    expect(await AuditLog.countDocuments({ action: 'document.downloaded', entityId: id })).toBe(1);

    // hidden documents are invisible to the employee but not to HR
    const hidden = await uploadAndConfirm({ title: 'Internal note', visibleToEmployee: false });
    await call('post', 'hr', `/employees/${empId()}/documents/${hidden.id}/confirm`);
    expect(
      (await call('get', 'employee', `/employees/${empId()}/documents`)).body.data,
    ).toHaveLength(1);
    expect((await call('get', 'hr', `/employees/${empId()}/documents`)).body.data).toHaveLength(2);
    expect(
      (await call('get', 'employee', `/employees/${empId()}/documents/${hidden.id}/download`))
        .status,
    ).toBe(404);
  });

  it('enforces who may do what, per employee and per company', async () => {
    const { id } = await uploadAndConfirm();
    await call('post', 'hr', `/employees/${empId()}/documents/${id}/confirm`);
    const e2 = String(t.people.employee2.employeeId);
    // another employee, a manager, payroll: nothing
    for (const who of ['employee2', 'manager', 'payroll']) {
      expect((await call('get', who, `/employees/${empId()}/documents`)).status).toBe(404);
      expect(
        (await call('get', who, `/employees/${empId()}/documents/${id}/download`)).status,
      ).toBe(404);
    }
    // an employee cannot upload or delete, even their own
    expect(
      (await call('post', 'employee', `/employees/${empId()}/documents`).send(meta())).status,
    ).toBe(403);
    expect((await call('delete', 'employee', `/employees/${empId()}/documents/${id}`)).status).toBe(
      403,
    );
    // the document id cannot be reached through a different employee's path
    expect((await call('get', 'hr', `/employees/${e2}/documents/${id}/download`)).status).toBe(404);
    // another company: nothing, and cannot confirm/delete
    expect((await call('get', 'betaHr', `/employees/${empId()}/documents`)).status).toBe(404);
    expect((await call('delete', 'betaHr', `/employees/${empId()}/documents/${id}`)).status).toBe(
      404,
    );
    expect(
      (await call('post', 'betaHr', `/employees/${empId()}/documents/${id}/confirm`)).status,
    ).toBe(404);
  });

  it('validates type, size and unknown fields up front', async () => {
    const post = (b: object) => call('post', 'hr', `/employees/${empId()}/documents`).send(b);
    expect(
      (await post(meta({ contentType: 'application/x-msdownload', fileName: 'a.exe' }))).status,
    ).toBe(422);
    expect((await post(meta({ contentType: 'text/html' }))).status).toBe(422);
    expect((await post(meta({ sizeBytes: 11 * 1024 * 1024 }))).status).toBe(422);
    expect((await post(meta({ sizeBytes: 0 }))).status).toBe(422);
    expect((await post(meta({ category: 'NOPE' }))).status).toBe(422);
    expect((await post({ ...meta(), storageKey: 'x', tenantId: 'y' })).status).toBe(422);
    const ok = await post(meta({ fileName: '../../etc/passwd' }));
    expect(ok.status).toBe(201);
    expect(ok.body.data.document.fileName).not.toMatch(/[\\/]/);
    const doc = await EmployeeDocument.findById(ok.body.data.document.id).lean();
    expect(doc!.storageKey).not.toMatch(/passwd|\.\./);
    expect(doc!.storageKey.startsWith(`tenants/${t.tenantId}/employees/${empId()}/`)).toBe(true);
  });

  it('refuses uploads that do not match what was declared, and unfinished uploads', async () => {
    // Real S3/MinIO reject a PUT that breaks the signed Content-Length/Type; the local emulator may not,
    // so the server-side backstop is what we assert: confirm re-checks the stored object.
    const wrongSize = await uploadAndConfirm({}, Buffer.concat([PDF, Buffer.from('extra')]));
    if (wrongSize.put.status === 200) {
      const c = await call('post', 'hr', `/employees/${empId()}/documents/${wrongSize.id}/confirm`);
      expect(c.status).toBe(409);
      expect((await EmployeeDocument.findById(wrongSize.id).lean())!.status).toBe('DELETED');
      const { getStorage } = await import('../src/modules/documents/storage');
      const gone = await EmployeeDocument.findById(wrongSize.id).lean();
      expect(await getStorage(env)!.head(gone!.storageKey)).toBeNull();
    }
    const never = await call('post', 'hr', `/employees/${empId()}/documents`).send(meta());
    expect(
      (
        await call(
          'post',
          'hr',
          `/employees/${empId()}/documents/${never.body.data.document.id}/confirm`,
        )
      ).status,
    ).toBe(409);
    // wrong content type: either refused at upload, or caught at confirm
    const start = await call('post', 'hr', `/employees/${empId()}/documents`).send(meta());
    const bad = await fetch(start.body.data.upload.url, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/html' },
      body: PDF,
    });
    if (bad.status === 200) {
      expect(
        (
          await call(
            'post',
            'hr',
            `/employees/${empId()}/documents/${start.body.data.document.id}/confirm`,
          )
        ).status,
      ).toBe(409);
    }
  });

  it('deletes the file and the record is gone for everyone; stale uploads are cleaned up', async () => {
    const { id } = await uploadAndConfirm();
    await call('post', 'hr', `/employees/${empId()}/documents/${id}/confirm`);
    const doc = (await EmployeeDocument.findById(id).lean())!;
    expect((await call('delete', 'hr', `/employees/${empId()}/documents/${id}`)).status).toBe(204);
    expect((await call('get', 'hr', `/employees/${empId()}/documents/${id}/download`)).status).toBe(
      404,
    );
    expect((await call('delete', 'hr', `/employees/${empId()}/documents/${id}`)).status).toBe(404);
    // the object is really gone from storage
    const { getStorage } = await import('../src/modules/documents/storage');
    expect(await getStorage(env)!.head(doc.storageKey)).toBeNull();
    expect(await AuditLog.countDocuments({ action: 'document.deleted', entityId: id })).toBe(1);

    const stale = await call('post', 'hr', `/employees/${empId()}/documents`).send(meta());
    await EmployeeDocument.collection.updateOne(
      { _id: (await EmployeeDocument.findById(stale.body.data.document.id).lean())!._id },
      { $set: { createdAt: new Date(Date.now() - 3 * 3600_000) } },
    );
    const r = await cleanupStaleUploads(env, new Date());
    expect(r.removed).toBeGreaterThanOrEqual(1);
    expect((await EmployeeDocument.findById(stale.body.data.document.id).lean())!.status).toBe(
      'DELETED',
    );
  });
});

describe('storage not configured', () => {
  it('answers 503 instead of pretending', async () => {
    const { app: bare } = await startTestApp();
    const t2 = await createTenant('nostore');
    const hr = await loginAs(bare, t2.people.hr.email);
    const r = await request(bare)
      .post(`/api/v1/employees/${t2.people.employee.employeeId}/documents`)
      .set(bearer(hr))
      .send(meta());
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('STORAGE_NOT_CONFIGURED');
  });
});
