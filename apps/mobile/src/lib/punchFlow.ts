import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import type { ApiClient } from './api';
import { ApiError } from './errors';
import { readLocationOnce, type LocationReading } from './location';
import { ensureUploaded, type CapturedPhoto } from './photo';
import { clearPending, keyForPunch } from './punch';
import { punchPending, punchRecorded, type EventType } from './schemas';
import { pendingPunchStore } from './session-storage';
import { z } from 'zod';

const PATH: Record<EventType, string> = {
  CHECK_IN: '/attendance/check-in',
  CHECK_OUT: '/attendance/check-out',
  BREAK_START: '/attendance/break-start',
  BREAK_END: '/attendance/break-end',
};

const newKey = () => `wf-${Crypto.randomUUID()}`;

let cachedDeviceId: string | null | undefined;
async function deviceId(): Promise<string | undefined> {
  if (cachedDeviceId === undefined) {
    try {
      cachedDeviceId =
        Platform.OS === 'android'
          ? Application.getAndroidId()
          : await Application.getIosIdForVendorAsync();
    } catch {
      cachedDeviceId = null;
    }
  }
  return cachedDeviceId?.slice(0, 100) || undefined;
}

export type PunchResult =
  | {
      kind: 'RECORDED';
      replayed: boolean;
      eventType: EventType;
      occurredAt: string;
      location: LocationReading;
      eventId: string;
      hasPhoto: boolean;
    }
  | { kind: 'PENDING_REVIEW'; eventType: EventType };

const response = z.union([punchPending, punchRecorded]);

/**
 * One punch: read location once, attach an idempotency key, send. The server decides the time and
 * verifies the location; nothing here is trusted. Throws LocationError / ApiError for the UI to explain.
 */
export async function performPunch(
  api: ApiClient,
  action: EventType,
  exceptionReason?: string,
  photo?: CapturedPhoto,
): Promise<PunchResult> {
  const location = await readLocationOnce();
  const photoId = photo ? await ensureUploaded(api, photo) : undefined;
  const key = await keyForPunch(pendingPunchStore, action, Date.now(), newKey);
  try {
    const res = await api.call({
      method: 'POST',
      path: PATH[action],
      body: {
        idempotencyKey: key,
        location,
        clientTimestamp: new Date().toISOString(),
        deviceId: await deviceId(),
        ...(exceptionReason ? { exceptionReason } : {}),
        ...(photoId ? { photoId } : {}),
      },
      schema: response,
      timeoutMs: 20_000,
    });
    await clearPending(pendingPunchStore);
    const d = res.data;
    if ('status' in d) return { kind: 'PENDING_REVIEW', eventType: d.exception.eventType };
    return {
      kind: 'RECORDED',
      replayed: d.replayed,
      eventType: d.event.eventType,
      occurredAt: d.event.occurredAt,
      location,
      eventId: d.event.id,
      hasPhoto: d.event.hasPhoto,
    };
  } catch (e) {
    // Network/timeouts are ambiguous: keep the key so a retry cannot double-record.
    if (!(e instanceof ApiError && e.isNetwork)) await clearPending(pendingPunchStore);
    throw e;
  }
}
