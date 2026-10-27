import { Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';

const counterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});
export const Counter = tenantModel('Counter', counterSchema);

/** Atomic per-key sequence (e.g. employee codes per tenant). */
export async function nextSequence(key: string): Promise<number> {
  const doc = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  ).lean();
  return doc!.seq;
}
