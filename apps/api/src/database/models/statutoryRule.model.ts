import { Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';

export const RULE_PARTIES = ['EMPLOYEE', 'EMPLOYER'] as const;
export const RULE_METHODS = ['PERCENT', 'SLAB', 'FIXED'] as const;

/**
 * A statutory or policy contribution/deduction the company configures (provident fund, insurance,
 * professional tax, welfare fund, ...). The product ships NO rates, thresholds or slabs: the company
 * enters the figures from its own notifications and advisers, and records where they came from in
 * `reference`. A change is a new version with a later `effectiveFrom`; old payslips keep what applied then.
 */
const statutoryRuleSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    code: { type: String, required: true, uppercase: true, trim: true, maxlength: 20 },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    /** EMPLOYEE: deducted from pay. EMPLOYER: a cost to the company, shown on the payslip but not deducted. */
    party: { type: String, enum: RULE_PARTIES, required: true },
    method: { type: String, enum: RULE_METHODS, required: true },
    /** Earning component codes that make up the wage this rule is measured on. Empty = all earnings paid this month. */
    wageComponents: { type: [String], default: [] },
    /** PERCENT: percent x 100 (12% = 1200) of the wage, after the ceiling. */
    percentBp: { type: Number, min: 0, max: 10000 },
    /** PERCENT: the wage counted is never more than this (minor units). */
    wageCeilingMinor: { type: Number, min: 0 },
    /** PERCENT: the contribution is never more than this (minor units). */
    capMinor: { type: Number, min: 0 },
    /** SLAB: a fixed amount for the slab the wage falls in. `toMinor` is exclusive; absent = no upper limit. */
    slabs: {
      type: [{ fromMinor: Number, toMinor: Number, amountMinor: Number, _id: false }],
      default: [],
    },
    /** FIXED: the same amount every time the rule applies. */
    fixedMinor: { type: Number, min: 0 },
    /** The rule applies only when the wage is at least / at most this (minor units). */
    minWageMinor: { type: Number, min: 0 },
    maxWageMinor: { type: Number, min: 0 },
    /** Calendar months (1-12) in which the rule applies. Empty = every month. */
    months: { type: [Number], default: [] },
    /** Applies only to people working at one of these locations. Empty = everyone. */
    workLocationIds: { type: [Schema.Types.ObjectId], default: [] },
    effectiveFrom: { type: String, required: true }, // YYYY-MM-DD
    effectiveTo: { type: String },
    reference: { type: String, maxlength: 300 },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
    createdBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);
statutoryRuleSchema.index({ tenantId: 1, code: 1, effectiveFrom: 1 }, { unique: true });
export const StatutoryRule = tenantModel('StatutoryRule', statutoryRuleSchema);

/** A one-off addition or deduction for one person in one month (bonus, arrears, advance recovery, tax deducted, ...). */
const adjustmentSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    employeeId: { type: Schema.Types.ObjectId, required: true },
    month: { type: String, required: true }, // YYYY-MM
    kind: { type: String, enum: ['EARNING', 'DEDUCTION'], required: true },
    code: { type: String, default: 'ADJ', uppercase: true, maxlength: 20 },
    label: { type: String, required: true, maxlength: 80 },
    amountMinor: { type: Number, required: true, min: 1 },
    reason: { type: String, required: true, maxlength: 500 },
    status: { type: String, enum: ['ACTIVE', 'VOIDED'], default: 'ACTIVE' },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    voidedBy: { type: Schema.Types.ObjectId },
    voidedAt: { type: Date },
  },
  { timestamps: true },
);
adjustmentSchema.index({ tenantId: 1, month: 1, employeeId: 1 });
export const PayrollAdjustment = tenantModel('PayrollAdjustment', adjustmentSchema);
