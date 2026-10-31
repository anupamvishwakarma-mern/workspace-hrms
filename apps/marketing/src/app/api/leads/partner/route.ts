import { partnerSchema } from '@/lib/validation/schemas';
import { leadRoute } from '@/lib/server/lead-route';

export const dynamic = 'force-dynamic';
export const POST = leadRoute(partnerSchema, 'partner', {
  bucket: 'partner',
  max: 5,
  windowMs: 60 * 60 * 1000,
});
