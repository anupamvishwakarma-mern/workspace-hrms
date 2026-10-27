import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '@/lib/api';
import { ApiError, userMessage } from '@/lib/errors';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const ok = (data: unknown) => json(200, { success: true, data });
const fail = (status: number, code: string, message = 'x') =>
  json(status, { success: false, error: { code, message } });

describe('ApiClient', () => {
  it('sends the web client header, bearer token and tenant selector, never credentials in the URL', async () => {
    const f = vi.fn(async () => ok([]));
    const c = new ApiClient({ fetchImpl: f as never });
    c.setAccessToken('tok');
    c.setTenant('t1');
    await c.get('/employees', { page: 2, search: '', skip: undefined });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/employees?page=2');
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer tok');
    expect(h['X-Tenant-Id']).toBe('t1');
    expect(h['X-Client-Type']).toBe('web');
    expect(init.credentials).toBe('same-origin');
  });

  it('shares a single refresh between concurrent callers', async () => {
    let refreshes = 0;
    const f = vi.fn(async (url: string) => {
      if (url.endsWith('/auth/refresh')) {
        refreshes++;
        await new Promise((r) => setTimeout(r, 10));
        return ok({ accessToken: 'new' });
      }
      return ok([]);
    });
    const c = new ApiClient({ fetchImpl: f as never });
    await Promise.all([c.get('/a'), c.get('/b'), c.get('/c')]);
    expect(refreshes).toBe(1);
  });

  it('refreshes once and retries when the access token is rejected', async () => {
    let calls = 0;
    const f = vi.fn(async (url: string) => {
      if (url.endsWith('/auth/refresh')) return ok({ accessToken: 'fresh' });
      calls++;
      return calls === 1 ? fail(401, 'UNAUTHENTICATED') : ok({ done: true });
    });
    const c = new ApiClient({ fetchImpl: f as never });
    c.setAccessToken('stale');
    const r = await c.get<{ done: boolean }>('/x');
    expect(r.data.done).toBe(true);
    expect(calls).toBe(2);
  });

  it('signals session expiry when the refresh is rejected, without looping', async () => {
    const expired = vi.fn();
    const f = vi.fn(async () => fail(401, 'UNAUTHENTICATED'));
    const c = new ApiClient({ fetchImpl: f as never, onSessionExpired: expired });
    await expect(c.get('/x')).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(expired).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('restore() resolves false without a session and rethrows network errors', async () => {
    const c1 = new ApiClient({ fetchImpl: (async () => fail(401, 'UNAUTHENTICATED')) as never });
    expect(await c1.restore()).toBe(false);
    const c2 = new ApiClient({
      fetchImpl: (async () => {
        throw new TypeError('down');
      }) as never,
    });
    await expect(c2.restore()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('keeps the session on a 5xx refresh failure', async () => {
    const expired = vi.fn();
    const c = new ApiClient({
      fetchImpl: (async () => fail(503, 'UNAVAILABLE')) as never,
      onSessionExpired: expired,
    });
    await expect(c.restore()).rejects.toBeInstanceOf(ApiError);
    expect(expired).not.toHaveBeenCalled();
  });

  it('download returns the blob and server filename', async () => {
    const f = vi.fn(
      async () =>
        new Response('a,b\r\n', {
          status: 200,
          headers: { 'content-disposition': 'attachment; filename="summary.csv"' },
        }),
    );
    const c = new ApiClient({ fetchImpl: f as never });
    c.setAccessToken('t');
    const d = await c.download('/reports/attendance/export', { from: '2026-01-01' });
    expect(d.filename).toBe('summary.csv');
    expect(await d.blob.text()).toBe('a,b\r\n');
  });
});

describe('userMessage', () => {
  it('never leaks server error details for 5xx', () => {
    expect(userMessage(new ApiError(500, 'INTERNAL', 'stack trace at db.js:1'))).not.toMatch(
      /stack|db\.js/,
    );
  });
  it('surfaces the first validation issue', () => {
    expect(
      userMessage(
        new ApiError(400, 'VALIDATION_ERROR', 'bad', [{ path: 'name', message: 'Required' }]),
      ),
    ).toBe('name: Required');
  });

  it('postPublic sends no token and no tenant, even when signed in', async () => {
    const f = vi.fn(async () => ok({ passwordReset: true }));
    const c = new ApiClient({ fetchImpl: f as never });
    c.setAccessToken('tok');
    c.setTenant('t1');
    await c.postPublic('/auth/reset-password', { token: 'x'.repeat(20), password: 'pw' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/reset-password');
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBeUndefined();
    expect(h['X-Tenant-Id']).toBeUndefined();
  });

  it('treats a 204 delete as success with no body', async () => {
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    const c = new ApiClient({ fetchImpl: f as never });
    c.setAccessToken('tok');
    const r = await c.del('/employees/e1/documents/d1');
    expect(r.data).toBeUndefined();
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe('DELETE');
  });
});
