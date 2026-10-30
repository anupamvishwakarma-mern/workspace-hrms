import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Field-level encryption (AES-256-GCM) for identifiers such as PAN, Aadhaar and bank account numbers.
 * Format: `v1.<iv>.<tag>.<ciphertext>` (base64url). The record's identity is bound in as additional authenticated
 * data, so a ciphertext copied onto another employee or field fails to decrypt. The `v1` prefix leaves room for key
 * rotation later (not implemented yet).
 */
const VERSION = 'v1';

/** Accepts 64 hex characters or a base64 string that decodes to exactly 32 bytes. */
export function parseEncryptionKey(raw: string): Buffer {
  const text = raw.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(text)
    ? Buffer.from(text, 'hex')
    : Buffer.from(text, 'base64');
  if (key.length !== 32)
    throw new Error('FIELD_ENCRYPTION_KEY must be 32 bytes (64 hex characters or base64)');
  return key;
}

export function encryptField(plain: string, key: Buffer, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const parts = [iv, cipher.getAuthTag(), ct].map((b) => b.toString('base64url'));
  return `${VERSION}.${parts.join('.')}`;
}

export function decryptField(payload: string, key: Buffer, context: string): string {
  const [version, iv, tag, ct] = payload.split('.');
  if (version !== VERSION || !iv || !tag || ct === undefined)
    throw new Error('Unsupported encrypted field format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString(
    'utf8',
  );
}

/** Shows only the last four characters, e.g. `XXXXXXXX1234`. Short values are fully masked. */
export function maskValue(value: string): string {
  if (value.length <= 4) return 'X'.repeat(value.length);
  return 'X'.repeat(value.length - 4) + value.slice(-4);
}
