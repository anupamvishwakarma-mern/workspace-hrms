import { Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';
import { COMPONENT_KINDS } from './salaryStructure.model';

export const RUN_STATUSES = ['DRAFT', 'PUBLISHED'] as const;

const payrollRunSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    month: { type: String, required: true }, // YYYY-MM
    status: { type: String, enum: RUN_STATUSES, default: 'DRAFT' },
    generatedBy: { type: Schema.Types.ObjectId, required: true },
    generatedAt: { type: Date, required: true },
    publishedBy: { type: Schema.Types.ObjectId },
    publishedAt: { type: Date },
    totals: {
      employees: { type: Number, default: 0 },
      grossMinor: { type: Number, default: 0 },
      deductionsMinor: { type: Number, default: 0 },
      netMinor: { type: Number, default: 0 },
      /** Employer-side statutory contributions: a company cost, not part of net pay. */
      employerMinor: { type: Number, default: 0 },
    },
    skipped: {
      type: [{ employeeId: Schema.Types.ObjectId, name: String, reason: String, _id: false }],
      default: [],
    },
  },
  { timestamps: true },
);
payrollRunSchema.index({ tenantId: 1, month: 1 }, { unique: true });
export const PayrollRun = tenantModel('PayrollRun', payrollRunSchema);

/** A calculated payslip. A DRAFT can be regenerated; once its run is PUBLISHED it is never changed. */
const payslipSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    runId: { type: Schema.Types.ObjectId, required: true },
    employeeId: { type: Schema.Types.ObjectId, required: true },
    month: { type: String, required: true },
    status: { type: String, enum: RUN_STATUSES, default: 'DRAFT' },
    structureId: { type: Schema.Types.ObjectId, required: true },
    currency: { type: String, required: true },
    employee: {
      code: String,
      name: String,
      designation: String,
      department: String,
    },
    attendance: {
      daysInMonth: Number,
      payableDays: Number,
      lopDays: Number,
      notEmployedDays: Number,
      presentDays: Number,
      halfDays: Number,
      absentDays: Number,
      paidLeaveDays: Number,
      unpaidLeaveDays: Number,
      holidays: Number,
      weeklyOffs: Number,
      incompleteDays: Number,
    },
    lines: {
      type: [
        {
          code: String,
          name: String,
          kind: { type: String, enum: COMPONENT_KINDS },
          fullMinor: Number, // the full-month amount
          amountMinor: Number, // what is actually paid/deducted this month
          source: { type: String, enum: ['STRUCTURE', 'ADJUSTMENT', 'STATUTORY'], default: 'STRUCTURE' },
          _id: false,
        },
      ],
      default: [],
    },
    /** Employer contributions computed from the company's statutory rules (not deducted from the employee). */
    employerLines: {
      type: [{ code: String, name: String, wageMinor: Number, amountMinor: Number, _id: false }],
      default: [],
    },
    employerMinor: { type: Number, default: 0 },
    grossMinor: { type: Number, required: true },
    deductionsMinor: { type: Number, required: true },
    netMinor: { type: Number, required: true },
    warnings: { type: [String], default: [] },
    publishedAt: { type: Date },
  },
  { timestamps: true },
);
payslipSchema.index({ tenantId: 1, runId: 1, employeeId: 1 }, { unique: true });
payslipSchema.index({ tenantId: 1, employeeId: 1, month: -1 });
export const Payslip = tenantModel('Payslip', payslipSchema);
