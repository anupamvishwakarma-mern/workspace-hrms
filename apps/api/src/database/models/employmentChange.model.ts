import { Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';

export const CHANGE_TYPES = ['PROMOTION', 'TRANSFER', 'SALARY_REVISION'] as const;

const side = new Schema(
  {
    designation: String,
    departmentId: Schema.Types.ObjectId,
    department: String,
    managerId: Schema.Types.ObjectId,
    manager: String,
    workLocationIds: { type: [Schema.Types.ObjectId], default: undefined },
  },
  { _id: false },
);

/**
 * A dated, explained change in someone's role: promotion, transfer or salary revision.
 * The change is applied to the employee record when it is recorded; this is the permanent trail.
 * Salary revisions carry no amounts here: the new pay is a new salary structure under Payroll.
 */
const employmentChangeSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    employeeId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, enum: CHANGE_TYPES, required: true },
    effectiveDate: { type: String, required: true }, // YYYY-MM-DD
    reason: { type: String, required: true, maxlength: 500 },
    before: { type: side },
    after: { type: side },
    recordedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);
employmentChangeSchema.index({ tenantId: 1, employeeId: 1, effectiveDate: -1, createdAt: -1 });
export const EmploymentChange = tenantModel('EmploymentChange', employmentChangeSchema);
