import type { Router } from 'express';
import type { Types } from 'mongoose';
import { z } from 'zod';
import type { Env } from '../../config/env';
import {
  CANDIDATE_STAGES,
  Candidate,
  JOB_STATUSES,
  JobOpening,
  OFFER_STATUSES,
  RECOMMENDATIONS,
} from '../../database/models/recruitment.model';
import { Employee, EMPLOYMENT_TYPES } from '../../database/models/employee.model';
import { authenticate, requirePermission, resolveTenant } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/errors';
import { rethrowDuplicate } from '../../utils/mongo';
import { route } from '../../utils/route';
import { escapeRegex, idParams, objectId, paginationQuery, validate } from '../../utils/validate';
import { WORK_DATE_RE, isRealDate } from '../attendance/dates';
import { writeAudit } from '../audit/audit.service';
import { Department } from '../../database/models/department.model';
import { Designation } from '../../database/models/designation.model';
import * as employees from '../employees/employees.service';

const date = z.string().regex(WORK_DATE_RE, 'Use YYYY-MM-DD').refine(isRealDate, 'Invalid date');
const email = z
  .string()
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());

const jobBody = z
  .object({
    title: z.string().trim().min(1).max(120),
    departmentId: objectId,
    designationId: objectId,
    hiringManagerId: objectId,
    employmentType: z.enum(EMPLOYMENT_TYPES),
    headcount: z.number().int().min(1).max(1000),
    description: z.string().max(5000),
  })
  .partial()
  .required({ title: true })
  .strict();
const jobPatch = z
  .object({
    title: z.string().trim().min(1).max(120),
    departmentId: objectId,
    designationId: objectId,
    hiringManagerId: objectId,
    employmentType: z.enum(EMPLOYMENT_TYPES),
    headcount: z.number().int().min(1).max(1000),
    description: z.string().max(5000),
    status: z.enum(JOB_STATUSES),
    closeReason: z.string().trim().max(300),
  })
  .partial()
  .strict();
const jobList = z
  .object({ ...paginationQuery, status: z.enum(JOB_STATUSES).optional() })
  .strict();

const candBody = z
  .object({
    jobId: objectId,
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    email,
    phone: z.string().trim().max(30).optional(),
    source: z.string().trim().max(60).optional(),
  })
  .strict();
const candPatch = candBody.omit({ jobId: true }).partial().strict();
const candList = z
  .object({
    ...paginationQuery,
    jobId: objectId.optional(),
    stage: z.enum(CANDIDATE_STAGES).optional(),
    search: z.string().trim().max(100).optional(),
  })
  .strict();
const stageBody = z
  .object({ stage: z.enum(CANDIDATE_STAGES), reason: z.string().trim().min(1).max(300).optional() })
  .strict();
const noteBody = z.object({ text: z.string().trim().min(1).max(2000) }).strict();
const interviewBody = z
  .object({
    scheduledAt: z.coerce.date(),
    interviewerId: objectId,
    mode: z.enum(['IN_PERSON', 'VIDEO', 'PHONE']).optional(),
    round: z.string().trim().max(60).optional(),
  })
  .strict();
const feedbackBody = z
  .object({
    rating: z.number().int().min(1).max(5),
    recommendation: z.enum(RECOMMENDATIONS),
    comment: z.string().trim().max(2000).optional(),
  })
  .strict();
