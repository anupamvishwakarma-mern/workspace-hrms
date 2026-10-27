import nodemailer, { type Transporter } from 'nodemailer';
import type { Types } from 'mongoose';
import type { Env } from '../../config/env';
import { EmailOutbox } from '../../database/models/emailOutbox.model';

export interface TemplatedEmail {
  tenantId?: Types.ObjectId;
  to: string;
  template: 'ACTIVATION' | 'PASSWORD_RESET';
  subject: string;
  link: string;
}

const BODY: Record<TemplatedEmail['template'], (link: string) => string> = {
  ACTIVATION: (link) =>
    `You have been invited to Workforce.\n\nSet your password and sign in:\n${link}\n\nThis link can be used once and expires soon. If you were not expecting this, ignore this email.`,
  PASSWORD_RESET: (link) =>
    `We received a request to reset your Workforce password.\n\nChoose a new password:\n${link}\n\nThis link can be used once and expires soon. If you did not ask for this, ignore this email; your password has not changed.`,
};

let cached: { key: string; transport: Transporter } | undefined;
function transportFor(env: Env): Transporter {
  const port = Number(env.SMTP_PORT ?? 587);
  const key = `${env.SMTP_HOST}:${port}:${env.SMTP_USER}:${env.NODE_ENV}`;
  if (cached?.key !== key) {
    cached = {
      key,
      transport: nodemailer.createTransport({
        host: env.SMTP_HOST,
        port,
        secure: port === 465,
        requireTLS: env.NODE_ENV === 'production' && port !== 465,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      }),
    };
  }
  return cached.transport;
}

const inflight = new Set<Promise<void>>();
/** Resolves when every email handed to the provider so far has finished (used by tests and shutdown). */
export const drainEmailDeliveries = async (): Promise<void> => {
  await Promise.allSettled([...inflight]);
};

/**
 * Provider-independent email entry point.
 *  - EMAIL_PROVIDER=none: the message is only *recorded* (RECORDED_NOT_SENT). Never reported as delivered.
 *  - EMAIL_PROVIDER=smtp: delivery runs detached from the request, so response time does not reveal
 *    whether an account exists (password-reset must not allow enumeration). The outbox row moves
 *    QUEUED -> SENT or FAILED. A failure is logged and recorded but never thrown to the caller.
 *
 * One-time links are stored on the row only outside production with provider "none" (local previews).
 * They are never persisted when a real provider is configured, so a failed send cannot be replayed from
 * the database: the user simply requests a new link.
 */
export async function sendEmail(env: Env, email: TemplatedEmail): Promise<void> {
  if (env.EMAIL_PROVIDER === 'none') {
    await EmailOutbox.create({
      tenantId: email.tenantId,
      to: email.to,
      template: email.template,
      subject: email.subject,
      link: env.NODE_ENV === 'production' ? undefined : email.link,
      status: 'RECORDED_NOT_SENT',
    });
    return;
  }
  const row = await EmailOutbox.create({
    tenantId: email.tenantId,
    to: email.to,
    template: email.template,
    subject: email.subject,
    status: 'QUEUED',
  });
  const job = (async () => {
    try {
      await transportFor(env).sendMail({
        from: env.EMAIL_FROM,
        to: email.to,
        subject: email.subject,
        text: BODY[email.template](email.link),
      });
      await EmailOutbox.updateOne(
        { _id: row._id, tenantId: row.tenantId },
        { $set: { status: 'SENT', sentAt: new Date() } },
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message.slice(0, 200) : 'unknown error';
      console.error(`[email] delivery failed for outbox ${String(row._id)}: ${reason}`);
      await EmailOutbox.updateOne(
        { _id: row._id, tenantId: row.tenantId },
        { $set: { status: 'FAILED', error: reason } },
      ).catch(() => undefined);
    }
  })();
  inflight.add(job);
  void job.finally(() => inflight.delete(job));
}
