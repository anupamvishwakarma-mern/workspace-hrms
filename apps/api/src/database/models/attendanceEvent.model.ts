import { InferSchemaType, Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';

export const EVENT_TYPES = ['CHECK_IN', 'CHECK_OUT', 'BREAK_START', 'BREAK_END'] as const;

const attendanceEventSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    eventType: { type: String, enum: EVENT_TYPES, required: true },
    /** Authoritative time: assigned by the server, never taken from the client. */
    occurredAt: { type: Date, required: true },
    receivedAt: { type: Date, required: true },
    clientTimestamp: { type: Date }, // diagnostics only
    workDate: { type: String, required: true }, // 'YYYY-MM-DD' in the employee's shift timezone
    shiftId: { type: Schema.Types.ObjectId },
    location: {
      type: { type: String, enum: ['Point'] },
      coordinates: { type: [Number] }, // [lng, lat]
    },
    locationAccuracyMeters: { type: Number },
    /** Set when the retention job erased the coordinates; everything else about the record is kept. */
    locationPurgedAt: { type: Date },
    workLocationId: { type: Schema.Types.ObjectId },
    verification: {
      status: {
        type: String,
        enum: ['VERIFIED', 'NOT_REQUIRED', 'EXCEPTION_APPROVED'],
        required: true,
      },
      method: { type: String },
      distanceMeters: { type: Number },
      riskSignals: { mockLocationDetected: { type: Boolean, default: false } },
    },
    deviceId: { type: String, maxlength: 100 },
    idempotencyKey: { type: String, required: true },
    source: { type: String, enum: ['MOBILE', 'WEB', 'EXCEPTION'], default: 'MOBILE' },
    exceptionId: { type: Schema.Types.ObjectId },
    /** Proof photo taken at the punch (when the company requires one); the image itself is in object storage. */
    photoId: { type: Schema.Types.ObjectId },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
attendanceEventSchema.index({ tenantId: 1, employeeId: 1, idempotencyKey: 1 }, { unique: true });
attendanceEventSchema.index({ tenantId: 1, employeeId: 1, occurredAt: -1 });
attendanceEventSchema.index({ tenantId: 1, employeeId: 1, workDate: 1 });

// Punches are an immutable ledger: corrections are separate records applied by the calculator.
const blocked = () => {
  throw new Error('AttendanceEvent records are immutable');
};
for (const op of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
] as const) {
  attendanceEventSchema.pre(op, blocked);
}
attendanceEventSchema.pre('save', function (next) {
  if (!this.isNew) return next(new Error('AttendanceEvent records are immutable'));
  next();
});

export type AttendanceEventDoc = InferSchemaType<typeof attendanceEventSchema>;
export const AttendanceEvent = tenantModel('AttendanceEvent', attendanceEventSchema);
