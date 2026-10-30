import { Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';

export const LEAVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;

const leaveRequestSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    employeeId: { type: Schema.Types.ObjectId, required: true },
    leaveTypeId: { type: Schema.Types.ObjectId, required: true },
    requestedBy: { type: Schema.Types.ObjectId, required: true }, // user id, from the session
    /** Company-local calendar dates (YYYY-MM-DD), inclusive. */
    startDate: { type: String, required: true },
    endDate: { type: String, required: true },
    halfDay: { type: Boolean, default: false },
    halfDaySession: { type: String, enum: ['FIRST', 'SECOND'] },
    /** Working days charged: weekly offs and holidays inside the range are not counted. */
    days: { type: Number, required: true, min: 0.5 },
    reason: { type: String, maxlength: 1000 },
    status: { type: String, enum: LEAVE_STATUSES, default: 'PENDING' },
    reviewedBy: { type: Schema.Types.ObjectId },
    reviewedAt: { type: Date },
    /** Set when the company has an active LEAVE approval workflow: that request decides this one. */
    approvalRequestId: { type: Schema.Types.ObjectId },
    reviewComment: { type: String, maxlength: 1000 },
  },
  { timestamps: true },
);
leaveRequestSchema.index({ tenantId: 1, employeeId: 1, startDate: 1 });
leaveRequestSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
export const LeaveRequest = tenantModel('LeaveRequest', leaveRequestSchema);
