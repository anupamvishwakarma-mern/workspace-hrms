import type { Types } from 'mongoose';
import type { Env } from '../../config/env';
import { Employee } from '../../database/models/employee.model';
import { PushToken } from '../../database/models/pushToken.model';

export interface PushMessage {
  title: string;
  body: string;
  /** Small, non-sensitive routing data only (type + id). Never put personal details here. */
  data?: Record<string, string>;
}

interface Ticket {
  status: 'ok' | 'error';
  details?: { error?: string };
}

const inflight = new Set<Promise<void>>();
export const drainPushDeliveries = async (): Promise<void> => {
  await Promise.allSettled([...inflight]);
};

/** Sends to every registered device of a user. Returns how many tokens the provider accepted. */
export async function pushToUser(
  env: Env,
  userId: Types.ObjectId,
  msg: PushMessage,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  if (env.PUSH_PROVIDER !== 'expo') return 0;
  const tokens = await PushToken.find({ userId }).select('token').lean();
  if (tokens.length === 0) return 0;
  let accepted = 0;
  for (let i = 0; i < tokens.length; i += 100) {
    const chunk = tokens.slice(i, i + 100);
    const res = await fetchImpl(env.EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(
        chunk.map((t) => ({
          to: t.token,
          sound: 'default',
          title: msg.title,
          body: msg.body,
          data: msg.data,
        })),
      ),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Push provider responded ${res.status}`);
    const json = (await res.json()) as { data?: Ticket[] };
    const dead: string[] = [];
    (json.data ?? []).forEach((ticket, idx) => {
      if (ticket.status === 'ok') accepted += 1;
      else if (ticket.details?.error === 'DeviceNotRegistered') dead.push(chunk[idx]!.token);
    });
    // The provider says the app was uninstalled / token revoked: stop sending to it.
    if (dead.length) await PushToken.deleteMany({ token: { $in: dead } });
  }
  return accepted;
}

/**
 * Fire-and-forget notification to the person behind an employee record. It must never fail or slow the
 * business action that triggered it, so errors are swallowed (logged) and the work is detached.
 */
export function notifyEmployee(
  env: Env,
  tenantId: Types.ObjectId,
  employeeId: Types.ObjectId,
  msg: PushMessage,
): void {
  if (env.PUSH_PROVIDER !== 'expo') return;
  const job = (async () => {
    try {
      const emp = await Employee.findOne({ _id: employeeId, tenantId }).select('userId').lean();
      if (emp?.userId) await pushToUser(env, emp.userId, msg);
    } catch (err) {
      console.error(`[push] delivery failed: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  })();
  inflight.add(job);
  void job.finally(() => inflight.delete(job));
}
