import type { CookieOptions, Request, Response, Router } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { authenticate } from '../../middleware/auth';
import { createLimiter } from '../../middleware/rateLimit';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/errors';
import { route } from '../../utils/route';
import { idParams, validate } from '../../utils/validate';
import { User } from '../../database/models/user.model';
import { writeAudit } from '../audit/audit.service';
import * as svc from './auth.service';

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain letters and digits');

const loginBody = z
  .object({
    email: z.string().email().max(254),
    password: z.string().min(1).max(128),
    deviceLabel: z.string().max(200).optional(),
  })
  .strict();
const refreshBody = z.object({ refreshToken: z.string().max(400).optional() }).strict();
const forgotBody = z.object({ email: z.string().email().max(254) }).strict();
const resetBody = z
  .object({ token: z.string().min(10).max(200), password: passwordSchema })
  .strict();

const COOKIE = 'refresh_token';
const isWeb = (req: Request) => req.header('x-client-type') === 'web';

export function registerAuthRoutes(v1: Router, env: Env): void {
  const cookieOpts = (): CookieOptions => ({
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/v1/auth',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  });
  const loginLimiter = createLimiter(env.RATE_LIMIT_LOGIN_MAX);
  const sensitiveLimiter = createLimiter(env.RATE_LIMIT_SENSITIVE_MAX);
  const auth = authenticate(env);

  const sendTokens = (
    req: Request,
    res: Response,
    tokens: svc.SessionTokens,
    extra: object = {},
  ) => {
    if (isWeb(req)) {
      res.cookie(COOKIE, tokens.refreshToken, cookieOpts());
      res.json({
        success: true,
        data: { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn, ...extra },
      });
    } else {
      res.json({ success: true, data: { ...tokens, ...extra } });
    }
  };
  const refreshTokenFrom = (req: Request): string | undefined =>
    (req.body as { refreshToken?: string }).refreshToken ??
    (req.cookies as Record<string, string> | undefined)?.[COOKIE];

  route(
    v1,
    {
      method: 'post',
      path: '/auth/login',
      summary:
        'Email/password login. Send X-Client-Type: web to receive the refresh token as an HttpOnly cookie.',
      tags: ['Auth'],
      auth: 'none',
      body: loginBody,
    },
    loginLimiter,
    validate({ body: loginBody }),
    asyncHandler(async (req, res) => {
      const result = await svc.login(env, req.body, req.ip);
      sendTokens(req, res, result.tokens, { user: result.user, memberships: result.memberships });
    }),
  );

  route(
    v1,
    {
      method: 'post',
      path: '/auth/refresh',
      summary: 'Rotate the refresh token and obtain a new access token.',
      tags: ['Auth'],
      auth: 'none',
      body: refreshBody,
    },
    loginLimiter,
    validate({ body: refreshBody }),
    asyncHandler(async (req, res) => {
      const token = refreshTokenFrom(req);
      if (!token)
        throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Invalid or expired refresh token');
      try {
        sendTokens(req, res, await svc.refresh(env, token));
      } catch (err) {
        if (isWeb(req)) res.clearCookie(COOKIE, { path: '/api/v1/auth' });
        throw err;
      }
    }),
  );

  route(
    v1,
    {
      method: 'post',
      path: '/auth/logout',
      summary: 'Revoke the session identified by the refresh token.',
      tags: ['Auth'],
      auth: 'none',
      body: refreshBody,
    },
    validate({ body: refreshBody }),
    asyncHandler(async (req, res) => {
      const token = refreshTokenFrom(req);
      if (token) await svc.logout(env, token);
      res.clearCookie(COOKIE, { path: '/api/v1/auth' });
      res.json({ success: true, data: { loggedOut: true } });
    }),
  );

  route(
    v1,
    {
      method: 'post',
      path: '/auth/logout-all',
      summary: 'Revoke every session of the current user.',
      tags: ['Auth'],
      auth: 'user',
    },
    auth,
    asyncHandler(async (req, res) => {
      await svc.logoutAll(req.auth!.userId);
      await writeAudit(req, {
        action: 'auth.logout_all',
        entityType: 'User',
        entityId: req.auth!.userId,
      });
      res.clearCookie(COOKIE, { path: '/api/v1/auth' });
      res.json({ success: true, data: { loggedOut: true } });
    }),
  );

  route(
    v1,
    {
      method: 'post',
      path: '/auth/forgot-password',
      summary: 'Request a password-reset link. Always returns 202 to avoid account enumeration.',
      tags: ['Auth'],
      auth: 'none',
      body: forgotBody,
      successStatus: 202,
    },
    sensitiveLimiter,
    validate({ body: forgotBody }),
    asyncHandler(async (req, res) => {
      await svc.requestPasswordReset(env, req.body.email);
      res.status(202).json({
        success: true,
        data: { message: 'If the account exists, a reset link has been issued.' },
      });
    }),
  );

  route(
    v1,
    {
      method: 'post',
      path: '/auth/reset-password',
      summary: 'Set a new password using a single-use reset token. Revokes all sessions.',
      tags: ['Auth'],
      auth: 'none',
      body: resetBody,
    },
    sensitiveLimiter,
    validate({ body: resetBody }),
    asyncHandler(async (req, res) => {
      const userId = await svc.resetPassword(env, req.body.token, req.body.password);
      await writeAudit(req, {
        action: 'auth.password_reset',
        entityType: 'User',
        entityId: userId,
        actorUserId: userId,
      });
      res.json({ success: true, data: { passwordReset: true } });
    }),
  );

  route(
    v1,
    {
      method: 'post',
      path: '/auth/activate',
      summary:
        'Activate an invited account by setting a password with a single-use activation token.',
      tags: ['Auth'],
      auth: 'none',
      body: resetBody,
    },
    sensitiveLimiter,
    validate({ body: resetBody }),
    asyncHandler(async (req, res) => {
      const userId = await svc.activateAccount(env, req.body.token, req.body.password);
      await writeAudit(req, {
        action: 'auth.account_activated',
        entityType: 'User',
        entityId: userId,
        actorUserId: userId,
      });
      res.json({ success: true, data: { activated: true } });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/auth/me',
      summary: 'Current user and active company memberships.',
      tags: ['Auth'],
      auth: 'user',
    },
    auth,
    asyncHandler(async (req, res) => {
      res.json({
        success: true,
        data: {
          userId: String(req.auth!.userId),
          email: (await User.findById(req.auth!.userId).select('email').lean())?.email,
          isPlatformAdmin: req.auth!.isPlatformAdmin,
          memberships: await svc.listMemberships(req.auth!.userId),
        },
      });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/auth/sessions',
      summary: 'List active sessions/devices of the current user.',
      tags: ['Auth'],
      auth: 'user',
    },
    auth,
    asyncHandler(async (req, res) => {
      res.json({
        success: true,
        data: await svc.listSessions(req.auth!.userId, req.auth!.sessionId),
      });
    }),
  );

  route(
    v1,
    {
      method: 'delete',
      path: '/auth/sessions/:id',
      summary: "Revoke one of the current user's sessions.",
      tags: ['Auth'],
      auth: 'user',
    },
    auth,
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      if (!(await svc.revokeSession(req.auth!.userId, String(req.params.id))))
        throw AppError.notFound('Session not found');
      res.json({ success: true, data: { revoked: true } });
    }),
  );
}
