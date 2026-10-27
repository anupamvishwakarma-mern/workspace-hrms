import { rateLimit } from 'express-rate-limit';

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
