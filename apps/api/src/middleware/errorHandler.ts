import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { Logger } from 'pino';
import { redactSecrets } from '../database/hosting/errors';
import { AppError } from '../utils/errors';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` },
    requestId: req.id,
  });
};

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    if (err instanceof ZodError) {
      res.status(422).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
        requestId: req.id,
      });
      return;
    }
    if (err instanceof AppError) {
      res.status(err.statusCode).json({
        success: false,
        error: { code: err.code, message: err.message, details: err.details },
        requestId: req.id,
      });
      return;
    }
    // Malformed JSON bodies from express.json()
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as { type?: string }).type === 'entity.parse.failed'
    ) {
      res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Malformed JSON body' },
        requestId: req.id,
      });
      return;
    }
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as { type?: string }).type === 'entity.too.large'
    ) {
      res.status(413).json({
        success: false,
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' },
        requestId: req.id,
      });
      return;
    }
    // Unknown error: log full detail server-side, return a safe message.
    // Driver errors can echo a connection string: redact credentials before anything reaches the logs.
    const safe =
      err instanceof Error
        ? Object.assign(new Error(redactSecrets(err.message)), { name: err.name, stack: err.stack ? redactSecrets(err.stack) : undefined })
        : err;
    logger.error({ err: safe, requestId: req.id }, 'Unhandled error');
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
      requestId: req.id,
    });
  };
}
