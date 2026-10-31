import { InferSchemaType, Schema, model } from 'mongoose';

/**
 * Append-only log of database-hosting events per company (connection attached/replaced/tested, health changes,
 * migrations). Lives in the control-plane database on purpose: it must stay writable and readable while a customer's
 * own database is down. Never holds connection strings or credentials.
 */
export const DB_EVENT_TYPES = [
  'PROVISIONED',
  'PROVISION_FAILED',
  'CONNECTION_TESTED',
  'CONNECTION_REPLACED',
  'CONNECTION_REPLACE_REJECTED',
  'HEALTH_CHANGED',
  'MIGRATION_STARTED',
  'MIGRATION_APPLIED',
  'MIGRATION_FAILED',
  'SECRET_ROTATED',
  'LIMITS_CHANGED',
] as const;
export type DbEventType = (typeof DB_EVENT_TYPES)[number];

const schema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    type: { type: String, enum: DB_EVENT_TYPES, required: true },
    ok: { type: Boolean, required: true },
    actorUserId: { type: Schema.Types.ObjectId },
    requestId: { type: String },
    /** Safe, small facts only (host count, database name, versions, error code). */
    detail: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
schema.index({ tenantId: 1, createdAt: -1 });

export type TenantDbEventDoc = InferSchemaType<typeof schema>;
export const TenantDbEvent = model('TenantDbEvent', schema);

export async function recordDbEvent(e: {
  tenantId: unknown;
  type: DbEventType;
  ok: boolean;
  actorUserId?: unknown;
  requestId?: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    await TenantDbEvent.create(e);
  } catch {
    /* logging must never break the operation it describes */
  }
}
