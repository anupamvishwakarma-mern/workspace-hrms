import { Types } from 'mongoose';
import { enabledModules, moduleForPermission } from '../tenants/modules';
import type { Env } from '../../config/env';
import { Employee } from '../../database/models/employee.model';
import { runInTenant } from '../../database/tenantDb';
import { Membership } from '../../database/models/membership.model';
import { Session } from '../../database/models/session.model';
import { Tenant } from '../../database/models/tenant.model';
import { User } from '../../database/models/user.model';
import { signAccessToken } from '../../middleware/auth';
import { AppError } from '../../utils/errors';
import {
  burnPasswordCheck,
  generateSecret,
  hashPassword,
  hmacToken,
  safeEqual,
  verifyPassword,
} from '../../utils/security';
import { sendEmail } from '../notifications/email.service';
import { permissionsFor } from './permissions';
import { consumeOneTimeToken, issueOneTimeToken } from './token.service';

const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
const invalidRefresh = () =>
  new AppError(401, 'INVALID_REFRESH_TOKEN', 'Invalid or expired refresh token');

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

async function createSession(
  env: Env,
  userId: Types.ObjectId,
  meta: { deviceLabel?: string; ip?: string },
): Promise<SessionTokens> {
  const sessionId = new Types.ObjectId();
  const secret = generateSecret(48);
  await Session.create({
    _id: sessionId,
    userId,
    tokenHash: hmacToken(secret, env.REFRESH_TOKEN_SECRET),
    deviceLabel: meta.deviceLabel,
    ip: meta.ip,
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
  });
  return {
    accessToken: signAccessToken(env, String(userId), String(sessionId)),
    refreshToken: `${sessionId}.${secret}`,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  };
}

export async function listMemberships(userId: Types.ObjectId) {
  const memberships = await Membership.find({ userId, status: 'ACTIVE' }).lean();
  const tenants = await Tenant.find({ _id: { $in: memberships.map((m) => m.tenantId) } })
    .select('name slug status modules')
    .lean();
  return memberships.map((m) => {
    const t = tenants.find((x) => String(x._id) === String(m.tenantId));
    return {
      tenantId: String(m.tenantId),
      tenantName: t?.name,
      tenantSlug: t?.slug,
      tenantStatus: t?.status,
      roles: m.roles,
      // For hiding UI the person cannot use. Cosmetic only: the server re-checks every request.
      permissions: [...permissionsFor(m.roles)]
        .filter((p) => {
          const mod = moduleForPermission(p);
          return !mod || enabledModules(t?.modules).includes(mod);
        })
        .sort(),
      modules: enabledModules(t?.modules),
      employeeId: m.employeeId ? String(m.employeeId) : undefined,
    };
  });
}

export async function login(
  env: Env,
  input: { email: string; password: string; deviceLabel?: string },
  ip?: string,
) {
  const user = await User.findOne({ email: input.email.toLowerCase() }).select('+passwordHash');
  if (!user || !user.passwordHash || user.status !== 'ACTIVE') {
    await burnPasswordCheck(input.password);
    throw invalidCredentials();
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await burnPasswordCheck(input.password);
    throw invalidCredentials(); // generic on purpose: no account-state leakage
  }
  if (!(await verifyPassword(user.passwordHash, input.password))) {
    const updated = await User.findOneAndUpdate(
      { _id: user._id },
      { $inc: { failedLoginCount: 1 } },
      { new: true },
    );
    if (updated && updated.failedLoginCount >= env.LOGIN_MAX_FAILURES) {
      await User.updateOne(
        { _id: user._id },
        {
          $set: {
            lockedUntil: new Date(Date.now() + env.LOCKOUT_MINUTES * 60_000),
            failedLoginCount: 0,
          },
        },
      );
    }
    throw invalidCredentials();
  }
  await User.updateOne(
    { _id: user._id },
    { $set: { failedLoginCount: 0, lastLoginAt: new Date() }, $unset: { lockedUntil: 1 } },
  );
  const tokens = await createSession(env, user._id, { deviceLabel: input.deviceLabel, ip });
  return {
    tokens,
    user: { id: String(user._id), email: user.email, isPlatformAdmin: user.isPlatformAdmin },
    memberships: await listMemberships(user._id),
  };
}

function parseRefresh(token: string): { sessionId: string; secret: string } {
  const [sessionId, secret, ...rest] = token.split('.');
  if (!sessionId || !secret || rest.length || !Types.ObjectId.isValid(sessionId))
    throw invalidRefresh();
  return { sessionId, secret };
}

