import { Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';

export const PUNCH_PHOTO_STATUSES = ['PENDING_UPLOAD', 'USED', 'DELETED'] as const;

/**
 * Metadata for a proof photo taken at a punch. The image lives in private object storage and is reached only
 * through short-lived signed URLs. The (immutable) punch stores just the photo id; the photo record is the only
 * mutable part, so retention can erase the image without touching the attendance ledger.
 */
const punchPhotoSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    employeeId: { type: Schema.Types.ObjectId, required: true },
    contentType: { type: String, required: true },
    sizeBytes: { type: Number, required: true, min: 1 },
    storageKey: { type: String, required: true },
    status: { type: String, enum: PUNCH_PHOTO_STATUSES, default: 'PENDING_UPLOAD' },
    usedAt: { type: Date },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
punchPhotoSchema.index({ tenantId: 1, employeeId: 1, status: 1 });
punchPhotoSchema.index({ status: 1, createdAt: 1 });
export const PunchPhoto = tenantModel('PunchPhoto', punchPhotoSchema);
