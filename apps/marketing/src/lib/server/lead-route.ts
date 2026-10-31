import { NextResponse, type NextRequest } from 'next/server';
import type { z } from 'zod';
import { fail, guard, clientIp } from './guard';
import {
  deliverLead,
  LeadDeliveryError,
  LeadsNotConfiguredError,
  type LeadKind,
} from '@/lib/integrations/leads';

/** Builds a POST handler for a lead form: guard -> deliver -> honest response. */
export function leadRoute<S extends z.ZodType>(
  schema: S,
  kind: LeadKind | ((d: z.infer<S>) => LeadKind),
  opts: { bucket: string; max: number; windowMs: number },
) {
  return async function POST(req: NextRequest) {
    const g = await guard(req, schema, opts);
    if ('res' in g) return g.res;
    try {
      const k = typeof kind === 'function' ? kind(g.data) : kind;
      const r = await deliverLead(k, g.data as Record<string, unknown>, { ip: clientIp(req) });
      return NextResponse.json(
        { ok: true, destination: r.destination },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    } catch (e) {
      if (e instanceof LeadsNotConfiguredError)
        return fail(
          503,
          'NOT_CONFIGURED',
          'Submissions are not available right now. Please try again later.',
        );
      if (e instanceof LeadDeliveryError)
        return fail(
          502,
          'DELIVERY_FAILED',
          'We could not pass your request on. Please try again in a few minutes.',
        );
      return fail(500, 'SERVER_ERROR', 'Something went wrong. Please try again.');
    }
  };
}
