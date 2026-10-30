import { InferSchemaType, Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';

export const APPROVER_TYPES = ['MANAGER', 'ROLE', 'EMPLOYEE'] as const;
export const APPROVAL_ROLES = ['COMPANY_OWNER', 'HR_ADMIN', 'MANAGER', 'PAYROLL_ADMIN'] as const;

const stepSchema = new Schema(
  {
    /** MANAGER: requester's manager (`level` 2 = manager's manager). ROLE: anyone holding `role`. EMPLOYEE: one named person. */
    approverType: { type: String, enum: APPROVER_TYPES, required: true },
    level: { type: Number, min: 1, max: 5, default: 1 },
    role: { type: String, enum: APPROVAL_ROLES },
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee' },
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
