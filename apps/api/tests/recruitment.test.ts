import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/database/models/auditLog.model';
import { Employee } from '../src/database/models/employee.model';
import { bearer, createTenant, loginAs, startTestApp, stopTestApp, type TestTenant } from './helpers';

let app: Express;
let t: TestTenant;
let other: TestTenant;
const tok: Record<string, string> = {};
const call = (m: 'get' | 'post' | 'patch' | 'put', who: string, path: string, body?: object) => {
  const r = request(app)[m](`/api/v1${path}`).set(bearer(tok[who]!));
  return body ? r.send(body) : r;
};
let jobId = '';
const mkCandidate = async (email: string, first = 'Asha') => {
  const r = await call('post', 'hr', '/recruitment/candidates', { jobId, firstName: first, lastName: 'Test', email });
  expect(r.status).toBe(201);
  return String(r.body.data.id);
};
const toStage = async (id: string, stages: string[]) => {
  for (const stage of stages) expect((await call('post', 'hr', `/recruitment/candidates/${id}/stage`, { stage })).status).toBe(200);
};

beforeAll(async () => {
  ({ app } = await startTestApp());
  t = await createTenant('recruit');
  other = await createTenant('recruit-other');
  for (const k of ['owner', 'hr', 'manager', 'employee'] as const) tok[k] = await loginAs(app, t.people[k].email);
  tok.otherHr = await loginAs(app, other.people.hr.email);
});
afterAll(stopTestApp);

describe('jobs', () => {
  it('only recruitment managers can use them', async () => {
    expect((await call('get', 'employee', '/recruitment/jobs')).status).toBe(403);
    expect((await call('get', 'manager', '/recruitment/jobs')).status).toBe(403);
    expect((await call('post', 'manager', '/recruitment/jobs', { title: 'X' })).status).toBe(403);
    expect((await call('get', 'hr', '/recruitment/jobs')).status).toBe(200);
  });

  it('start as draft, take candidates only when open, and need a reason to close', async () => {
    const j = await call('post', 'hr', '/recruitment/jobs', { title: 'Engineer', headcount: 1 });
    expect(j.status).toBe(201);
    jobId = String(j.body.data.id);
    expect(j.body.data.status).toBe('DRAFT');
    const early = await call('post', 'hr', '/recruitment/candidates', { jobId, firstName: 'A', lastName: 'B', email: 'a@x.test' });
    expect(early.status).toBe(409);
    expect((await call('patch', 'hr', `/recruitment/jobs/${jobId}`, { status: 'OPEN' })).body.data.status).toBe('OPEN');
    expect((await call('patch', 'hr', `/recruitment/jobs/${jobId}`, { status: 'DRAFT' })).status).toBe(422);
    const bad = await call('post', 'hr', '/recruitment/jobs', { title: 'Y', departmentId: '0'.repeat(24) });
    expect(bad.status).toBe(422);
  });

  it('are invisible to another company', async () => {
    expect((await call('get', 'otherHr', '/recruitment/jobs')).body.data).toEqual([]);
    expect((await call('patch', 'otherHr', `/recruitment/jobs/${jobId}`, { title: 'Hijack' })).status).toBe(404);
  });
});

