import type { Types } from 'mongoose';
import { ApprovalDelegation, ApprovalRequest } from '../../database/models/approvalRequest.model';
import { ApprovalWorkflow } from '../../database/models/approvalWorkflow.model';
import { ENDED_STATUSES, Employee } from '../../database/models/employee.model';
import { Membership } from '../../database/models/membership.model';
import { AppError } from '../../utils/errors';
import { conditionMet, type StepCondition } from './conditions';

type Id = Types.ObjectId | string;
const same = (a?: Id | null, b?: Id | null) => !!a && !!b && String(a) === String(b);
const ENDED = [...ENDED_STATUSES];

interface StepDef {
  approverType: string;
  level?: number | null;
  role?: string | null;
  employeeId?: Id | null;
  condition?: StepCondition | null;
  escalation?: (StepDef & { afterHours: number }) | null;
  mode?: 'ANY' | 'ALL' | 'QUORUM' | null;
  quorum?: number | null;
}

/** How many distinct approvals complete a step. Fixed when the request is raised. */
export function requiredApprovals(mode: string | null | undefined, quorum: number | null | undefined, approvers: number): number {
  if (approvers <= 1) return 1;
  if (mode === 'ALL') return approvers;
  if (mode === 'QUORUM') return Math.max(1, Math.min(quorum ?? approvers, approvers));
  return 1;
}

/** Walk up the manager chain (cycle-safe). Returns the employee `level` managers above `employeeId`, or null. */
async function managerAt(tenantId: Id, employeeId: Id, level: number): Promise<Id | null> {
  const seen = new Set<string>([String(employeeId)]);
  let cur: Id = employeeId;
  for (let i = 0; i < level; i++) {
    const e = await Employee.findOne({ _id: cur, tenantId }).select('managerId').lean();
    if (!e?.managerId) return null;
    const next = String(e.managerId);
    if (seen.has(next)) return null; // cycle in the org chart: stop rather than loop
    seen.add(next);
    cur = e.managerId;
  }
  return cur;
}

/** Employees able to act on a step. The requester is never one of them. */
export async function resolveApprovers(
  tenantId: Id,
  requesterEmployeeId: Id,
  step: StepDef,
): Promise<Id[]> {
  let ids: Id[] = [];
  if (step.approverType === 'MANAGER') {
    const m = await managerAt(tenantId, requesterEmployeeId, step.level ?? 1);
    if (m) ids = [m];
    else if ((step.level ?? 1) === 1) ids = await roleHolders(tenantId, 'COMPANY_OWNER'); // unmanaged: owner decides
  } else if (step.approverType === 'ROLE' && step.role) {
    ids = await roleHolders(tenantId, step.role);
  } else if (step.approverType === 'EMPLOYEE' && step.employeeId) {
    ids = [step.employeeId];
  }
  ids = ids.filter((i) => !same(i, requesterEmployeeId));
  if (ids.length === 0) return [];
  const active = await Employee.find({
    tenantId,
    _id: { $in: ids },
    employmentStatus: { $nin: ENDED },
  })
    .select('_id')
    .lean();
  return active.map((a) => a._id);
}

async function roleHolders(tenantId: Id, role: string): Promise<Id[]> {
  const ms = await Membership.find({ tenantId, roles: role, status: 'ACTIVE', employeeId: { $ne: null } })
    .select('employeeId')
    .lean();
  return ms.map((m) => m.employeeId!).filter(Boolean);
}

/** Employees who have delegated their approvals to `employeeId` right now. */
async function delegatorsOf(tenantId: Id, employeeId: Id, now = new Date()): Promise<Id[]> {
  const ds = await ApprovalDelegation.find({
    tenantId,
    delegateEmployeeId: employeeId,
    from: { $lte: now },
    to: { $gte: now },
    revokedAt: null,
  })
    .select('delegatorEmployeeId')
    .lean();
  return ds.map((d) => d.delegatorEmployeeId);
}

/**
 * Modules that own the thing being approved (leave, expenses...) register hooks per request type.
 * `beforeFinalApprove` may throw to block the last approval; `afterFinal` applies the outcome.
 */
