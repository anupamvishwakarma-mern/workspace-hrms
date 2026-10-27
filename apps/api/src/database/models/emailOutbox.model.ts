import { Schema, model } from 'mongoose';

/**
 * Local-development record of emails the system *would* send. Status is RECORDED_NOT_SENT
 * unless a real provider delivers it - never a fake "delivered".
 */
const emailOutboxSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId },
    to: { type: String, required: true },
    template: { type: String, required: true },
    subject: { type: String, required: true },
    link: { type: String },
    /** Short, non-sensitive failure reason (never the message body or link). */
    error: { type: String, maxlength: 300 },
    sentAt: { type: Date },
    status: {
      type: String,
      enum: ['RECORDED_NOT_SENT', 'QUEUED', 'SENT', 'FAILED'],
      default: 'RECORDED_NOT_SENT',
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
export const EmailOutbox = model('EmailOutbox', emailOutboxSchema);
