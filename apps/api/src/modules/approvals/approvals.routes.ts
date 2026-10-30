import type { Router } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { ApprovalDelegation, ApprovalRequest } from '../../database/models/approvalRequest.model';
import { APPROVAL_ROLES, APPROVER_TYPES, ApprovalWorkflow } from '../../database/models/approvalWorkflow.model';
import { Employee } from '../../database/models/employee.model';
import { authenticate, requirePermission, resolveTenant } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/errors';
import { rethrowDuplicate } from '../../utils/mongo';
import { route } from '../../utils/route';
import { idParams, objectId, paginationQuery, validate } from '../../utils/validate';
import { hasPermission } from '../auth/permissions';
import { writeAudit } from '../audit/audit.service';
import { cancelRequest, decide, inboxFilter, submitRequest, type Actor } from './approvals.service';

const stepBody = z
  .object({
    approverType: z.enum(APPROVER_TYPES),
    level: z.number().int().min(1).max(5).optional(),
    role: z.enum(APPROVAL_ROLES).optional(),
    employeeId: objectId.optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.approverType === 'ROLE' && !s.role) ctx.addIssue({ code: 'custom', message: 'role is required', path: ['role'] });
    if (s.approverType === 'EMPLOYEE' && !s.employeeId)
      ctx.addIssue({ code: 'custom', message: 'employeeId is required', path: ['employeeId'] });
  });
const workflowBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    requestType: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_]{1,39}$/),
    steps: z.array(stepBody).min(1).max(8),
  })
  .strict();
const workflowPatch = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    steps: z.array(stepBody).min(1).max(8).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .strict();
const submitBody = z
  .object({
    requestType: z.string().trim().min(2).max(40),
    title: z.string().trim().min(1).max(200),
    details: z.record(z.string(), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).optional(),
  })
  .strict();
const decisionBody = z
  .object({ decision: z.enum(['APPROVE', 'REJECT']), comment: z.string().trim().max(1000).optional() })
  .strict();
const listQuery = z
  .object({
    ...paginationQuery,
    scope: z.enum(['mine', 'inbox', 'all']).default('mine'),
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
    requestType: z.string().trim().max(40).optional(),
  })
  .strict();
const delegationBody = z
  .object({ delegateEmployeeId: objectId, from: z.coerce.date(), to: z.coerce.date() })
  .strict();

type Names = Map<string, string>;
const nm = (names: Names, id: unknown) => (id ? names.get(String(id)) : undefined);
const serStep = (s: Record<string, any>, names: Names) => ({
  order: s.order,
  approverType: s.approverType,
  role: s.role,
  status: s.status,
  approverEmployeeIds: ((s.approverEmployeeIds as unknown[]) ?? []).map(String),
  approverNames: ((s.approverEmployeeIds as unknown[]) ?? []).map((i) => nm(names, i) ?? 'Unknown'),
  actedByName: nm(names, s.actedByEmployeeId),
  onBehalfOfName: nm(names, s.onBehalfOfEmployeeId),
  actedByEmployeeId: s.actedByEmployeeId ? String(s.actedByEmployeeId) : undefined,
  onBehalfOfEmployeeId: s.onBehalfOfEmployeeId ? String(s.onBehalfOfEmployeeId) : undefined,
  actedAt: s.actedAt,
  comment: s.comment,
});
const serRequest = (d: Record<string, any>, names: Names) => ({
  id: String(d._id),
  requestType: d.requestType,
  title: d.title,
  details: d.details,
  requesterEmployeeId: String(d.requesterEmployeeId),
  requesterName: nm(names, d.requesterEmployeeId),
  status: d.status,
  currentStep: d.currentStep,
  steps: (d.steps ?? []).map((x: Record<string, any>) => serStep(x, names)),
  decidedAt: d.decidedAt,
  createdAt: d.createdAt,
});
/** Names for every employee mentioned by these requests (requester, approvers, actors) in one query. */
async function namesFor(tenantId: unknown, docs: Record<string, any>[]): Promise<Names> {
  const ids = new Set<string>();
  for (const d of docs) {
    ids.add(String(d.requesterEmployeeId));
    for (const s of d.steps ?? []) {
      for (const a of s.approverEmployeeIds ?? []) ids.add(String(a));
      if (s.actedByEmployeeId) ids.add(String(s.actedByEmployeeId));
      if (s.onBehalfOfEmployeeId) ids.add(String(s.onBehalfOfEmployeeId));
    }
  }
  const rows = await Employee.find({ tenantId: tenantId as never, _id: { $in: [...ids] } })
    .select('firstName lastName')
    .lean();
  return new Map(rows.map((r) => [String(r._id), `${r.firstName} ${r.lastName}`]));
}
const serWorkflow = (d: Record<string, any>) => ({
  id: String(d._id),
  name: d.name,
  requestType: d.requestType,
  status: d.status,
  steps: (d.steps ?? []).map((s: Record<string, any>) => ({
    approverType: s.approverType,
    level: s.level,
    role: s.role,
    employeeId: s.employeeId ? String(s.employeeId) : undefined,
  })),
  updatedAt: d.updatedAt,
});