export interface RequestHooks {
  beforeFinalApprove?(req: ApprovalRequestLean): Promise<void>;
  afterFinal?(req: ApprovalRequestLean, actor: Actor): Promise<void>;
}
type ApprovalRequestLean = {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  requestType: string;
  status: string;
  currentStep: number;
  steps: { comment?: string | null }[];
};
const hooks = new Map<string, RequestHooks>();
export const registerHooks = (requestType: string, h: RequestHooks) => void hooks.set(requestType, h);

export interface Actor {
  tenantId: Id;
  userId: Id;
  employeeId?: Id;
  /** Optional injected time (tests, replays); defaults to the real clock. */
  now?: Date;
}

/** Create a request from the ACTIVE workflow for `requestType`; the first step with approvers becomes current. */
export async function submitRequest(
  actor: Actor,
  input: { requestType: string; title: string; details?: unknown },
) {
  if (!actor.employeeId) throw AppError.forbidden('Only employees can raise requests');
  const wf = await ApprovalWorkflow.findOne({
    tenantId: actor.tenantId,
    requestType: input.requestType.toUpperCase(),
    status: 'ACTIVE',
  }).lean();
  if (!wf) throw AppError.notFound('No active approval workflow for this request type');

  const steps: Record<string, unknown>[] = [];
  for (const [i, s] of wf.steps.entries()) {
    if (!conditionMet(s.condition as StepCondition | undefined, input.details as Record<string, unknown> | undefined)) {
      steps.push({
        order: i,
        approverType: s.approverType,
        role: s.role ?? undefined,
        approverEmployeeIds: [],
        status: 'SKIPPED',
        skippedReason: 'CONDITION',
      });
      continue;
    }
    const approvers = await resolveApprovers(actor.tenantId, actor.employeeId, s);
    steps.push({
      order: i,
      approverType: s.approverType,
      role: s.role ?? undefined,
      approverEmployeeIds: approvers,
      status: approvers.length ? 'WAITING' : 'SKIPPED',
      ...(approvers.length ? {} : { skippedReason: 'NO_APPROVER' }),
      ...(approvers.length && s.escalation ? { escalation: s.escalation } : {}),
      mode: s.mode ?? 'ANY',
      required: requiredApprovals(s.mode, s.quorum, approvers.length),
    });
  }
  const first = steps.findIndex((s) => s.status === 'WAITING');
  if (first < 0) throw AppError.unprocessable('No eligible approver is available for this request');
  steps[first]!.status = 'PENDING';
  steps[first]!.pendingSince = actor.now ?? new Date();
  return ApprovalRequest.create({
    tenantId: actor.tenantId,
    workflowId: wf._id,
    requestType: wf.requestType,
    title: input.title,
    details: input.details,
    requesterEmployeeId: actor.employeeId,
    requesterUserId: actor.userId,
    currentStep: first,
    steps,
  });
}

/** Does `actor` hold the current step? Returns the delegator when acting as a delegate. */
async function authority(
  actor: Actor,
  req: { requesterEmployeeId: Id; steps: { approverEmployeeIds?: Id[] }[]; currentStep: number },
): Promise<{ ok: boolean; onBehalfOf?: Id }> {
  if (!actor.employeeId || same(actor.employeeId, req.requesterEmployeeId)) return { ok: false };
  const allowed = req.steps[req.currentStep]?.approverEmployeeIds ?? [];
  if (allowed.some((a) => same(a, actor.employeeId))) return { ok: true };
  for (const d of await delegatorsOf(actor.tenantId, actor.employeeId)) {
    if (same(d, req.requesterEmployeeId)) continue;
    if (allowed.some((a) => same(a, d))) return { ok: true, onBehalfOf: d };
  }
  return { ok: false };
}

