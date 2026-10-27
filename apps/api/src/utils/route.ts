import type { RequestHandler, Router } from 'express';
import type { ZodTypeAny } from 'zod';

export interface RouteDoc {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  /** Path relative to /api/v1, using Express `:param` syntax. */
  path: string;
  summary: string;
  tags: string[];
  auth: 'none' | 'user' | 'tenant' | 'platform';
  permission?: string;
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  successStatus?: number;
}

/** Every route is registered through here so the OpenAPI spec cannot drift from the router. */
export const routeRegistry: RouteDoc[] = [];

export function route(router: Router, doc: RouteDoc, ...handlers: RequestHandler[]): void {
  if (!routeRegistry.some((r) => r.method === doc.method && r.path === doc.path))
    routeRegistry.push(doc);
  router[doc.method](doc.path, ...handlers);
}
