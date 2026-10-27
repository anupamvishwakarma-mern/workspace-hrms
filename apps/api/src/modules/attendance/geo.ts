const EARTH_RADIUS_M = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres (Haversine). */
export function haversineMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface GeoPolicy {
  /** Whether a position must be inside a registered geofence. */
  requireGeofence: boolean;
  maxAccuracyMeters: number;
}
export interface Fence {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}
export interface Reading {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  mockLocationDetected?: boolean;
}

export type GeoFailure =
  'LOCATION_REQUIRED' | 'POOR_ACCURACY' | 'NO_GEOFENCE_CONFIGURED' | 'OUTSIDE_GEOFENCE';

export interface GeoVerdict {
  ok: boolean;
  method: 'GEOFENCE' | 'ACCURACY_ONLY' | 'NOT_REQUIRED';
  failure?: GeoFailure;
  workLocationId?: string;
  distanceMeters?: number;
  riskSignals: { mockLocationDetected: boolean };
}

/**
 * Pure geofence evaluation. `mode`:
 *  - OFFICE: must be inside an allowed fence when policy.requireGeofence
 *  - FIELD:  a good-quality reading is required but no fence
 *  - REMOTE: location optional; recorded if provided
 * A geofence is evidence, not proof, of presence: risk signals are recorded, never treated as conclusive.
 */
export function evaluateLocation(
  mode: 'OFFICE' | 'FIELD' | 'REMOTE',
  policy: GeoPolicy,
  reading: Reading | undefined,
  fences: Fence[],
): GeoVerdict {
  const risk = { mockLocationDetected: !!reading?.mockLocationDetected };
  if (mode === 'REMOTE') return { ok: true, method: 'NOT_REQUIRED', riskSignals: risk };
  if (mode === 'OFFICE' && !policy.requireGeofence)
    return { ok: true, method: 'NOT_REQUIRED', riskSignals: risk };
  if (!reading)
    return { ok: false, method: 'GEOFENCE', failure: 'LOCATION_REQUIRED', riskSignals: risk };
  if (!(reading.accuracyMeters <= policy.maxAccuracyMeters))
    return { ok: false, method: 'GEOFENCE', failure: 'POOR_ACCURACY', riskSignals: risk };
  if (mode === 'FIELD') return { ok: true, method: 'ACCURACY_ONLY', riskSignals: risk };
  if (fences.length === 0)
    return { ok: false, method: 'GEOFENCE', failure: 'NO_GEOFENCE_CONFIGURED', riskSignals: risk };
  let best: { fence: Fence; d: number } | undefined;
  for (const f of fences) {
    const d = haversineMeters(reading, f);
    if (!best || d < best.d) best = { fence: f, d };
  }
  const inside = best!.d <= best!.fence.radiusMeters;
  return {
    ok: inside,
    method: 'GEOFENCE',
    failure: inside ? undefined : 'OUTSIDE_GEOFENCE',
    workLocationId: best!.fence.id,
    distanceMeters: Math.round(best!.d),
    riskSignals: risk,
  };
}