export function registerApprovalRoutes(v1: Router, env: Env): void {
  const chain = [authenticate(env), resolveTenant];
  const actorOf = (req: import('express').Request): Actor => ({
    tenantId: req.tenantCtx!.tenantId,
    userId: req.auth!.userId,
    employeeId: req.tenantCtx!.employeeId,
  });

  /* ------------------------------- workflows ------------------------------- */
  route(
    v1,
    { method: 'get', path: '/approval-workflows', summary: 'List approval workflows.', tags: ['Approvals'], auth: 'tenant', permission: 'approval:manage' },
    ...chain,
    requirePermission('approval:manage'),
    asyncHandler(async (req, res) => {
      const rows = await ApprovalWorkflow.find({ tenantId: req.tenantCtx!.tenantId }).sort({ requestType: 1 }).lean();
      res.json({ success: true, data: rows.map(serWorkflow) });
    }),
  );

  const checkEmployees = async (tenantId: unknown, steps: z.infer<typeof stepBody>[]) => {
    for (const s of steps.filter((x) => x.approverType === 'EMPLOYEE')) {
      const e = await Employee.exists({ _id: s.employeeId, tenantId: tenantId as never });
      if (!e) throw AppError.badRequest('Approver employee not found');
    }
  };

  route(
    v1,
    { method: 'post', path: '/approval-workflows', summary: 'Create an approval workflow (one active workflow per request type).', tags: ['Approvals'], auth: 'tenant', permission: 'approval:manage', body: workflowBody, successStatus: 201 },
    ...chain,
    requirePermission('approval:manage'),
    validate({ body: workflowBody }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      const body = req.body as z.infer<typeof workflowBody>;
      await checkEmployees(tenantId, body.steps);
      const doc = await ApprovalWorkflow.create({ ...body, tenantId }).catch((e) =>
        rethrowDuplicate(e, 'An active workflow already exists for this request type'),
      );
      await writeAudit(req, { action: 'approval.workflow.create', entityType: 'ApprovalWorkflow', entityId: doc._id, after: doc });
      res.status(201).json({ success: true, data: serWorkflow(doc.toObject()) });
    }),
  );

  route(
    v1,
    { method: 'patch', path: '/approval-workflows/:id', summary: 'Update a workflow. Requests already raised keep the steps they were created with.', tags: ['Approvals'], auth: 'tenant', permission: 'approval:manage', body: workflowPatch },
    ...chain,
    requirePermission('approval:manage'),
    validate({ params: idParams, body: workflowPatch }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      const body = req.body as z.infer<typeof workflowPatch>;
      if (body.steps) await checkEmployees(tenantId, body.steps);
      const before = await ApprovalWorkflow.findOne({ _id: req.params.id, tenantId }).lean();
      if (!before) throw AppError.notFound('Workflow not found');
      const after = await ApprovalWorkflow.findOneAndUpdate({ _id: req.params.id, tenantId }, { $set: body }, { new: true, runValidators: true })
        .lean()
        .catch((e) => rethrowDuplicate(e, 'An active workflow already exists for this request type'));
      await writeAudit(req, { action: 'approval.workflow.update', entityType: 'ApprovalWorkflow', entityId: req.params.id, before, after });
      res.json({ success: true, data: serWorkflow(after!) });
    }),
  );

  /* -------------------------------- requests -------------------------------- */
  route(
    v1,
    { method: 'post', path: '/approvals', summary: 'Raise an approval request. Steps and approvers are resolved from the active workflow; you can never approve your own request.', tags: ['Approvals'], auth: 'tenant', permission: 'approval:use', body: submitBody, successStatus: 201 },
    ...chain,
    requirePermission('approval:use'),
    validate({ body: submitBody }),
    asyncHandler(async (req, res) => {
      const doc = await submitRequest(actorOf(req), req.body);
      await writeAudit(req, { action: 'approval.submit', entityType: 'ApprovalRequest', entityId: doc._id, after: { requestType: doc.requestType, title: doc.title } });
      res.status(201).json({ success: true, data: serRequest(doc.toObject(), await namesFor(doc.tenantId, [doc.toObject()])) });
    }),
  );

  route(
    v1,
    { method: 'get', path: '/approvals', summary: 'List requests: scope=mine (raised by you), inbox (waiting on you or someone who delegated to you), all (needs approval:manage).', tags: ['Approvals'], auth: 'tenant', permission: 'approval:use', query: listQuery },
    ...chain,
    requirePermission('approval:use'),
    validate({ query: listQuery }),
    asyncHandler(async (req, res) => {
      const q = req.query as unknown as z.infer<typeof listQuery>;
      const actor = actorOf(req);
      let filter: Record<string, unknown>;
      if (q.scope === 'all') {
        if (!hasPermission(req.tenantCtx!, 'approval:manage')) throw AppError.forbidden();
        filter = { tenantId: actor.tenantId };
      } else if (q.scope === 'inbox') {
        filter = await inboxFilter(actor);
      } else {
        filter = { tenantId: actor.tenantId, requesterEmployeeId: actor.employeeId ?? null };
      }
      if (q.scope !== 'inbox' && q.status) filter.status = q.status;
      if (q.requestType) filter.requestType = q.requestType.toUpperCase();
      const [items, total] = await Promise.all([
        ApprovalRequest.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
        ApprovalRequest.countDocuments(filter),
      ]);
      const names = await namesFor(actor.tenantId, items);
      res.json({ success: true, data: items.map((x) => serRequest(x, names)), meta: { page: q.page, limit: q.limit, total } });
    }),
  );

  route(
    v1,
    { method: 'get', path: '/approvals/:id', summary: 'One request. Visible to the requester, its approvers (and their delegates) and approval managers; others get 404.', tags: ['Approvals'], auth: 'tenant', permission: 'approval:use' },
    ...chain,
    requirePermission('approval:use'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const actor = actorOf(req);
      const doc = await ApprovalRequest.findOne({ _id: req.params.id, tenantId: actor.tenantId }).lean();
      if (!doc) throw AppError.notFound('Request not found');
      const mine = !!actor.employeeId && String(doc.requesterEmployeeId) === String(actor.employeeId);
      const manage = hasPermission(req.tenantCtx!, 'approval:manage');
      const inInbox = !mine && (await ApprovalRequest.exists({ ...(await inboxFilter(actor)), _id: doc._id }));
      const wasApprover =
        !!actor.employeeId &&
        doc.steps.some((s) => (s.approverEmployeeIds ?? []).some((a) => String(a) === String(actor.employeeId)));
      if (!mine && !manage && !inInbox && !wasApprover) throw AppError.notFound('Request not found');
      res.json({ success: true, data: serRequest(doc, await namesFor(actor.tenantId, [doc])) });
    }),
  );

  route(
    v1,
    { method: 'post', path: '/approvals/:id/decision', summary: 'Approve or reject the current step. Only that step\'s approvers (or their active delegates) may; never the requester.', tags: ['Approvals'], auth: 'tenant', permission: 'approval:use', body: decisionBody },
    ...chain,
    requirePermission('approval:use'),
    validate({ params: idParams, body: decisionBody }),
    asyncHandler(async (req, res) => {
      const { decision, comment } = req.body as z.infer<typeof decisionBody>;
      const doc = await decide(actorOf(req), req.params.id!, decision, comment);
      await writeAudit(req, { action: `approval.${decision.toLowerCase()}`, entityType: 'ApprovalRequest', entityId: doc._id, after: { status: doc.status, step: doc.currentStep } });
      res.json({ success: true, data: serRequest(doc.toObject(), await namesFor(doc.tenantId, [doc.toObject()])) });
    }),
  );

  route(
    v1,
    { method: 'post', path: '/approvals/:id/cancel', summary: 'Withdraw your own pending request.', tags: ['Approvals'], auth: 'tenant', permission: 'approval:use' },
    ...chain,
    requirePermission('approval:use'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const doc = await cancelRequest(actorOf(req), req.params.id!);
      await writeAudit(req, { action: 'approval.cancel', entityType: 'ApprovalRequest', entityId: doc._id });
      res.json({ success: true, data: serRequest(doc.toObject(), await namesFor(doc.tenantId, [doc.toObject()])) });
    }),
  );

  /* ------------------------------- delegation ------------------------------- */
  const serDel = (d: Record<string, any>) => ({
    id: String(d._id),
    delegatorEmployeeId: String(d.delegatorEmployeeId),
    delegateEmployeeId: String(d.delegateEmployeeId),
    from: d.from,
    to: d.to,
    revokedAt: d.revokedAt,
  });

  route(
    v1,
    { method: 'post', path: '/approval-delegations', summary: 'Let a colleague act on your approvals for up to 90 days.', tags: ['Approvals'], auth: 'tenant', permission: 'approval:use', body: delegationBody, successStatus: 201 },
    ...chain,
    requirePermission('approval:use'),
    validate({ body: delegationBody }),
    asyncHandler(async (req, res) => {
      const actor = actorOf(req);
      const b = req.body as z.infer<typeof delegationBody>;
      if (!actor.employeeId) throw AppError.forbidden();
      if (String(b.delegateEmployeeId) === String(actor.employeeId)) throw AppError.badRequest('Cannot delegate to yourself');
      if (!(b.from < b.to)) throw AppError.badRequest('"to" must be after "from"');
      if (b.to.getTime() - b.from.getTime() > 90 * 864e5) throw AppError.badRequest('A delegation can last at most 90 days');
      if (b.to.getTime() < Date.now()) throw AppError.badRequest('"to" is in the past');
      const target = await Employee.exists({ _id: b.delegateEmployeeId, tenantId: actor.tenantId, employmentStatus: { $in: ['ACTIVE', 'NOTICE_PERIOD', 'ON_LEAVE'] } });
      if (!target) throw AppError.badRequest('Delegate must be an active employee of this company');
      const doc = await ApprovalDelegation.create({ tenantId: actor.tenantId, delegatorEmployeeId: actor.employeeId, ...b });
      await writeAudit(req, { action: 'approval.delegate', entityType: 'ApprovalDelegation', entityId: doc._id, after: doc });
      res.status(201).json({ success: true, data: serDel(doc.toObject()) });
    }),
  );

  route(
    v1,
    { method: 'get', path: '/approval-delegations', summary: 'Delegations you gave and received.', tags: ['Approvals'], auth: 'tenant', permission: 'approval:use' },
    ...chain,
    requirePermission('approval:use'),
    asyncHandler(async (req, res) => {
      const a = actorOf(req);
      if (!a.employeeId) return void res.json({ success: true, data: { given: [], received: [] } });
      const [given, received] = await Promise.all([
        ApprovalDelegation.find({ tenantId: a.tenantId, delegatorEmployeeId: a.employeeId }).sort({ to: -1 }).limit(100).lean(),
        ApprovalDelegation.find({ tenantId: a.tenantId, delegateEmployeeId: a.employeeId }).sort({ to: -1 }).limit(100).lean(),
      ]);
      res.json({ success: true, data: { given: given.map(serDel), received: received.map(serDel) } });
    }),
  );

  route(
    v1,
    { method: 'post', path: '/approval-delegations/:id/revoke', summary: 'End a delegation you gave.', tags: ['Approvals'], auth: 'tenant', permission: 'approval:use' },
    ...chain,
    requirePermission('approval:use'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const a = actorOf(req);
      const doc = await ApprovalDelegation.findOneAndUpdate(
        { _id: req.params.id, tenantId: a.tenantId, delegatorEmployeeId: a.employeeId ?? null, revokedAt: null },
        { $set: { revokedAt: new Date() } },
        { new: true },
      ).lean();
      if (!doc) throw AppError.notFound('Delegation not found');
      await writeAudit(req, { action: 'approval.delegate.revoke', entityType: 'ApprovalDelegation', entityId: doc._id });
      res.json({ success: true, data: serDel(doc) });
    }),
  );
}