describe('pipeline', () => {
  let c1 = '';
  it('rejects duplicate applications and illegal stage jumps', async () => {
    c1 = await mkCandidate('Asha@Example.test');
    const dup = await call('post', 'hr', '/recruitment/candidates', { jobId, firstName: 'A', lastName: 'B', email: 'asha@example.test' });
    expect(dup.status).toBe(409);
    expect((await call('post', 'hr', `/recruitment/candidates/${c1}/stage`, { stage: 'OFFER' })).status).toBe(409);
    expect((await call('post', 'hr', `/recruitment/candidates/${c1}/stage`, { stage: 'HIRED' })).status).toBe(409);
    expect((await call('post', 'hr', `/recruitment/candidates/${c1}/stage`, { stage: 'REJECTED' })).status).toBe(422);
    expect((await call('get', 'otherHr', `/recruitment/candidates/${c1}`)).status).toBe(404);
  });

  it('records stage history and notes', async () => {
    await toStage(c1, ['SCREENING']);
    await call('post', 'hr', `/recruitment/candidates/${c1}/notes`, { text: 'Strong CV' });
    const d = (await call('get', 'hr', `/recruitment/candidates/${c1}`)).body.data;
    expect(d.stageHistory.map((h: { to: string }) => h.to)).toEqual(['APPLIED', 'SCREENING']);
    expect(d.notes[0].text).toBe('Strong CV');
  });

  it('a rejected candidate is final', async () => {
    const id = await mkCandidate('rej@example.test', 'Rita');
    expect((await call('post', 'hr', `/recruitment/candidates/${id}/stage`, { stage: 'REJECTED', reason: 'Not a fit' })).status).toBe(200);
    expect((await call('post', 'hr', `/recruitment/candidates/${id}/stage`, { stage: 'SCREENING' })).status).toBe(409);
  });

  describe('interviews', () => {
    let interviewId = '';
    it('are scheduled only in the interview stage, with a working employee as interviewer', async () => {
      const body = { scheduledAt: '2026-12-01T10:00:00.000Z', interviewerId: String(t.people.manager.employeeId), round: 'Technical' };
      expect((await call('post', 'hr', `/recruitment/candidates/${c1}/interviews`, body)).status).toBe(409);
      await toStage(c1, ['INTERVIEW']);
      expect((await call('post', 'hr', `/recruitment/candidates/${c1}/interviews`, { ...body, interviewerId: '0'.repeat(24) })).status).toBe(422);
      const r = await call('post', 'hr', `/recruitment/candidates/${c1}/interviews`, body);
      expect(r.status).toBe(201);
      interviewId = String(r.body.data.interviews[0].id);
    });

    it('the interviewer sees only their own, without contact details', async () => {
      const mine = await call('get', 'manager', '/recruitment/my-interviews');
      expect(mine.status).toBe(200);
      expect(mine.body.data).toHaveLength(1);
      expect(mine.body.data[0]).toMatchObject({ candidateName: 'Asha Test', jobTitle: 'Engineer', feedbackSubmitted: false });
      expect(JSON.stringify(mine.body)).not.toContain('example.test');
      expect((await call('get', 'employee', '/recruitment/my-interviews')).status).toBe(403);
      expect((await call('get', 'hr', '/recruitment/my-interviews')).body.data).toEqual([]);
    });

    it('feedback comes only from the assigned interviewer, once', async () => {
      const fb = { rating: 4, recommendation: 'YES', comment: 'Good' };
      const path = `/recruitment/candidates/${c1}/interviews/${interviewId}/feedback`;
      expect((await call('post', 'hr', path, fb)).status).toBe(404);
      expect((await call('post', 'employee', path, fb)).status).toBe(403);
      expect((await call('post', 'manager', path, { ...fb, rating: 9 })).status).toBe(422);
      expect((await call('post', 'manager', path, fb)).status).toBe(200);
      expect((await call('post', 'manager', path, fb)).status).toBe(409);
      const d = (await call('get', 'hr', `/recruitment/candidates/${c1}`)).body.data;
      expect(d.interviews[0].feedback).toMatchObject({ rating: 4, recommendation: 'YES' });
    });
  });

  describe('offer and hire', () => {
    it('needs the offer stage, then an accepted offer, then creates one employee', async () => {
      const hire = { workEmail: 'asha.work@example.test', joiningDate: '2026-12-15' };
      expect((await call('put', 'hr', `/recruitment/candidates/${c1}/offer`, {})).status).toBe(409);
      await toStage(c1, ['OFFER']);
      expect((await call('post', 'hr', `/recruitment/candidates/${c1}/hire`, hire)).status).toBe(409);
      expect((await call('put', 'hr', `/recruitment/candidates/${c1}/offer`, { proposedJoiningDate: '2026-12-15', note: 'Offer' })).status).toBe(200);
      expect((await call('post', 'hr', `/recruitment/candidates/${c1}/hire`, hire)).status).toBe(409);
      expect((await call('post', 'hr', `/recruitment/candidates/${c1}/offer/decision`, { decision: 'ACCEPTED' })).status).toBe(200);
      expect((await call('put', 'hr', `/recruitment/candidates/${c1}/offer`, {})).status).toBe(409);

      const h = await call('post', 'hr', `/recruitment/candidates/${c1}/hire`, hire);
      expect(h.status).toBe(201);
      const emp = await Employee.findOne({ _id: h.body.data.employeeId, tenantId: t.tenantId }).lean();
      expect(emp).toMatchObject({ firstName: 'Asha', employmentStatus: 'INVITED', workEmail: 'asha.work@example.test', personalEmail: 'asha@example.test' });
      expect((await call('get', 'hr', `/recruitment/candidates/${c1}`)).body.data.stage).toBe('HIRED');
      expect((await call('post', 'hr', `/recruitment/candidates/${c1}/hire`, { ...hire, workEmail: 'again@example.test' })).status).toBe(409);
      expect(await Employee.countDocuments({ tenantId: t.tenantId, personalEmail: 'asha@example.test' })).toBe(1);
      expect(await AuditLog.countDocuments({ tenantId: t.tenantId, action: 'recruitment.hired' })).toBe(1);
      expect((await call('get', 'hr', '/recruitment/jobs')).body.data[0].hired).toBe(1);
    });

    it('stops hiring beyond the job headcount, and a duplicate work email leaves nothing half-done', async () => {
      const id = await mkCandidate('second@example.test', 'Sam');
      await toStage(id, ['SCREENING', 'INTERVIEW', 'OFFER']);
      await call('put', 'hr', `/recruitment/candidates/${id}/offer`, {});
      await call('post', 'hr', `/recruitment/candidates/${id}/offer/decision`, { decision: 'ACCEPTED' });
      expect((await call('post', 'hr', `/recruitment/candidates/${id}/hire`, { workEmail: 'sam@example.test', joiningDate: '2026-12-20' })).status).toBe(409);
      await call('patch', 'hr', `/recruitment/jobs/${jobId}`, { headcount: 2 });
      const dup = await call('post', 'hr', `/recruitment/candidates/${id}/hire`, { workEmail: 'asha.work@example.test', joiningDate: '2026-12-20' });
      expect(dup.status).toBe(409);
      const ok = await call('post', 'hr', `/recruitment/candidates/${id}/hire`, { workEmail: 'sam@example.test', joiningDate: '2026-12-20' });
      expect(ok.status).toBe(201);
    });

    it('a declined offer withdraws the candidate', async () => {
      const id = await mkCandidate('decline@example.test', 'Dee');
      await toStage(id, ['SCREENING', 'INTERVIEW', 'OFFER']);
      await call('put', 'hr', `/recruitment/candidates/${id}/offer`, {});
      expect((await call('post', 'hr', `/recruitment/candidates/${id}/offer/decision`, { decision: 'DECLINED' })).body.data.stage).toBe('WITHDRAWN');
    });
  });
});
