import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createLogger } from '../src/config/logger';
import { connectDatabase, disconnectDatabase } from '../src/database/connection';
import { testEnv } from './helpers';

const env = testEnv({ CORS_ORIGINS: 'http://allowed.test' });
const logger = createLogger(env);
const app = createApp(env, logger);

describe('health endpoints', () => {
  it('reports unavailable readiness before DB connects', async () => {
    const res = await request(app).get('/api/v1/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.data.checks.mongodb).toBe('down');
  });

  describe('with MongoDB connected', () => {
    beforeAll(async () => {
      await connectDatabase(env.MONGODB_URI, logger);
    });
    afterAll(async () => {
      await disconnectDatabase();
    });

    it('liveness returns ok', async () => {
      const res = await request(app).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('ok');
    });

    it('readiness pings MongoDB', async () => {
      const res = await request(app).get('/api/v1/health/ready');
      expect(res.status).toBe(200);
      expect(res.body.data.checks.mongodb).toBe('up');
      expect(mongoose.connection.readyState).toBe(1);
    });

    it('config status exposes no secret values', async () => {
      const res = await request(app).get('/api/v1/health/config');
      expect(res.status).toBe(200);
      expect(res.body.data.integrations.email).toBe('not_configured');
      expect(JSON.stringify(res.body)).not.toContain(env.JWT_ACCESS_SECRET);
    });
  });
});

describe('http hardening', () => {
  it('returns a consistent 404 with request id', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.requestId).toBeTruthy();
  });
  it('sets security headers and hides x-powered-by', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
  it('only allows configured CORS origins', async () => {
    const ok = await request(app).get('/api/v1/health').set('Origin', 'http://allowed.test');
    expect(ok.headers['access-control-allow-origin']).toBe('http://allowed.test');
    const bad = await request(app).get('/api/v1/health').set('Origin', 'http://evil.test');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('returns 400 for malformed JSON without leaking internals', async () => {
    const res = await request(app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });
});

describe('API docs exposure', () => {
  const prodEnv = (extra: Record<string, string> = {}) =>
    testEnv({
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://db.internal:27017/x',
      WEB_APP_URL: 'https://app.example.com',
      CORS_ORIGINS: 'https://app.example.com',
      ...extra,
    });
  it('is not served in production unless explicitly enabled', async () => {
    const e = prodEnv();
    expect(
      (await request(createApp(e, createLogger(e))).get('/api/v1/docs/openapi.json')).status,
    ).toBe(404);
    const on = prodEnv({ ENABLE_API_DOCS: 'true' });
    expect(
      (await request(createApp(on, createLogger(on))).get('/api/v1/docs/openapi.json')).status,
    ).toBe(200);
  });
});
