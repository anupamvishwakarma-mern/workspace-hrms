import { ApiError } from './errors';

export interface Envelope<T> {
  data: T;
  meta?: { page: number; limit: number; total: number };
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  onSessionExpired?: () => void;
}

/**
 * Browser API client.
 *  - The access token lives only in memory. The refresh token is an HttpOnly cookie the page cannot read.
 *  - One shared refresh at a time (the server rotates refresh tokens and treats reuse as theft).
 *  - X-Tenant-Id is only a selector; the server checks membership on every request.
 */
export class ApiClient {
  private accessToken: string | null = null;
  private tenantId: string | null = null;
  private refreshing: Promise<void> | null = null;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: ApiClientOptions = {}) {
    this.base = opts.baseUrl ?? '/api/v1';
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
  }

  setTenant(id: string | null) {
    this.tenantId = id;
  }
  setAccessToken(t: string | null) {
    this.accessToken = t;
  }

  /** Obtains an access token from the refresh cookie. Resolves false when there is no valid session. */
  async restore(): Promise<boolean> {
    try {
      await this.refresh();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SESSION_EXPIRED') return false;
      throw e;
    }
  }

  refresh(): Promise<void> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<void> {
    let env: Envelope<{ accessToken: string }>;
    try {
      env = await this.raw<{ accessToken: string }>('POST', '/auth/refresh', {
        body: {},
        auth: false,
        tenant: false,
      });
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        this.accessToken = null;
        this.opts.onSessionExpired?.();
        throw new ApiError(
          401,
          'SESSION_EXPIRED',
          'Your session has expired. Please sign in again.',
        );
      }
      throw e;
    }
    this.accessToken = env.data.accessToken;
  }

  async login(email: string, password: string) {
    const env = await this.raw<{
      accessToken: string;
      user: { id: string; email: string };
      memberships: import('./types').Membership[];
    }>('POST', '/auth/login', { body: { email, password }, auth: false, tenant: false });
    this.accessToken = env.data.accessToken;
    return env.data;
  }

  async logout(): Promise<void> {
    this.accessToken = null;
    this.tenantId = null;
    await this.raw('POST', '/auth/logout', { body: {}, auth: false, tenant: false }).catch(
      () => undefined,
    );
  }

  async request<T>(
    method: string,
    path: string,
    o: {
      body?: unknown;
      query?: Record<string, unknown>;
      tenant?: boolean;
      signal?: AbortSignal;
    } = {},
  ): Promise<Envelope<T>> {
    if (!this.accessToken) await this.refresh();
    try {
      return await this.raw<T>(method, path, o);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && e.code !== 'SESSION_EXPIRED') {
        await this.refresh();
        return this.raw<T>(method, path, o);
      }
      throw e;
    }
  }

  get = <T>(path: string, query?: Record<string, unknown>, signal?: AbortSignal) =>
    this.request<T>('GET', path, { query, signal });
  post = <T>(path: string, body?: unknown) => this.request<T>('POST', path, { body: body ?? {} });
  patch = <T>(path: string, body: unknown) => this.request<T>('PATCH', path, { body });
  del = <T>(path: string) => this.request<T>('DELETE', path, {});

  /** Unauthenticated call (activation, password reset). Sends no token and no tenant. */
  postPublic = <T>(path: string, body: unknown) =>
    this.raw<T>('POST', path, { body, auth: false, tenant: false });

  /** Authenticated file download (CSV). Returns the blob and the server-suggested filename. */
  async download(
    path: string,
    query: Record<string, unknown>,
  ): Promise<{ blob: Blob; filename: string }> {
    if (!this.accessToken) await this.refresh();
    const send = () => this.fetchRaw('GET', path, { query });
    let res = await send();
    if (res.status === 401) {
      await this.refresh();
      res = await send();
    }
    if (!res.ok) throw await this.toError(res);
    const cd = res.headers.get('content-disposition') ?? '';
    return { blob: await res.blob(), filename: /filename="([^"]+)"/.exec(cd)?.[1] ?? 'export.csv' };
  }

  private async fetchRaw(
    method: string,
    path: string,
    o: {
      body?: unknown;
      query?: Record<string, unknown>;
      auth?: boolean;
      tenant?: boolean;
      signal?: AbortSignal;
    },
  ): Promise<Response> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(o.query ?? {}))
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    const url = `${this.base}${path}${qs.size ? `?${qs}` : ''}`;
    const headers: Record<string, string> = { Accept: 'application/json', 'X-Client-Type': 'web' };
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    if ((o.auth ?? true) && this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
    if ((o.tenant ?? true) && this.tenantId) headers['X-Tenant-Id'] = this.tenantId;
    try {
      return await this.fetchImpl(url, {
        method,
        headers,
        body: o.body === undefined ? undefined : JSON.stringify(o.body),
        credentials: 'same-origin',
        cache: 'no-store',
        signal: o.signal,
      });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError')
        throw new ApiError(0, 'ABORTED', 'Request cancelled');
      throw new ApiError(0, 'NETWORK_ERROR', 'Network request failed');
    }
  }

  private async toError(res: Response): Promise<ApiError> {
    let body:
      | { error?: { code?: string; message?: string; details?: unknown }; requestId?: string }
      | undefined;
    try {
      body = await res.json();
    } catch {
      /* not JSON */
    }
    return new ApiError(
      res.status,
      body?.error?.code ?? `HTTP_${res.status}`,
      body?.error?.message ?? `Request failed (${res.status})`,
      body?.error?.details,
      body?.requestId,
    );
  }

  private async raw<T>(
    method: string,
    path: string,
    o: {
      body?: unknown;
      query?: Record<string, unknown>;
      auth?: boolean;
      tenant?: boolean;
      signal?: AbortSignal;
    },
  ): Promise<Envelope<T>> {
    const res = await this.fetchRaw(method, path, o);
    if (!res.ok) throw await this.toError(res);
    if (res.status === 204) return { data: undefined as T };
    const json = (await res.json()) as { success?: boolean; data: T; meta?: Envelope<T>['meta'] };
    return { data: json.data, meta: json.meta };
  }
}

export const api = new ApiClient();
