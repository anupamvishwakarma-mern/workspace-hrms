import { InferSchemaType, Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';

export const DAY_STATUSES = [
  'PRESENT',
  'HALF_DAY',
  'ABSENT',
  'ON_LEAVE',
  'HOLIDAY',
  'WEEKLY_OFF',
  'INCOMPLETE',
] as const;

const attendanceDaySchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    workDate: { type: String, required: true },
    shiftId: { type: Schema.Types.ObjectId },
    firstCheckIn: { type: Date },
    lastCheckOut: { type: Date },
    workedMinutes: { type: Number, default: 0 },
    breakMinutes: { type: Number, default: 0 },
    unpaidBreakMinutes: { type: Number, default: 0 },
    overtimeMinutes: { type: Number, default: 0 },
    lateMinutes: { type: Number, default: 0 },
    earlyDepartureMinutes: { type: Number, default: 0 },
    scheduledMinutes: { type: Number, default: 0 },
    status: { type: String, enum: DAY_STATUSES, required: true },
    isOpen: { type: Boolean, default: false },
    calculationVersion: { type: Number, required: true },
    correctionStatus: { type: String, enum: ['NONE', 'PENDING', 'APPLIED'], default: 'NONE' },
    sessions: {
      type: [{ start: Date, end: Date, breakMinutes: Number, open: Boolean, _id: false }],
      default: [],
    },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);
attendanceDaySchema.index({ tenantId: 1, employeeId: 1, workDate: 1 }, { unique: true });
attendanceDaySchema.index({ tenantId: 1, workDate: 1, status: 1 });

export type AttendanceDayDoc = InferSchemaType<typeof attendanceDaySchema>;
export const AttendanceDay = tenantModel('AttendanceDay', attendanceDaySchema);
