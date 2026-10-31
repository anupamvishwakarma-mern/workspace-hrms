import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { startTestApp, stopTestApp } from './helpers';

let app: Express;
beforeAll(async () => {
  ({ app } = await startTestApp({
    RATE_LIMIT_DB_TEST_MAX: '2',
    TENANT_DB_ENCRYPTION_KEYS: `v1:${'3'.repeat(64)}`,
  }));
});
afterAll(stopTestApp);

describe('connection testing is rate limited', () => {
  it('stops an unauthenticated caller from using the test endpoint as a scanner', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 4; i++)
      codes.push((await request(app).post('/api/v1/signup/database/test').send({ connectionString: 'http://nope.example.com' })).status);
    expect(codes.slice(0, 2)).toEqual([422, 422]);
    expect(codes.slice(2)).toEqual([429, 429]);
  });
});
