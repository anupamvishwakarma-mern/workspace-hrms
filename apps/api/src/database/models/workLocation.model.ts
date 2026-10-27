import { InferSchemaType, Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';

export const ATTENDANCE_METHODS = ['GEOFENCE', 'REMOTE', 'FIELD'] as const;

const workLocationSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    address: { type: String, maxlength: 300 },
    // GeoJSON order is [longitude, latitude].
    location: {
      type: { type: String, enum: ['Point'], required: true, default: 'Point' },
      coordinates: { type: [Number], required: true },
    },
    radiusMeters: { type: Number, required: true, min: 10, max: 5000, default: 100 },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
    allowedAttendanceMethods: {
      type: [{ type: String, enum: ATTENDANCE_METHODS }],
      default: ['GEOFENCE'],
    },
  },
  { timestamps: true },
);
workLocationSchema.index({ tenantId: 1, name: 1 }, { unique: true });
workLocationSchema.index({ location: '2dsphere' });

export type WorkLocationDoc = InferSchemaType<typeof workLocationSchema>;
export const WorkLocation = tenantModel('WorkLocation', workLocationSchema);
