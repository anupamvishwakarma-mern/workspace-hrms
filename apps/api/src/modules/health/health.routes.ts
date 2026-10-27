import type { Router } from 'express';
import { integrationStatus, type Env } from '../../config/env';
import { pingDatabase } from '../../database/connection';
import { route } from '../../utils/route';

export function registerHealthRoutes(v1: Router, env: Env): void {
  const startedAt = Date.now();

  /** Liveness: process is up. Does not touch dependencies. */
  route(
    v1,
    { method: 'get', path: '/health', summary: 'Liveness probe.', tags: ['Health'], auth: 'none' },
    (_req, res) => {
      res.json({
        success: true,
        data: { status: 'ok', uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) },
      });
    },
  );

  /** Readiness: required dependencies (MongoDB) are reachable. */
  route(
    v1,
    {
      method: 'get',
      path: '/health/ready',
      summary: 'Readiness probe (checks MongoDB).',
      tags: ['Health'],
      auth: 'none',
    },
    async (_req, res) => {
      const mongo = await pingDatabase();
      res.status(mongo ? 200 : 503).json({
        success: mongo,
        data: {
          status: mongo ? 'ready' : 'unavailable',
          checks: { mongodb: mongo ? 'up' : 'down' },
        },
      });
    },
  );

  /** Configuration status of optional integrations. Never returns secret values. */
  route(
    v1,
    {
      method: 'get',
      path: '/health/config',
      summary: 'Which optional integrations are configured (no secrets).',
      tags: ['Health'],
      auth: 'none',
    },
    (_req, res) => {
      res.json({
        success: true,
        data: { environment: env.NODE_ENV, integrations: integrationStatus(env) },
      });
    },
  );
}
