import { InferSchemaType, Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';

export const EMPLOYMENT_STATUSES = [
  'INVITED',
  'ACTIVE',
  'ON_LEAVE',
  'NOTICE_PERIOD',
  'TERMINATED',
] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];
export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'] as const;

const employeeSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    employeeCode: { type: String, required: true, trim: true, maxlength: 40 },
    firstName: { type: String, required: true, trim: true, maxlength: 100 },
    lastName: { type: String, required: true, trim: true, maxlength: 100 },
    workEmail: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, maxlength: 30 },
    profileImage: { type: String },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department' },
    designation: { type: String, maxlength: 120 },
    managerId: { type: Schema.Types.ObjectId, ref: 'Employee' },
    employmentType: { type: String, enum: EMPLOYMENT_TYPES, default: 'FULL_TIME' },
    employmentStatus: { type: String, enum: EMPLOYMENT_STATUSES, default: 'INVITED' },
    // OFFICE = geofence rules apply; FIELD = good GPS fix required, no fence; REMOTE = location optional.
    attendanceMode: { type: String, enum: ['OFFICE', 'FIELD', 'REMOTE'], default: 'OFFICE' },
    joiningDate: { type: Date },
    confirmationDate: { type: Date },
    noticePeriodStartDate: { type: Date },
    lastWorkingDate: { type: Date },
    workLocationIds: { type: [Schema.Types.ObjectId], default: [] },
    emergencyContacts: {
      type: [{ name: String, relationship: String, phone: String }],
      default: [],
    },
    address: {
      line1: String,
      line2: String,
      city: String,
      state: String,
      postalCode: String,
      country: String,
    },
    // Lifecycle history: status changes, transfers, manager changes.
    history: {
      type: [
        {
          at: { type: Date, default: Date.now },
          type: { type: String, required: true },
          from: String,
          to: String,
          byUserId: Schema.Types.ObjectId,
          reason: String,
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);
employeeSchema.index({ tenantId: 1, employeeCode: 1 }, { unique: true });
employeeSchema.index({ tenantId: 1, workEmail: 1 }, { unique: true });
employeeSchema.index({ tenantId: 1, managerId: 1 });
employeeSchema.index({ tenantId: 1, departmentId: 1 });
employeeSchema.index({ tenantId: 1, employmentStatus: 1 });

export type EmployeeDoc = InferSchemaType<typeof employeeSchema>;
export const Employee = tenantModel('Employee', employeeSchema);
