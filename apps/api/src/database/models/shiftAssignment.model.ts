import { InferSchemaType, Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';

const shiftAssignmentSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    shiftId: { type: Schema.Types.ObjectId, ref: 'Shift', required: true },
    effectiveFrom: { type: String, required: true }, // 'YYYY-MM-DD' inclusive
    effectiveTo: { type: String }, // inclusive; open-ended when absent
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
shiftAssignmentSchema.index({ tenantId: 1, employeeId: 1, effectiveFrom: 1 });

export type ShiftAssignmentDoc = InferSchemaType<typeof shiftAssignmentSchema>;
export const ShiftAssignment = tenantModel('ShiftAssignment', shiftAssignmentSchema);
