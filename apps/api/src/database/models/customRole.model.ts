import { Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';

export const MAX_CUSTOM_ROLES = 20;
export const MAX_CUSTOM_ROLES_PER_PERSON = 3;

/** A company-defined bundle of permissions. Additive only: it never removes what a built-in role grants. */
const customRoleSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, trim: true, maxlength: 300 },
    permissions: { type: [String], default: [] },
    createdBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);
customRoleSchema.index({ tenantId: 1, name: 1 }, { unique: true });
export const CustomRole = tenantModel('CustomRole', customRoleSchema);
