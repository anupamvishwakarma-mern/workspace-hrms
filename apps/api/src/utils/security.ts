import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';

// Argon2id with OWASP-recommended minimums (19 MiB, t=2, p=1) raised to 64 MiB / t=3.
const ARGON_OPTS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
} as const;

export const hashPassword = (plain: string): Promise<string> => argon2.hash(plain, ARGON_OPTS);

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;
/** Verify against a dummy hash so unknown-email logins cost the same as real ones. */
export async function burnPasswordCheck(plain: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing');
  await verifyPassword(await dummyHash, plain);
}

export const generateSecret = (bytes = 32): string => randomBytes(bytes).toString('base64url');

/** Keyed hash for high-entropy tokens (refresh / reset / activation). */
export const hmacToken = (secret: string, key: string): string =>
  createHmac('sha256', key).update(secret).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