export async function decide(
  actor: Actor,
  requestId: Id,
  decision: 'APPROVE' | 'REJECT',
  comment?: string,
) {
  const req = await ApprovalRequest.findOne({ _id: requestId, tenantId: actor.tenantId }).lean();
  if (!req) throw AppError.notFound('Request not found');
  const auth = await authority(actor, req);
  if (!auth.ok) {
    // A requester or bystander should not learn the request exists unless it is theirs.
    if (same(actor.employeeId, req.requesterEmployeeId)) throw AppError.forbidden('You cannot decide your own request');
    throw AppError.notFound('Request not found');
  }
  if (req.status !== 'PENDING') throw AppError.conflict('Request is already decided');
  const i = req.currentStep;
  const now = new Date();
  const cur = req.steps[i] as unknown as { required?: number; approvals?: { actedByEmployeeId?: Id; employeeId?: Id }[] };
  const required = cur?.required ?? 1;
  const prior = cur?.approvals ?? [];
  if (
    decision === 'APPROVE' &&
    prior.some((p) => same(p.actedByEmployeeId, actor.employeeId) || (auth.onBehalfOf && same(p.employeeId, auth.onBehalfOf)))
  )
    throw AppError.conflict('You have already approved this step');
  // A step that needs several approvals stays open until enough distinct people have approved.
  const needMore = decision === 'APPROVE' && prior.length + 1 < required;
  const approval = {
    employeeId: auth.onBehalfOf ?? actor.employeeId,
    actedByUserId: actor.userId,
    actedByEmployeeId: actor.employeeId,
    ...(auth.onBehalfOf ? { onBehalfOfEmployeeId: auth.onBehalfOf } : {}),
    at: now,
    ...(comment ? { comment } : {}),
  };
  const stepSet = {
    [`steps.${i}.status`]: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
    [`steps.${i}.actedByUserId`]: actor.userId,
    [`steps.${i}.actedByEmployeeId`]: actor.employeeId,
    [`steps.${i}.actedAt`]: now,
    ...(comment ? { [`steps.${i}.comment`]: comment } : {}),
    ...(auth.onBehalfOf ? { [`steps.${i}.onBehalfOfEmployeeId`]: auth.onBehalfOf } : {}),
  };
  let update: Record<string, unknown>;
  if (needMore) {
    update = {};
  } else if (decision === 'REJECT') {
    update = { ...stepSet, status: 'REJECTED', decidedAt: now };
  } else {
    const next = req.steps.findIndex((s, k) => k > i && s.status === 'WAITING');
    update =
      next < 0
        ? { ...stepSet, status: 'APPROVED', decidedAt: now }
        : { ...stepSet, currentStep: next, [`steps.${next}.status`]: 'PENDING', [`steps.${next}.pendingSince`]: now };
  }
  if (decision === 'APPROVE' && !needMore && !req.steps.some((s, k) => k > i && s.status === 'WAITING'))
    await hooks.get(req.requestType)?.beforeFinalApprove?.(req as never);
  // Atomic: only the step we read may be decided, and only once.
  const done = await ApprovalRequest.findOneAndUpdate(
    {
      _id: requestId,
      tenantId: actor.tenantId,
      status: 'PENDING',
      currentStep: i,
      [`steps.${i}.status`]: 'PENDING',
      // Two people approving at the same moment: only one write wins the slot, the other is told to reload.
      ...(required > 1 && decision === 'APPROVE' ? { [`steps.${i}.approvals`]: { $size: prior.length } } : {}),
    },
    {
      ...(Object.keys(update).length ? { $set: update } : {}),
      ...(decision === 'APPROVE' ? { $push: { [`steps.${i}.approvals`]: approval } } : {}),
    },
    { new: true },
  );
  if (!done) throw AppError.conflict('Request changed; reload and try again');
  if (done.status !== 'PENDING') await hooks.get(done.requestType)?.afterFinal?.(done as never, actor);
  return done;
}

export async function cancelRequest(actor: Actor, requestId: Id) {
  const done = await ApprovalRequest.findOneAndUpdate(
    {
      _id: requestId,
      tenantId: actor.tenantId,
      requesterEmployeeId: actor.employeeId,
      status: 'PENDING',
    },
    { $set: { status: 'CANCELLED', decidedAt: new Date() } },
    { new: true },
  );
  if (!done) throw AppError.notFound('Pending request not found');
  await hooks.get(done.requestType)?.afterFinal?.(done as never, actor);
  return done;
}

