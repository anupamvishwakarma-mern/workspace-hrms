import { InferSchemaType, Schema, Types, model } from 'mongoose';

export const TENANT_ROLES = [
  'COMPANY_OWNER',
  'HR_ADMIN',
  'MANAGER',
  'EMPLOYEE',
  'PAYROLL_ADMIN',
] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

const membershipSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    roles: { type: [{ type: String, enum: TENANT_ROLES }], default: ['EMPLOYEE'] },
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee' },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
  },
  { timestamps: true },
);
membershipSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
membershipSchema.index({ userId: 1, status: 1 });

export type MembershipDoc = InferSchemaType<typeof membershipSchema> & { _id: Types.ObjectId };
export const Membership = model('Membership', membershipSchema);
