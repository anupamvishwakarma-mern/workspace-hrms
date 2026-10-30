import { Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';

export const PROFILE_KINDS = ['QUALIFICATION', 'EXPERIENCE', 'SKILL', 'CERTIFICATION'] as const;
export const SKILL_LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'] as const;

/**
 * One line of an employee's profile: a qualification, a previous job, a skill or a certification.
 * `title` is the degree, job title, skill or certificate name; `organization` the institution, employer or issuer.
 */
const profileItemSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    employeeId: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, enum: PROFILE_KINDS, required: true },
    title: { type: String, required: true, trim: true, maxlength: 150 },
    organization: { type: String, trim: true, maxlength: 150 },
    fromDate: { type: String }, // YYYY-MM-DD (issue date for certifications)
    toDate: { type: String }, // YYYY-MM-DD (expiry date for certifications)
    level: { type: String, enum: SKILL_LEVELS },
    credentialId: { type: String, trim: true, maxlength: 80 },
    notes: { type: String, maxlength: 1000 },
    /** Set by HR after checking the evidence. Any edit by the employee clears it. */
    verifiedBy: { type: Schema.Types.ObjectId },
    verifiedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);
profileItemSchema.index({ tenantId: 1, employeeId: 1, kind: 1, fromDate: -1 });
export const ProfileItem = tenantModel('ProfileItem', profileItemSchema);
