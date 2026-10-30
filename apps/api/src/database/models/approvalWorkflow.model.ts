import { InferSchemaType, Schema } from 'mongoose';
import { CONDITION_OPS } from '../../modules/approvals/conditions';
import { tenantModel } from '../tenantModel';

export const APPROVER_TYPES = ['MANAGER', 'ROLE', 'EMPLOYEE'] as const;
export const STEP_MODES = ['ANY', 'ALL', 'QUORUM'] as const;
export const APPROVAL_ROLES = ['COMPANY_OWNER', 'HR_ADMIN', 'MANAGER', 'PAYROLL_ADMIN'] as const;

const stepSchema = new Schema(
  {
    /** MANAGER: requester's manager (`level` 2 = manager's manager). ROLE: anyone holding `role`. EMPLOYEE: one named person. */
    approverType: { type: String, enum: APPROVER_TYPES, required: true },
    level: { type: Number, min: 1, max: 5, default: 1 },
    role: { type: String, enum: APPROVAL_ROLES },
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee' },
    /** ANY: one approver decides. ALL: every approver listed when the request is raised must approve. QUORUM: `quorum` of them. */
    mode: { type: String, enum: STEP_MODES, default: 'ANY' },
    quorum: { type: Number, min: 2, max: 20 },
    /**
     * Optional: if nobody has decided this step after `afterHours`, more approvers are added to it (the original
     * approvers can still act). Resolved relative to the requester, like the step's own approvers.
     */
    escalation: {
      type: new Schema(
        {
          afterHours: { type: Number, min: 1, max: 720, required: true },
          approverType: { type: String, enum: APPROVER_TYPES, required: true },
          level: { type: Number, min: 1, max: 5, default: 1 },
          role: { type: String, enum: APPROVAL_ROLES },
          employeeId: { type: Schema.Types.ObjectId, ref: 'Employee' },
        },
        { _id: false },
      ),
      default: undefined,
    },
    /** Optional: the step applies only when the request's details satisfy this (see conditions.ts). */
    condition: {
      type: new Schema(
        {
          field: { type: String, required: true, maxlength: 40 },
          op: { type: String, enum: CONDITION_OPS, required: true },
          value: { type: Schema.Types.Mixed, required: true },
        },
        { _id: false },
      ),
      default: undefined,
    },
  },
  { _id: false },
);

/** A configurable chain of approval steps for one kind of request (e.g. LEAVE, EXPENSE, ASSET). */
const workflowSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    /** Free-form upper-case key the calling module uses, e.g. LEAVE. One ACTIVE workflow per key. */
    requestType: { type: String, required: true, uppercase: true, trim: true, maxlength: 40 },
    steps: { type: [stepSchema], validate: (v: unknown[]) => v.length >= 1 && v.length <= 8 },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
  },
  { timestamps: true },
);
workflowSchema.index(
  { tenantId: 1, requestType: 1 },
  { unique: true, partialFilterExpression: { status: 'ACTIVE' } },
);

export type ApprovalWorkflowDoc = InferSchemaType<typeof workflowSchema>;
export const ApprovalWorkflow = tenantModel('ApprovalWorkflow', workflowSchema);
