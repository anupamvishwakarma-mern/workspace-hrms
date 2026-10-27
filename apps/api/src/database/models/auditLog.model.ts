import { InferSchemaType, Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';

const auditLogSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, index: true }, // absent for platform-level events
    actorUserId: { type: Schema.Types.ObjectId },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String },
    sanitizedBefore: { type: Schema.Types.Mixed },
    sanitizedAfter: { type: Schema.Types.Mixed },
    reason: { type: String },
    requestId: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditLogSchema.index({ tenantId: 1, createdAt: -1 });

// Audit records are append-only for the application: block every update/delete path.
const blocked = () => {
  throw new Error('AuditLog records are immutable');
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
  auditLogSchema.pre(op, blocked);
}
auditLogSchema.pre('save', function (next) {
  if (!this.isNew) return next(new Error('AuditLog records are immutable'));
  next();
});

export type AuditLogDoc = InferSchemaType<typeof auditLogSchema>;
export const AuditLog = tenantModel('AuditLog', auditLogSchema);
