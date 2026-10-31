import { serviceSchema } from '@/lib/validation/schemas';
import { leadRoute } from '@/lib/server/lead-route';

export const dynamic = 'force-dynamic';
export const POST = leadRoute(serviceSchema, 'service', {
  bucket: 'service',
  max: 8,
  windowMs: 60 * 60 * 1000,
});
