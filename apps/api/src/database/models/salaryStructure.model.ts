import { Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';

export const COMPONENT_KINDS = ['EARNING', 'DEDUCTION'] as const;
export const COMPONENT_CALCS = ['FIXED', 'PERCENT_OF_BASIC'] as const;

/**
 * One version of an employee's monthly pay breakdown. Versions are never edited: a change is a new record with a
 * later `effectiveFrom`, so old payslips can always be explained. Money is stored in minor units (paise/cents) as
 * integers; PERCENT_OF_BASIC values are percent x 100 (12.5% = 1250).
 */
const salaryStructureSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    employeeId: { type: Schema.Types.ObjectId, required: true },
    effectiveFrom: { type: String, required: true }, // YYYY-MM-DD; applies from the month containing it
    currency: { type: String, required: true, default: 'INR', maxlength: 3 },
    components: {
      type: [
        {
          code: { type: String, required: true, maxlength: 20 },
          name: { type: String, required: true, maxlength: 80 },
          kind: { type: String, enum: COMPONENT_KINDS, required: true },
          calc: { type: String, enum: COMPONENT_CALCS, required: true },
          value: { type: Number, required: true, min: 0 },
          prorate: { type: Boolean, default: true },
          _id: false,
        },
      ],
      required: true,
    },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    note: { type: String, maxlength: 300 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
salaryStructureSchema.index({ tenantId: 1, employeeId: 1, effectiveFrom: -1 });
export const SalaryStructure = tenantModel('SalaryStructure', salaryStructureSchema);
