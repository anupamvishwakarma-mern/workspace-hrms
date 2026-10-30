import { Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';
import { EMPLOYMENT_TYPES } from './employee.model';

export const JOB_STATUSES = ['DRAFT', 'OPEN', 'CLOSED'] as const;
export const CANDIDATE_STAGES = [
  'APPLIED',
  'SCREENING',
  'INTERVIEW',
  'OFFER',
  'HIRED',
  'REJECTED',
  'WITHDRAWN',
] as const;
export const OFFER_STATUSES = ['MADE', 'ACCEPTED', 'DECLINED'] as const;
export const RECOMMENDATIONS = ['STRONG_YES', 'YES', 'NO', 'STRONG_NO'] as const;

/** A position the company is hiring for. */
const jobSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    departmentId: { type: Schema.Types.ObjectId },
    designationId: { type: Schema.Types.ObjectId },
    hiringManagerId: { type: Schema.Types.ObjectId },
    employmentType: { type: String, enum: EMPLOYMENT_TYPES, default: 'FULL_TIME' },
    headcount: { type: Number, required: true, min: 1, max: 1000, default: 1 },
    description: { type: String, maxlength: 5000 },
    status: { type: String, enum: JOB_STATUSES, default: 'DRAFT' },
    openedAt: { type: Date },
    closedAt: { type: Date },
    closeReason: { type: String, maxlength: 300 },
    createdBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);
jobSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
export const JobOpening = tenantModel('JobOpening', jobSchema);

const interviewSchema = new Schema(
  {
    scheduledAt: { type: Date, required: true },
    interviewerId: { type: Schema.Types.ObjectId, required: true }, // an Employee
    mode: { type: String, enum: ['IN_PERSON', 'VIDEO', 'PHONE'], default: 'IN_PERSON' },
    round: { type: String, trim: true, maxlength: 60 },
    feedback: {
      rating: { type: Number, min: 1, max: 5 },
      recommendation: { type: String, enum: RECOMMENDATIONS },
      comment: { type: String, maxlength: 2000 },
      submittedAt: { type: Date },
    },
  },
  { timestamps: false },
);

/** A person applying for a job. Contact details are personal data: only people managing recruitment see them. */
const candidateSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    jobId: { type: Schema.Types.ObjectId, required: true },
    firstName: { type: String, required: true, trim: true, maxlength: 100 },
    lastName: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    phone: { type: String, trim: true, maxlength: 30 },
    source: { type: String, trim: true, maxlength: 60 },
    stage: { type: String, enum: CANDIDATE_STAGES, default: 'APPLIED' },
    rejectionReason: { type: String, maxlength: 300 },
    stageHistory: {
      type: [
        {
          from: String,
          to: String,
          at: Date,
          byUserId: Schema.Types.ObjectId,
          reason: String,
          _id: false,
        },
      ],
      default: [],
    },
    notes: {
      type: [{ text: { type: String, maxlength: 2000 }, byUserId: Schema.Types.ObjectId, at: Date }],
      default: [],
    },
    interviews: { type: [interviewSchema], default: [] },
    offer: {
      status: { type: String, enum: OFFER_STATUSES },
      designationId: { type: Schema.Types.ObjectId },
      proposedJoiningDate: { type: String }, // YYYY-MM-DD
      note: { type: String, maxlength: 1000 },
      madeAt: { type: Date },
      decidedAt: { type: Date },
    },
    /** Set while an employee record is being created from this candidate, so two clicks cannot hire twice. */
    hireClaimed: { type: Boolean },
    hiredEmployeeId: { type: Schema.Types.ObjectId },
    createdBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);
candidateSchema.index({ tenantId: 1, jobId: 1, email: 1 }, { unique: true });
candidateSchema.index({ tenantId: 1, stage: 1, createdAt: -1 });
candidateSchema.index({ tenantId: 1, 'interviews.interviewerId': 1 });
export const Candidate = tenantModel('Candidate', candidateSchema);
