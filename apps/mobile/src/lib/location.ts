import * as Location from 'expo-location';

export interface LocationReading {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  mockLocationDetected?: boolean;
}

export type LocationFailure = 'PERMISSION_DENIED' | 'SERVICES_OFF' | 'TIMEOUT' | 'UNAVAILABLE';
export class LocationError extends Error {
  constructor(
    public readonly kind: LocationFailure,
    public readonly canAskAgain = false,
  ) {
    super(kind);
    this.name = 'LocationError';
  }
}

export const LOCATION_MESSAGES: Record<LocationFailure, string> = {
  PERMISSION_DENIED: 'Location permission is needed to check in. Allow it in Settings.',
  SERVICES_OFF: 'Location services are turned off. Turn them on and try again.',
  TIMEOUT: 'Could not get a GPS fix in time. Move to an open area and try again.',
  UNAVAILABLE: 'Could not read your location. Try again.',
};

const FIX_TIMEOUT_MS = 20_000;
const MAX_FIX_AGE_MS = 2 * 60_000;

/**
 * One foreground reading, taken only when the user taps a punch button. There is no background or
 * continuous tracking anywhere in this app. Coordinates are never logged.
 */
export async function readLocationOnce(): Promise<LocationReading> {
  let perm = await Location.getForegroundPermissionsAsync();
  if (perm.status !== Location.PermissionStatus.GRANTED) {
    if (!perm.canAskAgain) throw new LocationError('PERMISSION_DENIED', false);
    perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== Location.PermissionStatus.GRANTED)
      throw new LocationError('PERMISSION_DENIED', perm.canAskAgain);
  }
  if (!(await Location.hasServicesEnabledAsync())) throw new LocationError('SERVICES_OFF');

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new LocationError('TIMEOUT')), FIX_TIMEOUT_MS);
      }),
    ]);
    if (Date.now() - pos.timestamp > MAX_FIX_AGE_MS) throw new LocationError('UNAVAILABLE');
    return {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      // Unknown accuracy is reported as very poor so the server rejects it rather than trusting it.
      accuracyMeters: Math.max(0, pos.coords.accuracy ?? 100000),
      // Android only; reported to the server as a risk signal for reviewers, not enforced on the device.
      ...(pos.mocked === true ? { mockLocationDetected: true } : {}),
    };
  } catch (e) {
    if (e instanceof LocationError) throw e;
    throw new LocationError('UNAVAILABLE');
  } finally {
    if (timer) clearTimeout(timer);
  }
}
