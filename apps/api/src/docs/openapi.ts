import { z } from 'zod';
import { routeRegistry, type RouteDoc } from '../utils/route';

const toOpenApiPath = (p: string) => p.replace(/:([A-Za-z]+)/g, '{$1}');
const schema = (s: RouteDoc['body']) =>
  z.toJSONSchema(s as z.ZodType, { target: 'openapi-3.0', unrepresentable: 'any', io: 'input' });

/** Generated from the route registry, so every registered route is documented by construction. */
export function buildOpenApiSpec() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routeRegistry) {
    const params = [...r.path.matchAll(/:([A-Za-z]+)/g)].map((m) => ({
      name: m[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));
    const queryParams = r.query
      ? Object.entries(
          (schema(r.query) as { properties?: Record<string, unknown> }).properties ?? {},
        ).map(([name, s]) => ({ name, in: 'query', schema: s }))
      : [];
    (paths[toOpenApiPath(r.path)] ??= {})[r.method] = {
      summary: r.summary,
      tags: r.tags,
      description: r.permission ? `Required permission: \`${r.permission}\`` : undefined,
      security: r.auth === 'none' ? [] : [{ bearerAuth: [] }],
      parameters: [...params, ...queryParams],
      requestBody: r.body
        ? { required: true, content: { 'application/json': { schema: schema(r.body) } } }
        : undefined,
      responses: {
        [String(r.successStatus ?? 200)]: { description: 'Success' },
        '400': { description: 'Bad request' },
        '401': { description: 'Unauthenticated' },
        '403': { description: 'Forbidden' },
        '404': { description: 'Not found' },
        '422': { description: 'Validation error' },
      },
    };
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'Workforce HRMS API',
      version: '0.2.0',
      description:
        'Multi-tenant attendance & HR API. Responses use { success, data, meta? } / { success:false, error:{code,message}, requestId }.',
    },
    servers: [{ url: '/api/v1' }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    },
    paths,
  };
}
