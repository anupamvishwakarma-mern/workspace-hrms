import { InferSchemaType, Schema, model } from 'mongoose';
import { DB_HEALTH, DB_STATUSES, HOSTING_MODES } from '../hosting/types';

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
    /**
     * Where this company's HRMS data lives. Absent on companies created before hosting modes existed: those are
     * treated as MANAGED + READY. MANAGED databases are on our shared cluster (name in `dbName`, no per-tenant
     * connection string); CUSTOMER_OWNED databases are reached through the encrypted connection below.
     * Never serialise this object to clients except through the settings routes, which whitelist fields.
     */
    database: {
      hostingMode: { type: String, enum: HOSTING_MODES, default: 'MANAGED' },
      provider: { type: String, enum: ['MONGODB'], default: 'MONGODB' },
      status: { type: String, enum: DB_STATUSES, default: 'READY' },
      /** Managed cluster this tenant lives on (managed only). */
      clusterId: { type: String },
      /** The database name on the cluster (mirrors `dbName` for managed companies). */
      databaseName: { type: String },
      schemaVersion: { type: Number, min: 0 },
      connectionConfig: {
        /** AES-256-GCM ciphertext of the customer's connection string. Never selected by default, never returned. */
        encryptedConnectionString: { type: String, select: false },
        encryptionKeyVersion: { type: String, select: false },
        /** Hash of hosts + database name: one customer database can belong to only one company. */
        fingerprint: { type: String, unique: true, sparse: true, select: false },
        updatedAt: { type: Date },
      },
      health: { type: String, enum: DB_HEALTH, default: 'UNKNOWN' },
      lastConnectionCheck: { type: Date },
      lastSuccessfulConnection: { type: Date },
      lastFailureAt: { type: Date },
      lastError: { type: String, maxlength: 300 },
      lastErrorCode: { type: String, maxlength: 60 },
      consecutiveFailures: { type: Number, default: 0 },
      /** Next time the health job may probe this (customer) database: exponential backoff while failing. */
      nextCheckAt: { type: Date, index: true },
      lastMigration: {
        version: { type: Number },
        status: { type: String, enum: ['RUNNING', 'SUCCEEDED', 'FAILED'] },
        startedAt: { type: Date },
        finishedAt: { type: Date },
        error: { type: String, maxlength: 300 },
      },
      /** Platform-configured storage entitlement in MB (managed plans). Absent = no limit. */
      storageLimitMb: { type: Number, min: 1 },
    },
    /** Seat limit: the most non-terminated employees this company may have. Absent = unlimited (legacy). */
    maxEmployees: { type: Number, min: 1, max: 100000 },
    /** Modules the platform admin enabled for this company. Absent = all (older companies). */
    modules: { type: [String], default: undefined },
    settings: {
      attendance: {
        requireGeofence: { type: Boolean, default: true },
        maxAccuracyMeters: { type: Number, default: 100 },
        allowSelfApproval: { type: Boolean, default: false },
        allowGpsExceptions: { type: Boolean, default: true },
        requirePhoto: { type: Boolean, default: false },
        maxOpenSessionHours: { type: Number, default: 16 },
      },
      numbering: {
        employee: { prefix: { type: String }, padding: { type: Number } },
        letter: { prefix: { type: String }, padding: { type: Number } },
        document: { prefix: { type: String }, padding: { type: Number } },
      },
      leave: {
        /** When true, monthly accrual and year-end carry-forward run on their own. Off by default. */
        autoAccrual: { type: Boolean, default: false },
        /** 'YYYY-MM' (company time zone) when automation was switched on. Nothing earlier is processed. */
        autoSince: { type: String },
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
