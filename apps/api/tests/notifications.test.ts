import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import { SMTPServer } from 'smtp-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmailOutbox } from '../src/database/models/emailOutbox.model';
import { PushToken } from '../src/database/models/pushToken.model';
import { drainEmailDeliveries } from '../src/modules/notifications/email.service';
import { drainPushDeliveries } from '../src/modules/notifications/push.service';
import {
  FakeClock,
  bearer,
  createTenant,
  ist,
  loginAs,
  setupSchedule,
  startTestApp,
  stopTestApp,
  type TestTenant,
} from './helpers';

const mails: { to: string; raw: string }[] = [];
const smtp = new SMTPServer({
  authOptional: true,
  disabledCommands: ['STARTTLS', 'AUTH'],
  onData(stream, session, cb) {
    const chunks: Buffer[] = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => {
      mails.push({
        to: session.envelope.rcptTo.map((r) => r.address).join(','),
        raw: Buffer.concat(chunks).toString(),
      });
      cb();
    });
  },
});
const listen = (s: { listen: (p: number, h: string, cb: () => void) => unknown }) =>
  new Promise<void>((resolve) => void s.listen(0, '127.0.0.1', resolve));

const pushes: {
  auth?: string;
  body: { to: string; title: string; body: string; data?: unknown }[];
}[] = [];
let expoReply: (n: number) => unknown = (n) => Array.from({ length: n }, () => ({ status: 'ok' }));
const expo: Server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    pushes.push({ auth: req.headers.authorization, body });
    res.setHeader('content-type', 'application/json');
    try {
      res.end(JSON.stringify({ data: expoReply(body.length) }));
    } catch {
      res.statusCode = 500;
      res.end('{}');
    }
  });
});

describe('SMTP email', () => {
  let app: Express;
  let t: TestTenant;
  beforeAll(async () => {
    await listen(smtp.server as never);
    const port = (smtp.server.address() as AddressInfo).port;
    ({ app } = await startTestApp({
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(port),
      EMAIL_FROM: 'Workforce <no-reply@example.test>',
      WEB_APP_URL: 'https://hr.example.test',
    }));
    t = await createTenant('acme');
  });
  afterAll(async () => {
    smtp.close();
    await stopTestApp();
  });

  it('delivers a password reset over real SMTP, records SENT, and never stores the link', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: t.people.hr.email });
    expect(res.status).toBe(202);
    await drainEmailDeliveries();
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe(t.people.hr.email);
    const decoded = mails[0]!.raw.replace(/=\r?\n/g, '').replace(/=3D/g, '=');
    expect(decoded).toMatch(/https:\/\/hr\.example\.test\/reset-password\?token=/);
    const row = (await EmailOutbox.findOne({ to: t.people.hr.email }).lean())!;
    expect(row.status).toBe('SENT');
    expect(row.link).toBeUndefined(); // one-time token is not at rest in the database
    expect(row.sentAt).toBeDefined();
  });

  it('sends nothing for unknown addresses, and responds identically', async () => {
    const before = mails.length;
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'ghost@nowhere.test' });
    expect(res.status).toBe(202);
    await drainEmailDeliveries();
    expect(mails.length).toBe(before);
    expect(await EmailOutbox.countDocuments({ to: 'ghost@nowhere.test' })).toBe(0);
  });

  it('production refuses to send over a plaintext SMTP connection', async () => {
    const port = (smtp.server.address() as AddressInfo).port;
    const before = mails.length;
    const { app: prod } = await startTestApp({
      NODE_ENV: 'production',
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(port),
      EMAIL_FROM: 'x@example.test',
      WEB_APP_URL: 'https://hr.example.test',
      CORS_ORIGINS: 'https://hr.example.test',
      JWT_ACCESS_SECRET: 'a'.repeat(40),
      REFRESH_TOKEN_SECRET: 'b'.repeat(40),
    });
    const tp = await createTenant('prod');
    expect(
      (await request(prod).post('/api/v1/auth/forgot-password').send({ email: tp.people.hr.email }))
        .status,
    ).toBe(202);
    await drainEmailDeliveries();
    expect(mails.length).toBe(before);
    const row = (await EmailOutbox.findOne({ to: tp.people.hr.email }).lean())!;
    expect(row.status).toBe('FAILED');
    expect(row.error).toMatch(/STARTTLS|TLS/i);
  }, 30_000);

  it('a provider outage is recorded as FAILED without breaking the request or leaking the link', async () => {
    const dead = createServer();
    await listen(dead);
    const closedPort = (dead.address() as AddressInfo).port;
    await new Promise((r) => dead.close(r));
    const { app: app2 } = await startTestApp({
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(closedPort),
      EMAIL_FROM: 'x@example.test',
    });
    const t2 = await createTenant('beta');
    const res = await request(app2)
      .post('/api/v1/auth/forgot-password')
      .send({ email: t2.people.hr.email });
    expect(res.status).toBe(202);
    await drainEmailDeliveries();
    const row = (await EmailOutbox.findOne({ to: t2.people.hr.email }).lean())!;
    expect(row.status).toBe('FAILED');
    expect(row.error).toMatch(/ECONNREFUSED|connect/i);
    expect(row.link).toBeUndefined();
    expect(JSON.stringify(row)).not.toMatch(/token=/);
  }, 30_000);
});

