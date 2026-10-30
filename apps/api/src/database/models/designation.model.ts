import { InferSchemaType, Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';

/** A job title / grade a company defines once and assigns to employees (e.g. "Senior Engineer", level 4). */
const designationSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    code: { type: String, trim: true, uppercase: true, maxlength: 20 },
    /** Optional seniority rank (higher = more senior). Used for display/sorting only, never for authorization. */
    level: { type: Number, min: 0, max: 100 },
    description: { type: String, maxlength: 1000 },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
  },
  { timestamps: true },
);
designationSchema.index({ tenantId: 1, title: 1 }, { unique: true });
// Partial: codes are optional, but when present they are unique per company.
designationSchema.index(
  { tenantId: 1, code: 1 },
  { unique: true, partialFilterExpression: { code: { $type: 'string' } } },
);

export type DesignationDoc = InferSchemaType<typeof designationSchema>;
export const Designation = tenantModel('Designation', designationSchema);
