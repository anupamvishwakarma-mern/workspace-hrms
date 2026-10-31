import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliverLead, LeadsNotConfiguredError } from '../src/lib/integrations/leads';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('lead delivery is honest', () => {
  it('refuses in production when no destination is configured', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LEAD_WEBHOOK_URL', '');
    await expect(deliverLead('demo', { email: 'a@b.com' })).rejects.toBeInstanceOf(
      LeadsNotConfiguredError,
    );
  });
  it('posts to the webhook with a signature and strips anti-spam fields', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LEAD_WEBHOOK_URL', 'https://hooks.example/lead');
    vi.stubEnv('LEAD_WEBHOOK_SECRET', 's3cret');
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));
    const r = await deliverLead('contact', { email: 'a@b.com', website: '', startedAt: 1 });
    expect(r.destination).toBe('webhook');
    const [, init] = spy.mock.calls[0]!;
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.data).toEqual({ email: 'a@b.com' });
    expect((init as RequestInit).headers).toHaveProperty('X-Signature-256');
  });
  it('fails (not succeeds) when the webhook errors', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LEAD_WEBHOOK_URL', 'https://hooks.example/lead');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('no', { status: 500 }));
    await expect(deliverLead('demo', {})).rejects.toThrow();
  });
  it('writes a local file in development only', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'leads-'));
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('LEAD_WEBHOOK_URL', '');
    vi.spyOn(process, 'cwd').mockReturnValue(dir);
    const r = await deliverLead('newsletter', { email: 'a@b.com' });
    expect(r.destination).toBe('dev-file');
    expect(readFileSync(join(dir, '.data', 'leads.jsonl'), 'utf8')).toContain('a@b.com');
  });
});
