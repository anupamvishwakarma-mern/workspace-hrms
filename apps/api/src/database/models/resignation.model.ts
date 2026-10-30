import { Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';

export const RESIGNATION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;

/** An employee's own resignation. Approval starts the notice period; HR ends employment when the last day arrives. */
const resignationSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    employeeId: { type: Schema.Types.ObjectId, required: true },
    requestedBy: { type: Schema.Types.ObjectId, required: true },
    proposedLastDay: { type: String, required: true }, // YYYY-MM-DD, company calendar
    reason: { type: String, maxlength: 2000 },
    status: { type: String, enum: RESIGNATION_STATUSES, default: 'PENDING' },
    approvalRequestId: { type: Schema.Types.ObjectId },
    decidedAt: { type: Date },
    decisionComment: { type: String, maxlength: 1000 },
    /** Set when approval could not start the notice period (e.g. the person had already left). */
    applyError: { type: String, maxlength: 300 },
  },
  { timestamps: true },
);
resignationSchema.index({ tenantId: 1, employeeId: 1, createdAt: -1 });
resignationSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
export const Resignation = tenantModel('Resignation', resignationSchema);
