import { contactSchema } from '@/lib/validation/schemas';
import { leadRoute } from '@/lib/server/lead-route';

export const dynamic = 'force-dynamic';
export const POST = leadRoute(contactSchema, 'contact', {
  bucket: 'contact',
  max: 8,
  windowMs: 60 * 60 * 1000,
});
