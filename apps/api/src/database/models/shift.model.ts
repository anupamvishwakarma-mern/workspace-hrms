import { InferSchemaType, Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';

const shiftSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    /**
     * FIXED: lateness and early departure are measured against start/end.
     * FLEXIBLE: no lateness or early-departure marks; the day counts by hours worked (minFullDayMinutes is required).
     */
    shiftType: { type: String, enum: ['FIXED', 'FLEXIBLE'], default: 'FIXED' },
    startTime: { type: String, required: true }, // 'HH:mm' wall-clock in the shift timezone
    endTime: { type: String, required: true }, // end <= start means the shift ends the next day
    timezone: { type: String }, // defaults to the tenant timezone
    graceMinutes: { type: Number, default: 0, min: 0, max: 240 },
    earlyDepartureGraceMinutes: { type: Number, default: 0, min: 0, max: 240 },
    minFullDayMinutes: { type: Number, min: 1, max: 1440 },
    minHalfDayMinutes: { type: Number, min: 1, max: 1440 },
    breakPolicy: {
      type: { type: String, enum: ['RECORDED', 'AUTO_DEDUCT'], default: 'RECORDED' },
      paidAllowanceMinutes: { type: Number, default: 0, min: 0, max: 480 },
      autoDeductMinutes: { type: Number, default: 0, min: 0, max: 480 },
      expectedUnpaidMinutes: { type: Number, default: 0, min: 0, max: 480 },
    },
    weeklyOffDays: { type: [Number], default: [0] },
    overtimePolicy: {
      enabled: { type: Boolean, default: false },
      thresholdMinutes: { type: Number, default: 0, min: 0, max: 600 },
      maxMinutesPerDay: { type: Number, min: 1, max: 1440 },
    },
    effectiveFrom: { type: String }, // 'YYYY-MM-DD'
    effectiveTo: { type: String },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
  },
  { timestamps: true },
);
shiftSchema.index({ tenantId: 1, name: 1 }, { unique: true });

export type ShiftDoc = InferSchemaType<typeof shiftSchema>;
export const Shift = tenantModel('Shift', shiftSchema);
