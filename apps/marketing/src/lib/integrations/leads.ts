import { createHmac } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Lead delivery. A lead is "received" only if it really reached a destination:
 *  1. LEAD_WEBHOOK_URL set  -> POST there (CRM, Zapier/Make, Slack relay, your API). Optional HMAC signature header.
 *  2. Otherwise, outside production -> appended to .data/leads.jsonl so local development works honestly.
 *  3. Otherwise (production, nothing configured) -> LeadsNotConfiguredError, and the API answers 503.
 * Nothing is faked: the route never reports success unless one of 1 or 2 actually happened.
 */
export type LeadKind =
  'demo' | 'contact' | 'service' | 'partner' | 'newsletter' | 'newsletter_unsubscribe';

export class LeadsNotConfiguredError extends Error {}
export class LeadDeliveryError extends Error {}

export interface DeliveryResult {
  destination: 'webhook' | 'dev-file';
}

export async function deliverLead(
  kind: LeadKind,
  data: Record<string, unknown>,
  meta: { ip?: string } = {},
): Promise<DeliveryResult> {
  const record = {
    kind,
    receivedAt: new Date().toISOString(),
    data: stripAntiSpam(data),
    ip: meta.ip,
  };
  const url = (process.env.LEAD_WEBHOOK_URL ?? '').trim();
  if (url) {
    if (!/^https:\/\//.test(url) && process.env.NODE_ENV === 'production')
      throw new LeadsNotConfiguredError('LEAD_WEBHOOK_URL must be https in production');
    const body = JSON.stringify(record);
    const secret = (process.env.LEAD_WEBHOOK_SECRET ?? '').trim();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secret)
      headers['X-Signature-256'] =
        `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      });
    } catch {
      throw new LeadDeliveryError('Webhook unreachable');
    }
    if (!res.ok) throw new LeadDeliveryError(`Webhook responded ${res.status}`);
    return { destination: 'webhook' };
  }
  if (process.env.NODE_ENV !== 'production') {
    const dir = join(process.cwd(), '.data');
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, 'leads.jsonl'), JSON.stringify(record) + '\n', 'utf8');
    return { destination: 'dev-file' };
  }
  throw new LeadsNotConfiguredError('No lead destination configured');
}

function stripAntiSpam(d: Record<string, unknown>) {
  const { website: _w, startedAt: _s, ...rest } = d;
  void _w;
  void _s;
  return rest;
}
