import { Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';

export const DOCUMENT_CATEGORIES = [
  'ID_PROOF',
  'CONTRACT',
  'OFFER_LETTER',
  'CERTIFICATE',
  'TAX_FORM',
  'OTHER',
] as const;
export const DOCUMENT_STATUSES = ['PENDING_UPLOAD', 'AVAILABLE', 'DELETED'] as const;

/** Metadata only. The file lives in private object storage and is reached through short-lived signed URLs. */
const employeeDocumentSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    employeeId: { type: Schema.Types.ObjectId, required: true },
    category: { type: String, enum: DOCUMENT_CATEGORIES, required: true },
    title: { type: String, required: true, maxlength: 150 },
    fileName: { type: String, required: true, maxlength: 200 },
    contentType: { type: String, required: true, maxlength: 100 },
    sizeBytes: { type: Number, required: true, min: 1 },
    storageKey: { type: String, required: true },
    status: { type: String, enum: DOCUMENT_STATUSES, default: 'PENDING_UPLOAD' },
    visibleToEmployee: { type: Boolean, default: true },
    uploadedBy: { type: Schema.Types.ObjectId, required: true },
    availableAt: { type: Date },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
employeeDocumentSchema.index({ tenantId: 1, employeeId: 1, status: 1, createdAt: -1 });
employeeDocumentSchema.index({ status: 1, createdAt: 1 });
export const EmployeeDocument = tenantModel('EmployeeDocument', employeeDocumentSchema);
