import type { z } from 'zod';
import { ApiError } from './errors';
import { loginData, refreshData } from './schemas';

/** Only the long-lived refresh token and the chosen company are persisted (in the OS keystore). */
export interface SessionStorage {
  getRefreshToken(): Promise<string | null>;
  setRefreshToken(token: string): Promise<void>;
  clear(): Promise<void>;
}

export interface ApiClientOptions {
  baseUrl: string;
  storage: SessionStorage;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Called once when the session can no longer be refreshed (revoked, expired, reuse detected). */
  onSessionExpired?: () => void;
}

export interface CallOptions<S extends z.ZodTypeAny | undefined> {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Response `data` schema. Responses that do not match are rejected, never trusted. */
  schema?: S;
  /** Public endpoints (login/refresh) send no credentials. */
  auth?: boolean;
  /** Send X-Tenant-Id (the server still verifies membership). */
  tenant?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface Envelope<T> {
  status: number;
  data: T;
  meta?: { page: number; limit: number; total: number };
}

export class ApiClient {
  private accessToken: string | null = null;
  private tenantId: string | null = null;
  private refreshing: Promise<void> | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly opts: ApiClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  setTenant(id: string | null): void {
    this.tenantId = id;
  }
  get hasAccessToken(): boolean {
    return this.accessToken !== null;
  }

  async login(email: string, password: string, deviceLabel?: string) {
    const res = await this.call({
      method: 'POST',
      path: '/auth/login',
      body: { email, password, ...(deviceLabel ? { deviceLabel } : {}) },
      schema: loginData,
      auth: false,
      tenant: false,
    });
    await this.opts.storage.setRefreshToken(res.data.refreshToken);
    this.accessToken = res.data.accessToken;
    return res.data;
  }

  /** Restores a session from the stored refresh token (app start). Returns false when there is none. */
  async restore(): Promise<boolean> {
    if (!(await this.opts.storage.getRefreshToken())) return false;
    await this.refresh();
    return true;
  }

  async logout(): Promise<void> {
    const token = await this.opts.storage.getRefreshToken().catch(() => null);
    this.accessToken = null;
    this.tenantId = null;
    await this.opts.storage.clear().catch(() => undefined);
    if (token) {
      // Best effort: revoke server-side, but never block or fail local sign-out on the network.
      await this.call({
        method: 'POST',
        path: '/auth/logout',
        body: { refreshToken: token },
        auth: false,
        tenant: false,
        timeoutMs: 5_000,
      }).catch(() => undefined);
    }
  }

  /** Single-flight: concurrent 401s share one rotation, otherwise reuse detection would revoke the session. */
  private refresh(): Promise<void> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<void> {
    const stored = await this.opts.storage.getRefreshToken();
    if (!stored) return this.expire();
    let res: Envelope<z.infer<typeof refreshData>>;
    try {
      res = await this.call({
        method: 'POST',
        path: '/auth/refresh',
        body: { refreshToken: stored },
        schema: refreshData,
        auth: false,
        tenant: false,
      });
    } catch (err) {
      // A network failure must not log the user out; only a definitive rejection does.
      if (err instanceof ApiError && !err.isNetwork && err.status >= 400 && err.status < 500)
        return this.expire();
      throw err;
    }
    // Persist the rotated token BEFORE using the new access token.
    await this.opts.storage.setRefreshToken(res.data.refreshToken);
    this.accessToken = res.data.accessToken;
  }

  private async expire(): Promise<never> {
    this.accessToken = null;
    await this.opts.storage.clear().catch(() => undefined);
    this.opts.onSessionExpired?.();
    throw new ApiError(401, 'SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
  }

  async call<S extends z.ZodTypeAny | undefined = undefined>(
    o: CallOptions<S>,
  ): Promise<Envelope<S extends z.ZodTypeAny ? z.infer<S> : unknown>> {
    const auth = o.auth ?? true;
    if (auth && !this.accessToken) await this.refresh();
    try {
      return await this.send(o);
    } catch (err) {
      if (auth && err instanceof ApiError && err.status === 401 && err.code !== 'SESSION_EXPIRED') {
        await this.refresh();
        return this.send(o); // one retry only
      }
      throw err;
    }
  }

  private async send<S extends z.ZodTypeAny | undefined>(
    o: CallOptions<S>,
  ): Promise<Envelope<S extends z.ZodTypeAny ? z.infer<S> : unknown>> {
    const url = new URL(this.opts.baseUrl + o.path);
    for (const [k, v] of Object.entries(o.query ?? {}))
      if (v !== undefined) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Client-Type': 'mobile',
    };
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    if ((o.auth ?? true) && this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
    if ((o.tenant ?? true) && this.tenantId) headers['X-Tenant-Id'] = this.tenantId;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? this.timeoutMs);
    o.signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        method: o.method ?? 'GET',
        headers,
        body: o.body === undefined ? undefined : JSON.stringify(o.body),
        signal: ctrl.signal,
      });
    } catch {
      throw o.signal?.aborted
        ? new ApiError(0, 'ABORTED', 'Request cancelled')
        : ctrl.signal.aborted
          ? new ApiError(0, 'TIMEOUT', 'Request timed out')
          : new ApiError(0, 'NETWORK_ERROR', 'Network request failed');
    } finally {
      clearTimeout(timer);
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      json = undefined;
    }
    const body = json as
      | {
          success?: boolean;
          data?: unknown;
          meta?: Envelope<unknown>['meta'];
          error?: { code?: string; message?: string; details?: unknown };
          requestId?: string;
        }
      | undefined;
    if (!res.ok || body?.success === false) {
      throw new ApiError(
        res.status,
        body?.error?.code ?? `HTTP_${res.status}`,
        body?.error?.message ?? `Request failed (${res.status})`,
        body?.error?.details,
        body?.requestId,
      );
    }
    if (!o.schema) return { status: res.status, data: body?.data, meta: body?.meta } as never;
    const parsed = o.schema.safeParse(body?.data);
    if (!parsed.success)
      throw new ApiError(
        res.status,
        'BAD_RESPONSE',
        'The server sent an unexpected response.',
        undefined,
        body?.requestId,
      );
    return { status: res.status, data: parsed.data, meta: body?.meta } as never;
  }
}
