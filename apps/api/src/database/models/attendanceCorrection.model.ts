import { InferSchemaType, Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';

const attendanceCorrectionSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    workDate: { type: String, required: true },
    attendanceDayId: { type: Schema.Types.ObjectId },
    requestedChanges: { checkIn: { type: Date }, checkOut: { type: Date } },
    reason: { type: String, required: true, maxlength: 1000 },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewComment: { type: String, maxlength: 1000 },
    reviewedAt: { type: Date },
  },
  { timestamps: true },
);
attendanceCorrectionSchema.index({ tenantId: 1, employeeId: 1, workDate: 1, status: 1 });
attendanceCorrectionSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

export type AttendanceCorrectionDoc = InferSchemaType<typeof attendanceCorrectionSchema>;
export const AttendanceCorrection = tenantModel('AttendanceCorrection', attendanceCorrectionSchema);
