import { Schema } from 'mongoose';
import { tenantModel } from '../tenantModel';

/**
 * Bank and statutory identifiers, kept apart from the ordinary employee record so that no list, report or
 * serializer can leak them by accident. Fields ending in `Enc` hold AES-256-GCM ciphertext (see fieldCrypto).
 */
export const ENCRYPTED_FIELDS = [
  'accountNumber',
  'pan',
  'aadhaar',
  'uan',
  'pfNumber',
  'esiNumber',
] as const;
export type EncryptedField = (typeof ENCRYPTED_FIELDS)[number];
export const PLAIN_FIELDS = ['accountHolder', 'bankName', 'branch', 'ifsc'] as const;
export type PlainField = (typeof PLAIN_FIELDS)[number];

const employeeSensitiveSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    employeeId: { type: Schema.Types.ObjectId, required: true },
    accountHolder: { type: String, maxlength: 120 },
    bankName: { type: String, maxlength: 120 },
    branch: { type: String, maxlength: 120 },
    ifsc: { type: String, maxlength: 11 },
    accountNumberEnc: { type: String },
    panEnc: { type: String },
    aadhaarEnc: { type: String },
    uanEnc: { type: String },
    pfNumberEnc: { type: String },
    esiNumberEnc: { type: String },
    updatedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);
employeeSensitiveSchema.index({ tenantId: 1, employeeId: 1 }, { unique: true });
export const EmployeeSensitive = tenantModel('EmployeeSensitive', employeeSensitiveSchema);
