import { unsubscribeSchema } from '@/lib/validation/schemas';
import { leadRoute } from '@/lib/server/lead-route';

export const dynamic = 'force-dynamic';
export const POST = leadRoute(unsubscribeSchema, 'newsletter_unsubscribe', {
  bucket: 'unsubscribe',
  max: 6,
  windowMs: 60 * 60 * 1000,
});
