import { describe, expect, it } from 'vitest';
import { evaluateLocation, haversineMeters, type Fence } from '../src/modules/attendance/geo';

describe('haversine', () => {
  it('is zero for identical points', () => {
    expect(
      haversineMeters({ latitude: 12.97, longitude: 77.59 }, { latitude: 12.97, longitude: 77.59 }),
    ).toBe(0);
  });
  it('matches a known distance (Bengaluru -> Chennai about 290 km)', () => {
    const d = haversineMeters(
      { latitude: 12.9716, longitude: 77.5946 },
      { latitude: 13.0827, longitude: 80.2707 },
    );
    expect(d / 1000).toBeGreaterThan(285);
    expect(d / 1000).toBeLessThan(295);
  });
  it('one degree of latitude is about 111.2 km', () => {
    expect(
      haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }) / 1000,
    ).toBeCloseTo(111.2, 0);
  });
  it('handles the antimeridian', () => {
    expect(
      haversineMeters({ latitude: 0, longitude: 179.9999 }, { latitude: 0, longitude: -179.9999 }),
    ).toBeLessThan(30);
  });
});

const office: Fence = {
  id: 'o1',
  name: 'HQ',
  latitude: 12.9716,
  longitude: 77.5946,
  radiusMeters: 100,
};
const policy = { requireGeofence: true, maxAccuracyMeters: 50 };
// ~0.001 degrees latitude is about 111 m
const at = (dLat: number, acc = 10) => ({
  latitude: office.latitude + dLat,
  longitude: office.longitude,
  accuracyMeters: acc,
});

describe('geofence evaluation', () => {
  it('passes inside the radius and reports the matched location', () => {
    const v = evaluateLocation('OFFICE', policy, at(0.0005), [office]);
    expect(v.ok).toBe(true);
    expect(v.workLocationId).toBe('o1');
    expect(v.distanceMeters).toBeLessThan(100);
  });
  it('fails outside the radius', () => {
    const v = evaluateLocation('OFFICE', policy, at(0.002), [office]);
    expect(v.ok).toBe(false);
    expect(v.failure).toBe('OUTSIDE_GEOFENCE');
    expect(v.distanceMeters).toBeGreaterThan(100);
  });
  it('rejects poor accuracy even when inside', () => {
    expect(evaluateLocation('OFFICE', policy, at(0, 51), [office]).failure).toBe('POOR_ACCURACY');
    expect(evaluateLocation('OFFICE', policy, at(0, 50), [office]).ok).toBe(true);
    expect(
      evaluateLocation('OFFICE', policy, { ...at(0), accuracyMeters: NaN }, [office]).failure,
    ).toBe('POOR_ACCURACY');
  });
  it('requires a location, and a configured fence', () => {
    expect(evaluateLocation('OFFICE', policy, undefined, [office]).failure).toBe(
      'LOCATION_REQUIRED',
    );
    expect(evaluateLocation('OFFICE', policy, at(0), []).failure).toBe('NO_GEOFENCE_CONFIGURED');
  });
  it('picks the nearest of several fences', () => {
    const far: Fence = { ...office, id: 'far', latitude: 20, longitude: 70 };
    expect(evaluateLocation('OFFICE', policy, at(0), [far, office]).workLocationId).toBe('o1');
  });
  it('mock-location is recorded as a risk signal, not an automatic rejection', () => {
    const v = evaluateLocation('OFFICE', policy, { ...at(0), mockLocationDetected: true }, [
      office,
    ]);
    expect(v.ok).toBe(true);
    expect(v.riskSignals.mockLocationDetected).toBe(true);
  });
  it('remote mode needs no location; field mode needs a good reading but no fence; geofence can be disabled', () => {
    expect(evaluateLocation('REMOTE', policy, undefined, []).ok).toBe(true);
    expect(evaluateLocation('FIELD', policy, undefined, []).failure).toBe('LOCATION_REQUIRED');
    expect(evaluateLocation('FIELD', policy, at(5), []).ok).toBe(true);
    expect(
      evaluateLocation('OFFICE', { ...policy, requireGeofence: false }, undefined, []).ok,
    ).toBe(true);
  });
});
