import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../src/config/env';
import { EmailOutbox } from '../src/database/models/emailOutbox.model';
import { Session } from '../src/database/models/session.model';
import { User } from '../src/database/models/user.model';
import { JWT_AUDIENCE, JWT_ISSUER } from '../src/middleware/auth';
import {
  PASSWORD,
  bearer,
  createTenant,
  latestEmailToken,
  startTestApp,
  stopTestApp,
  type TestTenant,
} from './helpers';

let app: Express;
let env: Env;
let t: TestTenant;
const post = (path: string, body: object = {}) => request(app).post(`/api/v1${path}`).send(body);

beforeAll(async () => {
  ({ app, env } = await startTestApp({ LOGIN_MAX_FAILURES: '3' }));
  t = await createTenant('acme');
});
afterAll(stopTestApp);

describe('login', () => {
  it('accepts valid credentials and returns tokens + memberships', async () => {
    const res = await post('/auth/login', { email: t.people.hr.email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toContain('.');
    expect(res.body.data.memberships[0].roles).toEqual(['HR_ADMIN']);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${res.body.data.accessToken}`);
    expect(me.body.data.email).toBe(t.people.hr.email);
    expect(JSON.stringify(me.body)).not.toMatch(/passwordHash/);
  });

  it('rejects wrong passwords and unknown users with an identical response', async () => {
    const wrong = await post('/auth/login', {
      email: t.people.hr.email,
      password: 'Wrong-Password-1',
    });
    const unknown = await post('/auth/login', {
      email: 'nobody@acme.test',
      password: 'Wrong-Password-1',
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toEqual(unknown.body.error);
  });

  it('locks the account after repeated failures, even for the right password', async () => {
    const email = t.people.employee2.email;
    for (let i = 0; i < 3; i++) await post('/auth/login', { email, password: 'Wrong-Password-1' });
    const res = await post('/auth/login', { email, password: PASSWORD });
    expect(res.status).toBe(401);
    await User.updateOne({ email }, { $unset: { lockedUntil: 1 } });
    expect((await post('/auth/login', { email, password: PASSWORD })).status).toBe(200);
  });

  it('rejects NoSQL operator payloads', async () => {
    const res = await post('/auth/login', { email: { $ne: '' }, password: { $ne: '' } });
    expect(res.status).toBe(400);
  });

  it('does not store refresh tokens in plaintext', async () => {
    const res = await post('/auth/login', { email: t.people.owner.email, password: PASSWORD });
    const secret = res.body.data.refreshToken.split('.')[1];
    const sessions = await Session.find({ userId: t.people.owner.userId }).lean();
    expect(JSON.stringify(sessions)).not.toContain(secret);
  });

  it('web clients receive the refresh token as an HttpOnly cookie, not in the body', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Client-Type', 'web')
      .send({ email: t.people.owner.email, password: PASSWORD });
    expect(res.body.data.refreshToken).toBeUndefined();
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/refresh_token=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .set('X-Client-Type', 'web')
      .set('Cookie', cookie.split(';')[0]!)
      .send({});
    expect(refreshed.status).toBe(200);
  });
});

describe('access tokens', () => {
  it('rejects missing, malformed, expired and wrongly-signed tokens', async () => {
    const me = (h: object) =>
      request(app)
        .get('/api/v1/auth/me')
        .set(h as Record<string, string>);
    expect((await me({})).status).toBe(401);
    expect((await me(bearer('garbage'))).status).toBe(401);
    const login = await post('/auth/login', { email: t.people.hr.email, password: PASSWORD });
    const sid = jwt.decode(login.body.data.accessToken, { json: true })!.sid as string;
    const sign = (secret: string, exp: number) =>
      jwt.sign({ sid }, secret, {
        subject: String(t.people.hr.userId),
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        expiresIn: exp,
      });
    const expired = await me(bearer(sign(env.JWT_ACCESS_SECRET, -10)));
    expect(expired.status).toBe(401);
    expect(expired.body.error.code).toBe('TOKEN_EXPIRED');
    expect((await me(bearer(sign('x'.repeat(40), 60)))).status).toBe(401);
    expect((await me(bearer(sign(env.JWT_ACCESS_SECRET, 60)))).status).toBe(200);
  });

  it('rejects alg=none tokens', async () => {
    const forged = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: String(t.people.owner.userId), sid: '0'.repeat(24) })).toString('base64url')}.`;
    expect((await request(app).get('/api/v1/auth/me').set(bearer(forged))).status).toBe(401);
  });
});

describe('refresh token rotation', () => {
  it('rotates on every refresh and detects reuse by revoking the session', async () => {
    const login = await post('/auth/login', { email: t.people.manager.email, password: PASSWORD });
    const rt1 = login.body.data.refreshToken as string;
    const r2 = await post('/auth/refresh', { refreshToken: rt1 });
    expect(r2.status).toBe(200);
    const rt2 = r2.body.data.refreshToken as string;
    expect(rt2).not.toBe(rt1);
    // Replaying the old token is treated as theft: session is revoked...
    expect((await post('/auth/refresh', { refreshToken: rt1 })).status).toBe(401);
    // ...so even the newest token and the access token stop working.
    expect((await post('/auth/refresh', { refreshToken: rt2 })).status).toBe(401);
    expect(
      (await request(app).get('/api/v1/auth/me').set(bearer(r2.body.data.accessToken))).status,
    ).toBe(401);
  });

  it('lets only one of two concurrent refreshes with the same token win', async () => {
    const login = await post('/auth/login', { email: t.people.manager.email, password: PASSWORD });
    const rt = login.body.data.refreshToken as string;
    const results = await Promise.all([
      post('/auth/refresh', { refreshToken: rt }),
      post('/auth/refresh', { refreshToken: rt }),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it('rejects tampered refresh tokens', async () => {
    const login = await post('/auth/login', { email: t.people.manager.email, password: PASSWORD });
    const [sid] = (login.body.data.refreshToken as string).split('.');
    expect((await post('/auth/refresh', { refreshToken: `${sid}.forged-secret` })).status).toBe(
      401,
    );
    expect((await post('/auth/refresh', { refreshToken: 'nope' })).status).toBe(401);
  });
});

describe('logout', () => {
  it('logout revokes the session immediately (access token dies too)', async () => {
    const login = await post('/auth/login', { email: t.people.hr.email, password: PASSWORD });
    const { accessToken, refreshToken } = login.body.data;
    expect((await post('/auth/logout', { refreshToken })).status).toBe(200);
    expect((await request(app).get('/api/v1/auth/me').set(bearer(accessToken))).status).toBe(401);
    expect((await post('/auth/refresh', { refreshToken })).status).toBe(401);
  });

  it('logout-all revokes every device and sessions are listable', async () => {
    const a = await post('/auth/login', {
      email: t.people.payroll.email,
      password: PASSWORD,
      deviceLabel: 'Phone',
    });
    const b = await post('/auth/login', {
      email: t.people.payroll.email,
      password: PASSWORD,
      deviceLabel: 'Laptop',
    });
    const list = await request(app)
      .get('/api/v1/auth/sessions')
      .set(bearer(a.body.data.accessToken));
    expect(list.body.data.length).toBeGreaterThanOrEqual(2);
    expect(list.body.data.some((s: { current: boolean }) => s.current)).toBe(true);
    expect(
      (await request(app).post('/api/v1/auth/logout-all').set(bearer(a.body.data.accessToken)))
        .status,
    ).toBe(200);
    expect((await post('/auth/refresh', { refreshToken: b.body.data.refreshToken })).status).toBe(
      401,
    );
  });

  it("a user can revoke another of their own sessions but not someone else's", async () => {
    const mine = await post('/auth/login', { email: t.people.hr.email, password: PASSWORD });
    const other = await post('/auth/login', { email: t.people.owner.email, password: PASSWORD });
    const otherSession = (
      await request(app).get('/api/v1/auth/sessions').set(bearer(other.body.data.accessToken))
    ).body.data[0].id;
    expect(
      (
        await request(app)
          .delete(`/api/v1/auth/sessions/${otherSession}`)
          .set(bearer(mine.body.data.accessToken))
      ).status,
    ).toBe(404);
  });
});

describe('password reset', () => {
  it('issues a single-use token, changes the password and revokes sessions', async () => {
    const email = t.people.employee.email;
    const login = await post('/auth/login', { email, password: PASSWORD });
    expect((await post('/auth/forgot-password', { email })).status).toBe(202);
    const token = await latestEmailToken(email, 'PASSWORD_RESET');
    const weak = await post('/auth/reset-password', { token, password: 'short' });
    expect(weak.status).toBe(422);
    const ok = await post('/auth/reset-password', { token, password: 'Brand-New-Pass-99' });
    expect(ok.status).toBe(200);
    expect(
      (await post('/auth/reset-password', { token, password: 'Another-Pass-1234' })).status,
    ).toBe(400);
    expect(
      (await post('/auth/refresh', { refreshToken: login.body.data.refreshToken })).status,
    ).toBe(401);
    expect((await post('/auth/login', { email, password: PASSWORD })).status).toBe(401);
    expect((await post('/auth/login', { email, password: 'Brand-New-Pass-99' })).status).toBe(200);
  });

  it('answers identically for unknown emails and records nothing', async () => {
    const before = await EmailOutbox.countDocuments();
    const res = await post('/auth/forgot-password', { email: 'ghost@acme.test' });
    expect(res.status).toBe(202);
    expect(await EmailOutbox.countDocuments()).toBe(before);
  });

  it('outbox entries are honestly marked as not sent', async () => {
    const mail = await EmailOutbox.findOne({ template: 'PASSWORD_RESET' }).lean();
    expect(mail?.status).toBe('RECORDED_NOT_SENT');
  });
});

describe('rate limiting', () => {
  it('throttles login attempts per client', async () => {
    const limited = await startTestApp({ RATE_LIMIT_LOGIN_MAX: '3' });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++)
      statuses.push(
        (
          await request(limited.app)
            .post('/api/v1/auth/login')
            .send({ email: 'x@y.test', password: 'whatever12345' })
        ).status,
      );
    expect(statuses.slice(0, 3).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(3)).toEqual([429, 429]);
    // restore the shared app's database state for any following tests
    ({ app, env } = await startTestApp({ LOGIN_MAX_FAILURES: '3' }));
    t = await createTenant('acme');
  });
});
