import { ipKeyGenerator, rateLimit } from 'express-rate-limit';

const tooMany = (req: { id?: unknown }) => ({
  success: false,
  error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' },
  requestId: req.id,
});

export const createLimiter = (max: number, windowMs = 15 * 60 * 1000) =>
  rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json(tooMany(req));
    },
  });

/** Like createLimiter but counted per signed-in user (falls back to the client address). */
export const createUserLimiter = (max: number, windowMs = 60 * 60 * 1000) =>
  rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => (req.auth?.userId ? `u:${String(req.auth.userId)}` : ipKeyGenerator(req.ip ?? '')),
    handler: (req, res) => {
      res.status(429).json(tooMany(req));
    },
  });
