import { InferSchemaType, Schema, model } from 'mongoose';

/** Password-reset and account-activation tokens. Only hashes are stored. */
const oneTimeTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    purpose: { type: String, enum: ['PASSWORD_RESET', 'ACTIVATION'], required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date },
  },
  { timestamps: true },
);
oneTimeTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

export type OneTimeTokenDoc = InferSchemaType<typeof oneTimeTokenSchema>;
export const OneTimeToken = model('OneTimeToken', oneTimeTokenSchema);
