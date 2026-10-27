import type { RequestHandler } from 'express';

/**
 * Defence in depth against NoSQL operator injection: rejects any key beginning with `$`
 * or containing `.` in body, query and params. Zod schemas remain the primary control.
 */
function hasDangerousKey(value: unknown, depth = 0): boolean {
  if (depth > 20) return true;
  if (Array.isArray(value)) return value.some((v) => hasDangerousKey(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(
      ([k, v]) => k.startsWith('$') || k.includes('.') || hasDangerousKey(v, depth + 1),
    );
  }
  return false;
}

export const rejectOperatorInjection: RequestHandler = (req, res, next) => {
  if (hasDangerousKey(req.body) || hasDangerousKey(req.query) || hasDangerousKey(req.params)) {
    res.status(400).json({
      success: false,
      error: {
        code: 'BAD_REQUEST',
        message: 'Request contains disallowed characters in field names',
      },
      requestId: req.id,
    });
    return;
  }
  next();
};
