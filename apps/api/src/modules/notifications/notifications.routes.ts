import type { Router } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { PUSH_TOKEN_RE, PushToken } from '../../database/models/pushToken.model';
import { authenticate } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { route } from '../../utils/route';
import { validate } from '../../utils/validate';

const registerBody = z
  .object({
    token: z.string().regex(PUSH_TOKEN_RE, 'Not a valid Expo push token'),
    platform: z.enum(['ios', 'android']),
    deviceId: z.string().max(100).optional(),
  })
  .strict();
const removeBody = z.object({ token: z.string().max(200) }).strict();

export function registerNotificationRoutes(v1: Router, env: Env): void {
  route(
    v1,
    {
      method: 'post',
      path: '/me/push-tokens',
      summary:
        'Register this device for push notifications (re-registering moves it to the signed-in user).',
      tags: ['Notifications'],
      auth: 'user',
      body: registerBody,
    },
    authenticate(env),
    validate({ body: registerBody }),
    asyncHandler(async (req, res) => {
      // A device token belongs to whoever is signed in on it now: if a different user previously
      // registered the same token (shared phone), it moves to the current user.
      await PushToken.findOneAndUpdate(
        { token: req.body.token },
        {
          $set: {
            userId: req.auth!.userId,
            platform: req.body.platform,
            deviceId: req.body.deviceId,
            lastSeenAt: new Date(),
          },
        },
        { upsert: true },
      );
      res.status(204).end();
    }),
  );

  route(
    v1,
    {
      method: 'post',
      path: '/me/push-tokens/remove',
      summary:
        'Unregister this device (call on sign-out). Only removes tokens owned by the caller.',
      tags: ['Notifications'],
      auth: 'user',
      body: removeBody,
    },
    authenticate(env),
    validate({ body: removeBody }),
    asyncHandler(async (req, res) => {
      await PushToken.deleteOne({ token: req.body.token, userId: req.auth!.userId });
      res.status(204).end();
    }),
  );
}
