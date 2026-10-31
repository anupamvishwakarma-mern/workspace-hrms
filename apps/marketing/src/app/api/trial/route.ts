import { NextResponse, type NextRequest } from 'next/server';
import { fail, guard } from '@/lib/server/guard';
import { registerTrial } from '@/lib/server/trial';
import { trialSchema } from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  const g = await guard(req, trialSchema, { bucket: 'trial', max: 5, windowMs: 60 * 60 * 1000 });
  if ('res' in g) return g.res;
  try {
    const out = await registerTrial(g.data);
    const http =
      out.status === 'created'
        ? 201
        : out.status === 'existing_account'
          ? 409
          : out.status === 'validation_error'
            ? 422
            : out.status === 'database_error'
              ? 422
              : out.status === 'unavailable'
                ? 503
                : 502;
    return NextResponse.json(
      { ok: out.status === 'created', ...out },
      { status: http, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return fail(
      500,
      'SERVER_ERROR',
      'Something went wrong. No account was created. Please try again.',
    );
  }
}