/** Rotates the refresh token. Presenting an already-rotated token revokes the whole session. */
export async function refresh(env: Env, token: string): Promise<SessionTokens> {
  const { sessionId, secret } = parseRefresh(token);
  const session = await Session.findById(sessionId);
  if (!session || session.revokedAt || session.expiresAt <= new Date()) throw invalidRefresh();
  const presented = hmacToken(secret, env.REFRESH_TOKEN_SECRET);

  if (session.previousTokenHash && safeEqual(presented, session.previousTokenHash)) {
    await Session.updateOne(
      { _id: session._id },
      { $set: { revokedAt: new Date(), revokedReason: 'REFRESH_TOKEN_REUSE' } },
    );
    throw invalidRefresh();
  }
  if (!safeEqual(presented, session.tokenHash)) throw invalidRefresh();

  const user = await User.findById(session.userId).select('status').lean();
  if (!user || user.status !== 'ACTIVE') throw invalidRefresh();

  const newSecret = generateSecret(48);
  // Compare-and-swap so two concurrent refreshes with the same token cannot both succeed.
  const rotated = await Session.findOneAndUpdate(
    { _id: session._id, tokenHash: session.tokenHash, revokedAt: null },
    {
      $set: {
        tokenHash: hmacToken(newSecret, env.REFRESH_TOKEN_SECRET),
        previousTokenHash: session.tokenHash,
        lastUsedAt: new Date(),
      },
    },
    { new: true },
  );
  if (!rotated) throw invalidRefresh();
  return {
    accessToken: signAccessToken(env, String(session.userId), String(session._id)),
    refreshToken: `${session._id}.${newSecret}`,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  };
}

export async function logout(env: Env, token: string): Promise<void> {
  try {
    const { sessionId, secret } = parseRefresh(token);
    const session = await Session.findById(sessionId);
    if (!session) return;
    const presented = hmacToken(secret, env.REFRESH_TOKEN_SECRET);
    if (
      safeEqual(presented, session.tokenHash) ||
      (session.previousTokenHash && safeEqual(presented, session.previousTokenHash))
    ) {
      await Session.updateOne(
        { _id: session._id, revokedAt: null },
        { $set: { revokedAt: new Date(), revokedReason: 'LOGOUT' } },
      );
    }
  } catch {
    /* logout is idempotent and never reveals token validity */
  }
}

export async function logoutAll(userId: Types.ObjectId): Promise<void> {
  await Session.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: 'LOGOUT_ALL' } },
  );
}

export async function listSessions(userId: Types.ObjectId, currentSessionId: Types.ObjectId) {
  const sessions = await Session.find({ userId, revokedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ lastUsedAt: -1 })
    .lean();
  return sessions.map((s) => ({
    id: String(s._id),
    deviceLabel: s.deviceLabel,
    lastUsedAt: s.lastUsedAt,
    createdAt: s.createdAt,
    current: String(s._id) === String(currentSessionId),
  }));
}

export async function revokeSession(userId: Types.ObjectId, sessionId: string): Promise<boolean> {
  const res = await Session.updateOne(
    { _id: sessionId, userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: 'USER_REVOKED' } },
  );
  return res.modifiedCount === 1;
}

export async function requestPasswordReset(env: Env, email: string): Promise<void> {
  const user = await User.findOne({ email: email.toLowerCase(), status: 'ACTIVE' }).lean();
  if (!user) return; // identical response either way (no enumeration)
  const raw = await issueOneTimeToken(
    env,
    user._id,
    'PASSWORD_RESET',
    env.RESET_TTL_MINUTES * 60_000,
  );
  await sendEmail(env, {
    to: user.email,
    template: 'PASSWORD_RESET',
    subject: 'Reset your password',
    link: `${env.WEB_APP_URL}/reset-password?token=${raw}`,
  });
}

export async function resetPassword(
  env: Env,
  token: string,
  newPassword: string,
): Promise<Types.ObjectId> {
  const userId = await consumeOneTimeToken(env, token, 'PASSWORD_RESET');
  if (!userId) throw new AppError(400, 'INVALID_TOKEN', 'Reset link is invalid or has expired');
  await User.updateOne(
    { _id: userId },
    {
      $set: { passwordHash: await hashPassword(newPassword), failedLoginCount: 0 },
      $unset: { lockedUntil: 1 },
    },
  );
  await logoutAll(userId); // a reset invalidates every existing session
  return userId;
}

export async function activateAccount(
  env: Env,
  token: string,
  password: string,
): Promise<Types.ObjectId> {
  const userId = await consumeOneTimeToken(env, token, 'ACTIVATION');
  if (!userId)
    throw new AppError(400, 'INVALID_TOKEN', 'Activation link is invalid or has expired');
  await User.updateOne(
    { _id: userId, status: { $ne: 'DISABLED' } },
    {
      $set: {
        passwordHash: await hashPassword(password),
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    },
  );
  // Each company keeps its employees in its own database, so activate the user's record in every company they belong to.
  const memberships = await Membership.find({ userId }).select('tenantId').lean();
  for (const m of memberships) {
    await runInTenant(m.tenantId, () =>
      Employee.updateMany(
        { tenantId: m.tenantId, userId, employmentStatus: 'INVITED' },
        {
          $set: { employmentStatus: 'ACTIVE' },
          $push: {
            history: {
              type: 'STATUS_CHANGE',
              from: 'INVITED',
              to: 'ACTIVE',
              reason: 'Account activated',
            },
          },
        },
      ),
    );
  }
  return userId;
}
