import { Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';

export const WFH_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;

/** Permission to work remotely on given days. While APPROVED, punches on those days need no office location. */
const wfhSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    employeeId: { type: Schema.Types.ObjectId, required: true },
    requestedBy: { type: Schema.Types.ObjectId, required: true },
    startDate: { type: String, required: true }, // YYYY-MM-DD inclusive, company calendar
    endDate: { type: String, required: true },
    reason: { type: String, maxlength: 1000 },
    status: { type: String, enum: WFH_STATUSES, default: 'PENDING' },
    approvalRequestId: { type: Schema.Types.ObjectId },
    decidedAt: { type: Date },
    decisionComment: { type: String, maxlength: 1000 },
  },
  { timestamps: true },
);
wfhSchema.index({ tenantId: 1, employeeId: 1, startDate: 1 });
wfhSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
export const WfhRequest = tenantModel('WfhRequest', wfhSchema);
