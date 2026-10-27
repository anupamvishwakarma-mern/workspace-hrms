import { Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';

const leaveTypeSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    paid: { type: Boolean, default: true },
    /** Days per calendar year (company time zone). 0 means no cap (tracked, not limited). */
    annualAllowanceDays: { type: Number, default: 0, min: 0, max: 366 },
    allowHalfDay: { type: Boolean, default: true },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
  },
  { timestamps: true },
);
leaveTypeSchema.index({ tenantId: 1, code: 1 }, { unique: true });
leaveTypeSchema.index({ tenantId: 1, name: 1 }, { unique: true });
export const LeaveType = tenantModel('LeaveType', leaveTypeSchema);
