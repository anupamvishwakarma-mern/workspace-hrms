import { InferSchemaType, Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';
import { EVENT_TYPES } from './attendanceEvent.model';

/** A punch that failed GPS/geofence checks and awaits an authorised decision. No event exists until approved. */
const attendanceExceptionSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    eventType: { type: String, enum: EVENT_TYPES, required: true },
    occurredAt: { type: Date, required: true }, // server time of the attempt
    clientTimestamp: { type: Date },
    failure: { type: String, required: true },
    distanceMeters: { type: Number },
    locationAccuracyMeters: { type: Number },
    /** Set when the retention job erased the coordinates; everything else about the record is kept. */
    locationPurgedAt: { type: Date },
    location: { type: { type: String, enum: ['Point'] }, coordinates: { type: [Number] } },
    workLocationId: { type: Schema.Types.ObjectId },
    mockLocationDetected: { type: Boolean, default: false },
    deviceId: { type: String },
    employeeReason: { type: String, required: true, maxlength: 500 },
    idempotencyKey: { type: String, required: true },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewComment: { type: String, maxlength: 1000 },
    reviewedAt: { type: Date },
    resultingEventId: { type: Schema.Types.ObjectId },
    photoId: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);
attendanceExceptionSchema.index(
  { tenantId: 1, employeeId: 1, idempotencyKey: 1 },
  { unique: true },
);
attendanceExceptionSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

export type AttendanceExceptionDoc = InferSchemaType<typeof attendanceExceptionSchema>;
export const AttendanceException = tenantModel('AttendanceException', attendanceExceptionSchema);
