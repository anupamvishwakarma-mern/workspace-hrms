import { InferSchemaType, Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';

const stepSchema = new Schema(
  {
    order: { type: Number, required: true },
    approverType: { type: String, required: true },
    role: String,
    /** Employees allowed to act on this step, resolved when the step became current. */
    approverEmployeeIds: [{ type: Schema.Types.ObjectId, ref: 'Employee' }],
    status: { type: String, enum: ['WAITING', 'PENDING', 'APPROVED', 'REJECTED', 'SKIPPED'], default: 'WAITING' },
    actedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    actedByEmployeeId: { type: Schema.Types.ObjectId, ref: 'Employee' },
    /** Set when someone acted as a delegate of an approver. */
    onBehalfOfEmployeeId: { type: Schema.Types.ObjectId, ref: 'Employee' },
    actedAt: Date,
    comment: { type: String, maxlength: 1000 },
  },
  { _id: false },
);

const requestSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    workflowId: { type: Schema.Types.ObjectId, ref: 'ApprovalWorkflow', required: true },
    requestType: { type: String, required: true },
    title: { type: String, required: true, maxlength: 200 },
    /** Small, non-sensitive context for approvers. Never put secrets or bank/ID values here. */
    details: { type: Schema.Types.Mixed },
    requesterEmployeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    requesterUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'], default: 'PENDING' },
    currentStep: { type: Number, default: 0 },
    steps: [stepSchema],
    decidedAt: Date,
  },
  { timestamps: true },
);
requestSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
requestSchema.index({ tenantId: 1, requesterEmployeeId: 1, createdAt: -1 });
requestSchema.index({ tenantId: 1, 'steps.approverEmployeeIds': 1, status: 1 });

export type ApprovalRequestDoc = InferSchemaType<typeof requestSchema>;
export const ApprovalRequest = tenantModel('ApprovalRequest', requestSchema);

/** A person temporarily lets another employee act on their approvals. */
const delegationSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    delegatorEmployeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    delegateEmployeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    revokedAt: Date,
  },
  { timestamps: true },
);
delegationSchema.index({ tenantId: 1, delegateEmployeeId: 1, to: 1 });
delegationSchema.index({ tenantId: 1, delegatorEmployeeId: 1, to: -1 });
export const ApprovalDelegation = tenantModel('ApprovalDelegation', delegationSchema);
