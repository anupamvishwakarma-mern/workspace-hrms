import { Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';

export const LETTER_CATEGORIES = [
  'OFFER',
  'APPOINTMENT',
  'CONFIRMATION',
  'EXPERIENCE',
  'SALARY_CERTIFICATE',
  'ADDRESS_PROOF',
  'OTHER',
] as const;

/** Reusable wording with {{placeholders}}; the placeholders are filled when a letter is issued. */
const letterTemplateSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    title: { type: String, required: true, maxlength: 150 },
    category: { type: String, enum: LETTER_CATEGORIES, required: true },
    body: { type: String, required: true, maxlength: 20000 },
    status: { type: String, enum: ['ACTIVE', 'ARCHIVED'], default: 'ACTIVE' },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);
letterTemplateSchema.index({ tenantId: 1, status: 1, title: 1 });
export const LetterTemplate = tenantModel('LetterTemplate', letterTemplateSchema);

/** An issued letter keeps the exact text that was issued. Only its status can change (revoked). */
const issuedLetterSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    employeeId: { type: Schema.Types.ObjectId, required: true },
    templateId: { type: Schema.Types.ObjectId },
    referenceNo: { type: String, required: true },
    title: { type: String, required: true, maxlength: 150 },
    category: { type: String, enum: LETTER_CATEGORIES, required: true },
    body: { type: String, required: true, maxlength: 30000 },
    status: { type: String, enum: ['ISSUED', 'REVOKED'], default: 'ISSUED' },
    issuedBy: { type: Schema.Types.ObjectId, required: true },
    issuedAt: { type: Date, required: true },
    revokedAt: { type: Date },
    revokeReason: { type: String, maxlength: 300 },
  },
  { timestamps: true },
);
issuedLetterSchema.index({ tenantId: 1, referenceNo: 1 }, { unique: true });
issuedLetterSchema.index({ tenantId: 1, employeeId: 1, issuedAt: -1 });
export const IssuedLetter = tenantModel('IssuedLetter', issuedLetterSchema);