describe('Expo push', () => {
  let app: Express;
  let t: TestTenant;
  let clock: FakeClock;
  const tok: Record<string, string> = {};
  const call = (m: 'get' | 'post', who: string, path: string) =>
    request(app)[m](`/api/v1${path}`).set(bearer(tok[who]!));
  const TOKEN_A = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
  const TOKEN_B = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';

  beforeAll(async () => {
    await listen(expo);
    const url = `http://127.0.0.1:${(expo.address() as AddressInfo).port}/send`;
    clock = new FakeClock(ist('2026-03-05', '12:00'));
    ({ app } = await startTestApp(
      { PUSH_PROVIDER: 'expo', EXPO_PUSH_URL: url, EXPO_ACCESS_TOKEN: 'test-expo-token' },
      { clock },
    ));
    t = await createTenant('acme');
    await setupSchedule(t);
    for (const k of Object.keys(t.people) as (keyof TestTenant['people'])[])
      tok[k] = await loginAs(app, t.people[k].email);
  });
  afterAll(async () => {
    await new Promise((r) => expo.close(r));
    await stopTestApp();
  });

  it('registers and removes device tokens, validating the format and ownership', async () => {
    expect(
      (await request(app).post('/api/v1/me/push-tokens').send({ token: TOKEN_A, platform: 'ios' }))
        .status,
    ).toBe(401);
    expect(
      (
        await call('post', 'employee', '/me/push-tokens').send({
          token: 'not-a-token',
          platform: 'ios',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call('post', 'employee', '/me/push-tokens').send({
          token: TOKEN_A,
          platform: 'ios',
          userId: 'x',
        })
      ).status,
    ).toBe(422);
    expect(
      (await call('post', 'employee', '/me/push-tokens').send({ token: TOKEN_A, platform: 'ios' }))
        .status,
    ).toBe(204);
    expect(
      (
        await call('post', 'manager', '/me/push-tokens').send({
          token: TOKEN_B,
          platform: 'android',
        })
      ).status,
    ).toBe(204);
    // someone else cannot delete my token
    await call('post', 'employee2', '/me/push-tokens/remove').send({ token: TOKEN_A });
    expect(await PushToken.countDocuments({ token: TOKEN_A })).toBe(1);
    // a shared phone: re-registering moves the token to the new user
    await call('post', 'employee2', '/me/push-tokens').send({
      token: TOKEN_B,
      platform: 'android',
    });
    expect((await PushToken.findOne({ token: TOKEN_B }).lean())!.userId).toEqual(
      t.people.employee2.userId,
    );
    await call('post', 'manager', '/me/push-tokens').send({ token: TOKEN_B, platform: 'android' });
    expect(await PushToken.countDocuments({ token: TOKEN_B })).toBe(1);
  });

  it('notifies only the affected employee when their leave is decided, with minimal content', async () => {
    const types = await call('post', 'hr', '/leave-types').send({ name: 'Casual', code: 'CL' });
    const lr = await call('post', 'employee', '/leave/requests').send({
      leaveTypeId: types.body.data.id,
      startDate: '2026-03-16',
      endDate: '2026-03-16',
      reason: 'Medical appointment',
    });
    expect(lr.status).toBe(201);
    pushes.length = 0;
    expect(
      (await call('post', 'manager', `/leave/requests/${lr.body.data.id}/approve`).send({})).status,
    ).toBe(200);
    await drainPushDeliveries();
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.auth).toBe('Bearer test-expo-token');
    expect(pushes[0]!.body).toHaveLength(1);
    expect(pushes[0]!.body[0]!.to).toBe(TOKEN_A);
    expect(pushes[0]!.body[0]!.title).toBe('Leave approved');
    expect(JSON.stringify(pushes[0])).not.toMatch(/Medical|appointment/); // private reason never leaves the server
  });

  it('drops tokens the provider reports as unregistered and survives provider errors', async () => {
    const lr = await call('post', 'employee', '/leave/requests').send({
      leaveTypeId: (await call('get', 'hr', '/leave-types')).body.data[0].id,
      startDate: '2026-03-17',
      endDate: '2026-03-17',
    });
    expoReply = () => [{ status: 'error', details: { error: 'DeviceNotRegistered' } }];
    expect(
      (
        await call('post', 'manager', `/leave/requests/${lr.body.data.id}/reject`).send({
          comment: 'Not possible',
        })
      ).status,
    ).toBe(200);
    await drainPushDeliveries();
    expect(await PushToken.countDocuments({ token: TOKEN_A })).toBe(0);

    // a failing provider never breaks the business action
    await call('post', 'employee', '/me/push-tokens').send({ token: TOKEN_A, platform: 'ios' });
    expoReply = () => {
      throw new Error('boom');
    };
    const lr2 = await call('post', 'employee', '/leave/requests').send({
      leaveTypeId: (await call('get', 'hr', '/leave-types')).body.data[0].id,
      startDate: '2026-03-18',
      endDate: '2026-03-18',
    });
    expect(
      (await call('post', 'manager', `/leave/requests/${lr2.body.data.id}/approve`).send({}))
        .status,
    ).toBe(200);
    await drainPushDeliveries();
  });
});

describe('push disabled', () => {
  it('sends nothing when PUSH_PROVIDER is none', async () => {
    const { app } = await startTestApp({}, { clock: new FakeClock(ist('2026-03-05', '12:00')) });
    const t = await createTenant('acme');
    await setupSchedule(t);
    const hr = await loginAs(app, t.people.hr.email);
    const emp = await loginAs(app, t.people.employee.email);
    const mgr = await loginAs(app, t.people.manager.email);
    await request(app)
      .post('/api/v1/me/push-tokens')
      .set(bearer(emp))
      .send({ token: 'ExponentPushToken[cccccccccccccccccccccc]', platform: 'ios' });
    const type = await request(app)
      .post('/api/v1/leave-types')
      .set(bearer(hr))
      .send({ name: 'Casual', code: 'CL' });
    const lr = await request(app)
      .post('/api/v1/leave/requests')
      .set(bearer(emp))
      .send({ leaveTypeId: type.body.data.id, startDate: '2026-03-16', endDate: '2026-03-16' });
    pushes.length = 0;
    await request(app)
      .post(`/api/v1/leave/requests/${lr.body.data.id}/approve`)
      .set(bearer(mgr))
      .send({});
    await drainPushDeliveries();
    expect(pushes).toHaveLength(0);
    await stopTestApp();
  });
});