/** Requests currently waiting on `actor` (directly or as a delegate). */
export async function inboxFilter(actor: Actor): Promise<Record<string, unknown>> {
  if (!actor.employeeId) return { _id: null };
  const who = [actor.employeeId, ...(await delegatorsOf(actor.tenantId, actor.employeeId))];
  return {
    tenantId: actor.tenantId,
    status: 'PENDING',
    requesterEmployeeId: { $nin: [actor.employeeId] },
    $and: [
      // someone who already approved a multi-approver step has nothing left to do on it
      {
        $expr: {
          $not: [
            {
              $in: [
                actor.employeeId,
                {
                  $map: {
                    input: { $ifNull: [{ $arrayElemAt: ['$steps.approvals', '$currentStep'] }, []] },
                    in: '$$this.actedByEmployeeId',
                  },
                },
              ],
            },
          ],
        },
      },
    ],
    $expr: {
      $gt: [
        {
          $size: {
            $setIntersection: [
              { $ifNull: [{ $arrayElemAt: ['$steps.approverEmployeeIds', '$currentStep'] }, []] },
              who,
            ],
          },
        },
        0,
      ],
    },
  };
}

/**
 * Modules whose approvals have no built-in fallback (work from home, ...) call this first. If the
 * company has no active workflow for the type, a one-step "requester's manager (owner if none)"
 * workflow is created, which HR can edit later like any other.
 */
export async function ensureWorkflow(tenantId: Id, requestType: string, name: string) {
  const type = requestType.toUpperCase();
  if (await ApprovalWorkflow.exists({ tenantId, requestType: type, status: 'ACTIVE' })) return;
  await ApprovalWorkflow.create({ tenantId, requestType: type, name, steps: [{ approverType: 'MANAGER', level: 1 }] }).catch(
    (e) => {
      if (!(e && (e as { code?: number }).code === 11000)) throw e; // someone else just created it: fine
    },
  );
}

/**
 * Escalation of overdue steps. For every PENDING request whose current step has an escalation rule and has been
 * waiting longer than `afterHours`, the rule's approvers are ADDED to the step (the original approvers keep their
 * right to act). Happens at most once per step. Safe to run any number of times and in any order.
 * Returns the people who just became approvers so the caller can notify them.
 */
export async function escalateOverdue(
  tenantId: Id,
  now: Date,
  limit = 500,
): Promise<{ escalated: number; notify: { employeeId: Id; requestId: Id; title: string }[] }> {
  const candidates = await ApprovalRequest.find({
    tenantId,
    status: 'PENDING',
    steps: { $elemMatch: { status: 'PENDING', 'escalation.afterHours': { $gt: 0 }, escalatedAt: null } },
  })
    .limit(limit)
    .lean();
  let escalated = 0;
  const notify: { employeeId: Id; requestId: Id; title: string }[] = [];
  for (const r of candidates) {
    const i = r.currentStep;
    const step = r.steps[i] as
      | (typeof r.steps)[number] & {
          escalation?: { afterHours: number; approverType: string; level?: number; role?: string; employeeId?: Id };
          pendingSince?: Date;
          escalatedAt?: Date;
        }
      | undefined;
    if (!step || step.status !== 'PENDING' || !step.escalation || step.escalatedAt || !step.pendingSince) continue;
    if (now.getTime() - step.pendingSince.getTime() < step.escalation.afterHours * 3_600_000) continue;
    const current = new Set((step.approverEmployeeIds ?? []).map(String));
    const fresh = (await resolveApprovers(tenantId, r.requesterEmployeeId, step.escalation)).filter(
      (a) => !current.has(String(a)),
    );
    const done = await ApprovalRequest.findOneAndUpdate(
      {
        _id: r._id,
        tenantId,
        status: 'PENDING',
        currentStep: i,
        [`steps.${i}.status`]: 'PENDING',
        [`steps.${i}.escalatedAt`]: null,
      },
      {
        $set: { [`steps.${i}.escalatedAt`]: now, [`steps.${i}.escalatedToEmployeeIds`]: fresh },
        ...(fresh.length ? { $addToSet: { [`steps.${i}.approverEmployeeIds`]: { $each: fresh } } } : {}),
      },
      { new: true },
    );
    if (!done) continue; // decided or escalated by someone else in the meantime
    escalated += 1;
    for (const f of fresh) notify.push({ employeeId: f, requestId: r._id, title: r.title });
  }
  return { escalated, notify };
}
