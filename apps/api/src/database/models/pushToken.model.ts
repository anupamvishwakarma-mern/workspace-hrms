import { Schema, model } from 'mongoose';

/** A device that may receive pushes for a *user*. Tokens are bearer-like: never returned by any API. */
const pushTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    token: { type: String, required: true, unique: true, maxlength: 200 },
    platform: { type: String, enum: ['ios', 'android'], required: true },
    deviceId: { type: String, maxlength: 100 },
    lastSeenAt: { type: Date, required: true },
  },
  { timestamps: true },
);
export const PUSH_TOKEN_RE = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,60}\]$/;
export const PushToken = model('PushToken', pushTokenSchema);
