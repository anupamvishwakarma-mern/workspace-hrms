import { Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';

export const LEDGER_KINDS = ['ACCRUAL', 'CARRY_FORWARD', 'ADJUSTMENT'] as const;

/**
 * Append-only record of leave credited to (or taken back from) an employee for one leave year.
 * Entries are never edited or deleted: a mistake is corrected by a new ADJUSTMENT.
 */
const ledgerSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    employeeId: { type: Schema.Types.ObjectId, required: true },
    leaveTypeId: { type: Schema.Types.ObjectId, required: true },
    /** The leave year this entry counts toward (company calendar year). */
    year: { type: Number, required: true },
    kind: { type: String, enum: LEDGER_KINDS, required: true },
    /** Signed days, in half-day steps. */
    days: { type: Number, required: true },
    /** 'YYYY-MM' for accruals, 'YYYY' (the year carried from) for carry-forward. */
    period: { type: String },
    reason: { type: String, maxlength: 500 },
    createdBy: { type: Schema.Types.ObjectId }, // user id; absent for system runs
    /** Makes system runs idempotent: one entry per employee, type, kind and period. */
    key: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
ledgerSchema.index({ tenantId: 1, employeeId: 1, leaveTypeId: 1, year: 1 });
ledgerSchema.index(
  { tenantId: 1, key: 1 },
  { unique: true, partialFilterExpression: { key: { $type: 'string' } } },
);
export const LeaveLedger = tenantModel('LeaveLedger', ledgerSchema);
