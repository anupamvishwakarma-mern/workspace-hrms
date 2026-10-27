import { InferSchemaType, Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';

const holidaySchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    date: { type: String, required: true }, // 'YYYY-MM-DD'
    workLocationId: { type: Schema.Types.ObjectId, ref: 'WorkLocation' }, // absent = company-wide
    holidayType: { type: String, enum: ['PUBLIC', 'COMPANY', 'OPTIONAL'], default: 'PUBLIC' },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
  },
  { timestamps: true },
);
holidaySchema.index({ tenantId: 1, date: 1 });

export type HolidayDoc = InferSchemaType<typeof holidaySchema>;
export const Holiday = tenantModel('Holiday', holidaySchema);
