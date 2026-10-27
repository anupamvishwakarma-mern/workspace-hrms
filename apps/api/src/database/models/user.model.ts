import { InferSchemaType, Schema, model } from 'mongoose';

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, select: false },
    status: {
      type: String,
      enum: ['INVITED', 'ACTIVE', 'DISABLED'],
      default: 'INVITED',
      index: true,
    },
    // Platform-level capability; deliberately NOT a tenant role.
    isPlatformAdmin: { type: Boolean, default: false },
    emailVerifiedAt: { type: Date },
    lastLoginAt: { type: Date },
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date },
  },
  { timestamps: true },
);

export type UserDoc = InferSchemaType<typeof userSchema>;
export const User = model('User', userSchema);
