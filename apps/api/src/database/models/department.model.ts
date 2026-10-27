import { InferSchemaType, Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';

const departmentSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, maxlength: 1000 },
    headEmployeeId: { type: Schema.Types.ObjectId, ref: 'Employee' },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
  },
  { timestamps: true },
);
departmentSchema.index({ tenantId: 1, name: 1 }, { unique: true });

export type DepartmentDoc = InferSchemaType<typeof departmentSchema>;
export const Department = tenantModel('Department', departmentSchema);
