import type { Types } from 'mongoose';
import type { Env } from '../../config/env';
import { OneTimeToken } from '../../database/models/oneTimeToken.model';
import { generateSecret, hmacToken } from '../../utils/security';

/** Creates a single-use token; supersedes earlier unused tokens of the same purpose. */
export async function issueOneTimeToken(
  env: Env,
  userId: Types.ObjectId,
  purpose: 'PASSWORD_RESET' | 'ACTIVATION',
  ttlMs: number,
): Promise<string> {
  await OneTimeToken.updateMany(
    { userId, purpose, usedAt: null },
    { $set: { usedAt: new Date() } },
  );
  const raw = generateSecret(32);
  await OneTimeToken.create({
    userId,
    purpose,
    tokenHash: hmacToken(raw, env.REFRESH_TOKEN_SECRET),
    expiresAt: new Date(Date.now() + ttlMs),
  });
  return raw;
}

/** Atomically consumes a token. Returns the userId, or null if invalid/expired/used. */
export async function consumeOneTimeToken(
  env: Env,
  raw: string,
  purpose: 'PASSWORD_RESET' | 'ACTIVATION',
): Promise<Types.ObjectId | null> {
  const doc = await OneTimeToken.findOneAndUpdate(
    {
      tokenHash: hmacToken(raw, env.REFRESH_TOKEN_SECRET),
      purpose,
      usedAt: null,
      expiresAt: { $gt: new Date() },
    },
    { $set: { usedAt: new Date() } },
  ).lean();
  return doc?.userId ?? null;
}
