import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiClient, type SessionStorage } from '../src/lib/api';
import { ApiError } from '../src/lib/errors';

const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const fail = (status: number, code: string, message = 'x', details?: unknown) =>
  new Response(JSON.stringify({ success: false, error: { code, message, details } }), { status });

function memStorage(
  initial: string | null = 'R0',
): SessionStorage & { token: string | null; clears: number } {
  const s = {
    token: initial,
    clears: 0,
    getRefreshToken: async () => s.token,
    setRefreshToken: async (t: string) => void (s.token = t),
    clear: async () => {
      s.token = null;
      s.clears++;
    },
  };
  return s;
}

const tokens = (n: number) => ({ accessToken: `A${n}`, refreshToken: `R${n}`, expiresIn: 900 });

function setup(
  handler: (url: URL, init: RequestInit) => Response | Promise<Response>,
  storage = memStorage(),
) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(u));
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  }) as unknown as typeof fetch;
  const expired = vi.fn();
  const client = new ApiClient({
    baseUrl: 'https://api.test/api/v1',
    storage,
    fetchImpl,
    onSessionExpired: expired,
  });
  return { client, calls, storage, expired };
}

const header = (c: { init: RequestInit }, name: string) =>
  (c.init.headers as Record<string, string>)[name];

describe('ApiClient', () => {
  it('refreshes with the stored token before the first authenticated call and persists the rotated token', async () => {
    const { client, calls, storage } = setup((url) =>
      url.pathname.endsWith('/auth/refresh') ? ok(tokens(1)) : ok({ hello: 1 }),
    );
    const res = await client.call({ path: '/ping' });
    expect(res.data).toEqual({ hello: 1 });
    expect(storage.token).toBe('R1');
    expect(header(calls[1]!, 'Authorization')).toBe('Bearer A1');
  });

  it('sends the tenant selector only when set and never on public endpoints', async () => {
    const { client, calls } = setup((url) =>
      url.pathname.endsWith('/auth/login')
        ? ok({ ...tokens(1), user: { id: 'u', email: 'e' }, memberships: [] })
        : ok({}),
    );
    client.setTenant('T1');
    await client.login('a@b.co', 'pw');
    await client.call({ path: '/x' });
    expect(header(calls[0]!, 'X-Tenant-Id')).toBeUndefined();
    expect(header(calls[0]!, 'Authorization')).toBeUndefined();
    expect(header(calls[1]!, 'X-Tenant-Id')).toBe('T1');
  });

  it('on 401 refreshes once and retries the request once', async () => {
    let n = 0;
    const { client, calls } = setup((url, init) => {
      if (url.pathname.endsWith('/auth/refresh')) return ok(tokens(++n));
      return (init.headers as Record<string, string>).Authorization === 'Bearer A1'
        ? fail(401, 'TOKEN_EXPIRED')
        : ok({ done: true });
    });
    expect((await client.call({ path: '/x' })).data).toEqual({ done: true });
    expect(calls.filter((c) => c.url.pathname.endsWith('/auth/refresh'))).toHaveLength(2);
  });

  it('concurrent 401s share ONE refresh (otherwise token reuse detection would revoke the session)', async () => {
    let refreshes = 0;
    const { client } = setup(async (url, init) => {
      if (url.pathname.endsWith('/auth/refresh')) {
        refreshes++;
        await new Promise((r) => setTimeout(r, 20));
        return ok(tokens(refreshes));
      }
      return (init.headers as Record<string, string>).Authorization === 'Bearer A1'
        ? fail(401, 'TOKEN_EXPIRED')
        : ok({});
    });
    await client.restore();
    await Promise.all([
      client.call({ path: '/a' }),
      client.call({ path: '/b' }),
      client.call({ path: '/c' }),
    ]);
    expect(refreshes).toBe(2); // 1 restore + 1 shared rotation for all three
  });

  it('does not retry forever: a second 401 after refreshing surfaces as an error', async () => {
    const { client, calls } = setup((url) =>
      url.pathname.endsWith('/auth/refresh') ? ok(tokens(1)) : fail(401, 'UNAUTHORIZED'),
    );
    await expect(client.call({ path: '/x' })).rejects.toMatchObject({ status: 401 });
    expect(calls.filter((c) => !c.url.pathname.endsWith('/auth/refresh'))).toHaveLength(2);
  });

  it('a rejected refresh token clears the session and notifies once', async () => {
    const { client, storage, expired } = setup(() => fail(401, 'INVALID_REFRESH_TOKEN'));
    await expect(client.call({ path: '/x' })).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(storage.token).toBeNull();
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('a network failure during refresh keeps the session (user is not logged out when offline)', async () => {
    const { client, storage, expired } = setup(() => {
      throw new TypeError('Network request failed');
    });
    await expect(client.call({ path: '/x' })).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(storage.token).toBe('R0');
    expect(expired).not.toHaveBeenCalled();
  });

  it('with no stored token it expires the session instead of calling the API unauthenticated', async () => {
    const { client, calls, expired } = setup(() => ok({}), memStorage(null));
    await expect(client.call({ path: '/x' })).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(calls).toHaveLength(0);
    expect(expired).toHaveBeenCalled();
  });

  it('maps API errors and rejects responses that do not match the schema', async () => {
    const { client } = setup((url) => {
      if (url.pathname.endsWith('/auth/refresh')) return ok(tokens(1));
      if (url.pathname === '/api/v1/bad') return ok({ nope: true });
      return fail(422, 'OUTSIDE_GEOFENCE', 'outside', {
        exceptionAllowed: true,
        distanceMeters: 2200,
      });
    });
    const err = (await client.call({ path: '/x' }).catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 422,
      code: 'OUTSIDE_GEOFENCE',
      details: { exceptionAllowed: true },
    });
    await expect(
      client.call({ path: '/bad', schema: z.object({ ok: z.boolean() }) }),
    ).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('times out slow requests', async () => {
    const storage = memStorage();
    const client = new ApiClient({
      baseUrl: 'https://api.test/api/v1',
      storage,
      timeoutMs: 20,
      fetchImpl: ((u: string, init: RequestInit) => {
        if (String(u).endsWith('/auth/refresh')) return Promise.resolve(ok(tokens(1)));
        return new Promise((_, rej) =>
          init.signal!.addEventListener('abort', () => rej(new Error('aborted'))),
        );
      }) as unknown as typeof fetch,
    });
    await expect(client.call({ path: '/slow' })).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('logout clears local credentials even when the server cannot be reached', async () => {
    const { client, storage } = setup(() => {
      throw new TypeError('offline');
    });
    await client.logout();
    expect(storage.token).toBeNull();
  });
});
