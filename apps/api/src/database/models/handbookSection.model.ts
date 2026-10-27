import { Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';

/** One chapter of the company handbook. Plain text with simple markup (see modules/handbook). */
const handbookSectionSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    title: { type: String, required: true, maxlength: 150 },
    body: { type: String, required: true, maxlength: 50000 },
    order: { type: Number, default: 0 },
    status: { type: String, enum: ['DRAFT', 'PUBLISHED'], default: 'DRAFT' },
    updatedBy: { type: Schema.Types.ObjectId },
    publishedAt: { type: Date },
  },
  { timestamps: true },
);
handbookSectionSchema.index({ tenantId: 1, status: 1, order: 1 });
export const HandbookSection = tenantModel('HandbookSection', handbookSectionSchema);
