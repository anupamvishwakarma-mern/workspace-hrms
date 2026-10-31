import { NextResponse, type NextRequest } from 'next/server';
import type { z } from 'zod';
import { rateLimit } from '@/lib/rate-limit';

export const MAX_BODY_BYTES = 16 * 1024;
/** A human cannot fill a form in under this many ms. Bots usually can. */
export const MIN_FILL_MS = 2500;

export interface GuardOptions {
  bucket: string;
  max: number;
  windowMs: number;
}

export const fail = (
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
  headers?: Record<string, string>,
) =>
  NextResponse.json(
    { ok: false, code, message, ...extra },
    { status, headers: { 'Cache-Control': 'no-store', ...headers } },
  );

export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  return (fwd?.split(',')[0] ?? req.headers.get('x-real-ip') ?? 'unknown').trim();
}

/** Same-origin check (CSRF defence for cookie-less JSON posts). Absent Origin (non-browser clients) is allowed; the other guards still apply. */
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.get('host');
  } catch {
    return false;
  }
}

/**
 * Common pipeline for public POST routes: origin, size, rate limit, JSON, honeypot, fill-time, Zod.
 * Returns validated data, or a ready response. Bodies are never logged.
 */
export async function guard<S extends z.ZodType>(
  req: NextRequest,
  schema: S,
  o: GuardOptions,
): Promise<{ data: z.infer<S> } | { res: NextResponse }> {
  if (!sameOrigin(req)) return { res: fail(403, 'BAD_ORIGIN', 'This request was blocked.') };
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > MAX_BODY_BYTES) return { res: fail(413, 'TOO_LARGE', 'The submission is too large.') };
  const rl = rateLimit(`${o.bucket}:${clientIp(req)}`, o.max, o.windowMs);
  if (!rl.ok)
    return {
      res: fail(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.', undefined, {
        'Retry-After': String(rl.retryAfterSec),
      }),
    };
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES)
      return { res: fail(413, 'TOO_LARGE', 'The submission is too large.') };
    raw = JSON.parse(text);
  } catch {
    return { res: fail(400, 'BAD_REQUEST', 'The submission could not be read.') };
  }
  const obj = (raw ?? {}) as { website?: unknown; startedAt?: unknown };
  // Honeypot: pretend success so bots learn nothing, but do nothing.
  if (typeof obj.website === 'string' && obj.website.length > 0)
    return { res: NextResponse.json({ ok: true, ignored: true }) };
  if (typeof obj.startedAt === 'number' && Date.now() - obj.startedAt < MIN_FILL_MS)
    return { res: fail(429, 'TOO_FAST', 'Please take a moment to review the form and try again.') };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const i of parsed.error.issues) fields[i.path.join('.') || '_'] ??= i.message;
    return {
      res: fail(422, 'VALIDATION_ERROR', 'Please check the highlighted fields.', { fields }),
    };
  }
  return { data: parsed.data };
}
