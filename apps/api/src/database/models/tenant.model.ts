import { InferSchemaType, Schema, model } from 'mongoose';

const tenantSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    status: {
      type: String,
      enum: ['ACTIVE', 'SUSPENDED', 'CLOSED'],
      default: 'ACTIVE',
      index: true,
    },
    timezone: { type: String, required: true, default: 'UTC' },
    workweek: {
      type: [Number], // 0 = Sunday ... 6 = Saturday working days
      default: [1, 2, 3, 4, 5],
    },
    planId: { type: String, default: 'free' },
    /** This company's own MongoDB database (e.g. ACME_HRM). Absent = legacy company in the shared database. */
    dbName: { type: String, unique: true, sparse: true },
    /** Seat limit: the most non-terminated employees this company may have. Absent = unlimited (legacy). */
    maxEmployees: { type: Number, min: 1, max: 100000 },
    settings: {
      attendance: {
        requireGeofence: { type: Boolean, default: true },
        maxAccuracyMeters: { type: Number, default: 100 },
        allowSelfApproval: { type: Boolean, default: false },
        allowGpsExceptions: { type: Boolean, default: true },
        requirePhoto: { type: Boolean, default: false },
        maxOpenSessionHours: { type: Number, default: 16 },
      },
      payroll: {
        /** When true, whoever last generated a run cannot publish it. Off by default. */
        requireSeparatePublisher: { type: Boolean, default: false },
      },
    },
    branding: {
      logoUrl: { type: String },
      primaryColor: { type: String, default: '#2563eb' },
    },
  },
  { timestamps: true },
);

export type TenantDoc = InferSchemaType<typeof tenantSchema>;
export const Tenant = model('Tenant', tenantSchema);