const offerBody = z
  .object({
    designationId: objectId.optional(),
    proposedJoiningDate: date.optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();
const decisionBody = z.object({ decision: z.enum(['ACCEPTED', 'DECLINED']) }).strict();
const hireBody = z
  .object({
    workEmail: email,
    joiningDate: date,
    employeeCode: z.string().trim().min(1).max(40).optional(),
    managerId: objectId.optional(),
  })
  .strict();
const interviewParams = z.object({ id: objectId, interviewId: objectId }).strict();

/** Where a candidate may move from each stage. HIRED is reached only through the hire endpoint. */
const NEXT: Record<string, string[]> = {
  APPLIED: ['SCREENING', 'REJECTED', 'WITHDRAWN'],
  SCREENING: ['INTERVIEW', 'REJECTED', 'WITHDRAWN'],
  INTERVIEW: ['OFFER', 'REJECTED', 'WITHDRAWN'],
  OFFER: ['REJECTED', 'WITHDRAWN'],
  HIRED: [],
  REJECTED: [],
  WITHDRAWN: [],
};

type Doc = Record<string, any>;
const serJob = (j: Doc, hired?: number) => ({
  id: String(j._id),
  title: j.title,
  departmentId: j.departmentId ? String(j.departmentId) : undefined,
  designationId: j.designationId ? String(j.designationId) : undefined,
  hiringManagerId: j.hiringManagerId ? String(j.hiringManagerId) : undefined,
  employmentType: j.employmentType,
  headcount: j.headcount,
  description: j.description,
  status: j.status,
  openedAt: j.openedAt,
  closedAt: j.closedAt,
  closeReason: j.closeReason,
  ...(hired === undefined ? {} : { hired }),
  createdAt: j.createdAt,
});
const serInterview = (i: Doc, withFeedback = true) => ({
  id: String(i._id),
  scheduledAt: i.scheduledAt,
  interviewerId: String(i.interviewerId),
  mode: i.mode,
  round: i.round,
  feedbackSubmitted: !!i.feedback?.submittedAt,
  ...(withFeedback && i.feedback?.submittedAt ? { feedback: i.feedback } : {}),
});
const serCandidate = (c: Doc, full = true) => ({
  id: String(c._id),
  jobId: String(c.jobId),
  firstName: c.firstName,
  lastName: c.lastName,
  email: c.email,
  phone: c.phone,
  source: c.source,
  stage: c.stage,
  rejectionReason: c.rejectionReason,
  offer: c.offer ?? undefined,
  hiredEmployeeId: c.hiredEmployeeId ? String(c.hiredEmployeeId) : undefined,
  createdAt: c.createdAt,
  ...(full
    ? {
        stageHistory: c.stageHistory ?? [],
        notes: c.notes ?? [],
        interviews: (c.interviews ?? []).map((i: Doc) => serInterview(i)),
      }
    : {}),
});
const DUP = 'This person has already applied for this job';

export function registerRecruitmentRoutes(v1: Router, env: Env): void {
  const chain = [authenticate(env), resolveTenant];
  const MANAGE = 'recruitment:manage' as const;

  async function assertRefs(tenantId: Types.ObjectId, b: Doc) {
    if (b.departmentId && !(await Department.exists({ _id: b.departmentId, tenantId })))
      throw AppError.unprocessable('Department not found');
    if (b.designationId && !(await Designation.exists({ _id: b.designationId, tenantId })))
      throw AppError.unprocessable('Designation not found');
    if (
      b.hiringManagerId &&
      !(await Employee.exists({
        _id: b.hiringManagerId,
        tenantId,
        employmentStatus: { $in: ['ACTIVE', 'ON_LEAVE', 'NOTICE_PERIOD'] },
      }))
    )
      throw AppError.unprocessable('Hiring manager not found or not working');
  }
  const getCandidate = async (tenantId: Types.ObjectId, id: string) => {
    const c = await Candidate.findOne({ _id: id, tenantId });
    if (!c) throw AppError.notFound('Candidate not found');
    return c;
  };
  const hiredCount = (tenantId: Types.ObjectId, jobId: unknown) =>
    Candidate.countDocuments({ tenantId, jobId, stage: 'HIRED' });

  /* ------------------------------- jobs ------------------------------- */
  route(
    v1,
    { method: 'get', path: '/recruitment/jobs', summary: 'List job openings.', tags: ['Recruitment'], auth: 'tenant', permission: MANAGE, query: jobList },
    ...chain,
    requirePermission(MANAGE),
    validate({ query: jobList }),
    asyncHandler(async (req, res) => {
      const q = req.query as unknown as z.infer<typeof jobList>;
      const tenantId = req.tenantCtx!.tenantId;
      const filter = { tenantId, ...(q.status ? { status: q.status } : {}) };
      const [items, total] = await Promise.all([
        JobOpening.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
        JobOpening.countDocuments(filter),
      ]);
      const counts = await Candidate.aggregate([
        { $match: { tenantId, stage: 'HIRED', jobId: { $in: items.map((j) => j._id) } } },
        { $group: { _id: '$jobId', n: { $sum: 1 } } },
      ]);
      const hired = new Map(counts.map((c) => [String(c._id), c.n as number]));
      res.json({
        success: true,
        data: items.map((j) => serJob(j, hired.get(String(j._id)) ?? 0)),
        meta: { page: q.page, limit: q.limit, total },
      });
    }),
  );

  route(
    v1,
    { method: 'post', path: '/recruitment/jobs', summary: 'Create a job opening (starts as DRAFT).', tags: ['Recruitment'], auth: 'tenant', permission: MANAGE, body: jobBody, successStatus: 201 },
    ...chain,
    requirePermission(MANAGE),
    validate({ body: jobBody }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      await assertRefs(tenantId, req.body);
      const doc = await JobOpening.create({ ...req.body, tenantId, createdBy: req.auth!.userId });
      await writeAudit(req, { action: 'recruitment.job_create', entityType: 'JobOpening', entityId: doc._id, after: doc });
      res.status(201).json({ success: true, data: serJob(doc.toObject(), 0) });
    }),
  );

  route(
    v1,
    { method: 'patch', path: '/recruitment/jobs/:id', summary: 'Edit a job opening, open it (DRAFT/CLOSED to OPEN) or close it (a reason is required).', tags: ['Recruitment'], auth: 'tenant', permission: MANAGE, body: jobPatch },
    ...chain,
    requirePermission(MANAGE),
    validate({ params: idParams, body: jobPatch }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      const b = req.body as z.infer<typeof jobPatch>;
      const before = await JobOpening.findOne({ _id: req.params.id, tenantId }).lean();
      if (!before) throw AppError.notFound('Job not found');
      await assertRefs(tenantId, b);
      const $set: Doc = { ...b };
      if (b.status && b.status !== before.status) {
        if (b.status === 'DRAFT') throw AppError.unprocessable('A job cannot go back to draft');
        if (b.status === 'OPEN') {
          $set.openedAt = before.openedAt ?? new Date();
          $set.closedAt = undefined;
        }
        if (b.status === 'CLOSED') {
          if (!b.closeReason) throw AppError.unprocessable('Give a reason for closing the job');
          $set.closedAt = new Date();
        }
      }
      if (b.headcount !== undefined && b.headcount < (await hiredCount(tenantId, before._id)))
        throw AppError.unprocessable('Headcount cannot be lower than the number already hired');
      const after = await JobOpening.findOneAndUpdate({ _id: before._id, tenantId }, { $set }, { new: true }).lean();
      await writeAudit(req, { action: 'recruitment.job_update', entityType: 'JobOpening', entityId: before._id, before, after });
      res.json({ success: true, data: serJob(after!, await hiredCount(tenantId, before._id)) });
    }),
  );

  /* ---------------------------- candidates ---------------------------- */
  route(
    v1,
    { method: 'get', path: '/recruitment/candidates', summary: 'List candidates (filter by job, stage, name or email).', tags: ['Recruitment'], auth: 'tenant', permission: MANAGE, query: candList },
    ...chain,
    requirePermission(MANAGE),
    validate({ query: candList }),
    asyncHandler(async (req, res) => {
      const q = req.query as unknown as z.infer<typeof candList>;
      const tenantId = req.tenantCtx!.tenantId;
      const rx = q.search ? new RegExp(escapeRegex(q.search), 'i') : undefined;
      const filter = {
        tenantId,
        ...(q.jobId ? { jobId: q.jobId } : {}),
        ...(q.stage ? { stage: q.stage } : {}),
        ...(rx ? { $or: [{ firstName: rx }, { lastName: rx }, { email: rx }] } : {}),
      };
      const [items, total] = await Promise.all([
        Candidate.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
        Candidate.countDocuments(filter),
      ]);
      res.json({ success: true, data: items.map((c) => serCandidate(c, false)), meta: { page: q.page, limit: q.limit, total } });
    }),
  );

  route(
    v1,
    { method: 'post', path: '/recruitment/candidates', summary: 'Add a candidate to an OPEN job. The same email cannot apply twice for one job.', tags: ['Recruitment'], auth: 'tenant', permission: MANAGE, body: candBody, successStatus: 201 },
    ...chain,
    requirePermission(MANAGE),
    validate({ body: candBody }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      const job = await JobOpening.findOne({ _id: req.body.jobId, tenantId }).lean();
      if (!job) throw AppError.unprocessable('Job not found');
      if (job.status !== 'OPEN') throw AppError.conflict('Candidates can only be added to an open job');
      const doc = await Candidate.create({
        ...req.body,
        tenantId,
        createdBy: req.auth!.userId,
        stageHistory: [{ from: null, to: 'APPLIED', at: new Date(), byUserId: req.auth!.userId }],
      }).catch((e) => rethrowDuplicate(e, DUP));
      await writeAudit(req, { action: 'recruitment.candidate_create', entityType: 'Candidate', entityId: doc._id, after: { jobId: doc.jobId } });
      res.status(201).json({ success: true, data: serCandidate(doc.toObject()) });
    }),
  );

  route(
    v1,
    { method: 'get', path: '/recruitment/candidates/:id', summary: 'One candidate with history, notes and interviews.', tags: ['Recruitment'], auth: 'tenant', permission: MANAGE },
    ...chain,
    requirePermission(MANAGE),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const c = await getCandidate(req.tenantCtx!.tenantId, String(req.params.id));
      res.json({ success: true, data: serCandidate(c.toObject()) });
    }),
  );

  route(
    v1,
    { method: 'patch', path: '/recruitment/candidates/:id', summary: 'Correct a candidate\'s contact details.', tags: ['Recruitment'], auth: 'tenant', permission: MANAGE, body: candPatch },
    ...chain,
    requirePermission(MANAGE),
    validate({ params: idParams, body: candPatch }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      const before = await getCandidate(tenantId, String(req.params.id));
      if (before.stage === 'HIRED') throw AppError.conflict('A hired candidate is read-only');
      if (Object.keys(req.body).length === 0) throw AppError.badRequest('Nothing to change');
      const after = await Candidate.findOneAndUpdate({ _id: before._id, tenantId }, { $set: req.body }, { new: true })
        .lean()
        .catch((e) => rethrowDuplicate(e, DUP));
      await writeAudit(req, { action: 'recruitment.candidate_update', entityType: 'Candidate', entityId: before._id, after: { fields: Object.keys(req.body) } });
      res.json({ success: true, data: serCandidate(after!) });
    }),
  );

  route(
    v1,
    { method: 'post', path: '/recruitment/candidates/:id/stage', summary: 'Move a candidate forward, or reject or withdraw them (rejection needs a reason). Hiring is a separate step.', tags: ['Recruitment'], auth: 'tenant', permission: MANAGE, body: stageBody },
    ...chain,
    requirePermission(MANAGE),
    validate({ params: idParams, body: stageBody }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      const { stage, reason } = req.body as z.infer<typeof stageBody>;
      const c = await getCandidate(tenantId, String(req.params.id));
      if (!NEXT[c.stage]!.includes(stage))
        throw AppError.conflict(`A candidate in ${c.stage} cannot move to ${stage}`);
      if (stage === 'REJECTED' && !reason) throw AppError.unprocessable('Give a reason for rejecting');
      const after = await Candidate.findOneAndUpdate(
        { _id: c._id, tenantId, stage: c.stage },
        {
          $set: { stage, ...(stage === 'REJECTED' ? { rejectionReason: reason } : {}) },
          $push: { stageHistory: { from: c.stage, to: stage, at: new Date(), byUserId: req.auth!.userId, reason } },
        },
        { new: true },
      ).lean();
      if (!after) throw AppError.conflict('The candidate was changed by someone else; reload and retry');
      await writeAudit(req, { action: 'recruitment.candidate_stage', entityType: 'Candidate', entityId: c._id, before: { stage: c.stage }, after: { stage }, reason });
      res.json({ success: true, data: serCandidate(after) });
    }),
  );

  route(
    v1,
    { method: 'post', path: '/recruitment/candidates/:id/notes', summary: 'Add an internal note.', tags: ['Recruitment'], auth: 'tenant', permission: MANAGE, body: noteBody, successStatus: 201 },
    ...chain,
    requirePermission(MANAGE),
    validate({ params: idParams, body: noteBody }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      const after = await Candidate.findOneAndUpdate(
        { _id: req.params.id, tenantId },
        { $push: { notes: { text: req.body.text, byUserId: req.auth!.userId, at: new Date() } } },
        { new: true },
      ).lean();
      if (!after) throw AppError.notFound('Candidate not found');
      res.status(201).json({ success: true, data: serCandidate(after) });
    }),
  );

  /* ----------------------------- interviews ----------------------------- */
  route(
    v1,
    { method: 'post', path: '/recruitment/candidates/:id/interviews', summary: 'Schedule an interview with an employee as interviewer (candidate must be in INTERVIEW).', tags: ['Recruitment'], auth: 'tenant', permission: MANAGE, body: interviewBody, successStatus: 201 },
    ...chain,
    requirePermission(MANAGE),
    validate({ params: idParams, body: interviewBody }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      const c = await getCandidate(tenantId, String(req.params.id));
      if (c.stage !== 'INTERVIEW') throw AppError.conflict('Interviews can be scheduled while the candidate is in the interview stage');
      if (!(await Employee.exists({ _id: req.body.interviewerId, tenantId, employmentStatus: { $in: ['ACTIVE', 'ON_LEAVE', 'NOTICE_PERIOD'] } })))
        throw AppError.unprocessable('Interviewer not found or not working');
      const after = await Candidate.findOneAndUpdate(
        { _id: c._id, tenantId, stage: 'INTERVIEW' },
        { $push: { interviews: req.body } },
        { new: true },
      ).lean();
      if (!after) throw AppError.conflict('The candidate was changed by someone else; reload and retry');
      await writeAudit(req, { action: 'recruitment.interview_scheduled', entityType: 'Candidate', entityId: c._id, after: { interviewerId: req.body.interviewerId } });
      res.status(201).json({ success: true, data: serCandidate(after) });
    }),
  );

  route(
    v1,
    { method: 'post', path: '/recruitment/candidates/:id/interviews/:interviewId/feedback', summary: 'The assigned interviewer submits feedback, once.', tags: ['Recruitment'], auth: 'tenant', permission: 'recruitment:feedback', body: feedbackBody },
    ...chain,
    requirePermission('recruitment:feedback'),
    validate({ params: interviewParams, body: feedbackBody }),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      const { id, interviewId } = req.params as { id: string; interviewId: string };
      // Not the interviewer (or no such interview) looks the same as a missing record.
      const after = ctx.employeeId
        ? await Candidate.findOneAndUpdate(
            {
              _id: id,
              tenantId: ctx.tenantId,
              interviews: { $elemMatch: { _id: interviewId, interviewerId: ctx.employeeId, 'feedback.submittedAt': { $exists: false } } },
            },
            { $set: { 'interviews.$.feedback': { ...req.body, submittedAt: new Date() } } },
            { new: true },
          ).lean()
        : null;
      if (!after) {
        const exists = ctx.employeeId
          ? await Candidate.exists({ _id: id, tenantId: ctx.tenantId, interviews: { $elemMatch: { _id: interviewId, interviewerId: ctx.employeeId } } })
          : null;
        if (exists) throw AppError.conflict('Feedback has already been submitted for this interview');
        throw AppError.notFound('Interview not found');
      }
      await writeAudit(req, { action: 'recruitment.feedback_submitted', entityType: 'Candidate', entityId: id, after: { interviewId, recommendation: req.body.recommendation } });
      res.json({ success: true, data: { ok: true } });
    }),
  );

  route(
    v1,
    { method: 'get', path: '/recruitment/my-interviews', summary: 'Interviews assigned to you, with the candidate\'s name and job only (no contact details, no other interviewers\' feedback).', tags: ['Recruitment'], auth: 'tenant', permission: 'recruitment:feedback' },
    ...chain,
    requirePermission('recruitment:feedback'),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      if (!ctx.employeeId) return void res.json({ success: true, data: [] });
      const cands = await Candidate.find({ tenantId: ctx.tenantId, 'interviews.interviewerId': ctx.employeeId }).sort({ updatedAt: -1 }).limit(200).lean();
      const jobs = await JobOpening.find({ tenantId: ctx.tenantId, _id: { $in: cands.map((c) => c.jobId) } }).select('title').lean();
      const title = new Map(jobs.map((j) => [String(j._id), j.title]));
      const rows = cands.flatMap((c) =>
        (c.interviews ?? [])
          .filter((i: Doc) => String(i.interviewerId) === String(ctx.employeeId))
          .map((i: Doc) => ({
            candidateId: String(c._id),
            candidateName: `${c.firstName} ${c.lastName}`,
            jobTitle: title.get(String(c.jobId)),
            ...serInterview(i, false),
            myFeedback: i.feedback?.submittedAt ? i.feedback : undefined,
          })),
      );
      res.json({ success: true, data: rows });
    }),
  );

  /* ------------------------------- offers ------------------------------- */
  route(
    v1,
    { method: 'put', path: '/recruitment/candidates/:id/offer', summary: 'Make or revise an offer (candidate must be in OFFER and the offer not yet accepted or declined).', tags: ['Recruitment'], auth: 'tenant', permission: MANAGE, body: offerBody },
    ...chain,
    requirePermission(MANAGE),
    validate({ params: idParams, body: offerBody }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      const c = await getCandidate(tenantId, String(req.params.id));
      if (c.stage !== 'OFFER') throw AppError.conflict('Move the candidate to the offer stage first');
      if (c.offer?.status === 'ACCEPTED' || c.offer?.status === 'DECLINED')
        throw AppError.conflict('This offer has already been decided');
      await assertRefs(tenantId, req.body);
      const after = await Candidate.findOneAndUpdate(
        { _id: c._id, tenantId, stage: 'OFFER', 'offer.status': { $nin: ['ACCEPTED', 'DECLINED'] } },
        { $set: { offer: { ...req.body, status: 'MADE', madeAt: new Date() } } },
        { new: true },
      ).lean();
      if (!after) throw AppError.conflict('The candidate was changed by someone else; reload and retry');
      await writeAudit(req, { action: 'recruitment.offer_made', entityType: 'Candidate', entityId: c._id, after: req.body });
      res.json({ success: true, data: serCandidate(after) });
    }),
  );

  route(
    v1,
    { method: 'post', path: '/recruitment/candidates/:id/offer/decision', summary: 'Record the candidate\'s answer. A declined offer withdraws the candidate.', tags: ['Recruitment'], auth: 'tenant', permission: MANAGE, body: decisionBody },
    ...chain,
    requirePermission(MANAGE),
    validate({ params: idParams, body: decisionBody }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      const { decision } = req.body as z.infer<typeof decisionBody>;
      const base = { _id: req.params.id, tenantId, stage: 'OFFER', 'offer.status': 'MADE' };
      const now = new Date();
      const update =
        decision === 'ACCEPTED'
          ? { $set: { 'offer.status': 'ACCEPTED', 'offer.decidedAt': now } }
          : {
              $set: { 'offer.status': 'DECLINED', 'offer.decidedAt': now, stage: 'WITHDRAWN' },
              $push: { stageHistory: { from: 'OFFER', to: 'WITHDRAWN', at: now, byUserId: req.auth!.userId, reason: 'Offer declined' } },
            };
      const after = await Candidate.findOneAndUpdate(base, update, { new: true }).lean();
      if (!after) throw AppError.conflict('There is no open offer to decide on');
      await writeAudit(req, { action: 'recruitment.offer_decision', entityType: 'Candidate', entityId: String(req.params.id), after: { decision } });
      res.json({ success: true, data: serCandidate(after) });
    }),
  );

  /* -------------------------------- hire -------------------------------- */
  route(
    v1,
    { method: 'post', path: '/recruitment/candidates/:id/hire', summary: 'Turn a candidate with an accepted offer into an employee record (status INVITED; invite them afterwards). Once only.', tags: ['Recruitment'], auth: 'tenant', permission: MANAGE, body: hireBody, successStatus: 201 },
    ...chain,
    requirePermission(MANAGE),
    validate({ params: idParams, body: hireBody }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      const b = req.body as z.infer<typeof hireBody>;
      const c = await getCandidate(tenantId, String(req.params.id));
      if (c.stage === 'HIRED') throw AppError.conflict('This candidate has already been hired');
      if (c.stage !== 'OFFER' || c.offer?.status !== 'ACCEPTED')
        throw AppError.conflict('Only a candidate with an accepted offer can be hired');
      const job = await JobOpening.findOne({ _id: c.jobId, tenantId }).lean();
      if (!job) throw AppError.notFound('Job not found');
      if ((await hiredCount(tenantId, job._id)) >= job.headcount)
        throw AppError.conflict('Every position on this job has been filled');
      if (b.managerId) await assertRefs(tenantId, { hiringManagerId: b.managerId });

      // Claim first so a double click cannot create two employees.
      const claimed = await Candidate.findOneAndUpdate(
        { _id: c._id, tenantId, stage: 'OFFER', 'offer.status': 'ACCEPTED', hireClaimed: { $ne: true }, hiredEmployeeId: { $exists: false } },
        { $set: { hireClaimed: true } },
        { new: true },
      ).lean();
      if (!claimed) throw AppError.conflict('This candidate is already being hired');
      let emp;
      try {
        emp = await employees.createEmployee(tenantId, req.auth!.userId, {
          ...(b.employeeCode ? { employeeCode: b.employeeCode } : {}),
          firstName: c.firstName,
          lastName: c.lastName,
          workEmail: b.workEmail,
          personalEmail: c.email,
          ...(c.phone ? { phone: c.phone } : {}),
          joiningDate: b.joiningDate,
          employmentType: job.employmentType,
          ...(job.departmentId ? { departmentId: job.departmentId } : {}),
          ...((c.offer?.designationId ?? job.designationId) ? { designationId: c.offer?.designationId ?? job.designationId } : {}),
          ...(b.managerId ? { managerId: b.managerId } : job.hiringManagerId ? { managerId: job.hiringManagerId } : {}),
        });
      } catch (e) {
        await Candidate.updateOne({ _id: c._id, tenantId }, { $unset: { hireClaimed: 1 } });
        return rethrowDuplicate(e, 'An employee with this code or work email already exists');
      }
      await Candidate.updateOne(
        { _id: c._id, tenantId },
        {
          $set: { stage: 'HIRED', hiredEmployeeId: emp._id },
          $unset: { hireClaimed: 1 },
          $push: { stageHistory: { from: 'OFFER', to: 'HIRED', at: new Date(), byUserId: req.auth!.userId } },
        },
      );
      await writeAudit(req, { action: 'recruitment.hired', entityType: 'Candidate', entityId: c._id, after: { employeeId: emp._id } });
      res.status(201).json({ success: true, data: { candidateId: String(c._id), employeeId: String(emp._id), employeeCode: emp.employeeCode } });
    }),
  );
}
