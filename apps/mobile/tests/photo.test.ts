import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-image-picker', () => ({}));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

import { formatCoords, mapUrl } from '../src/lib/maps';
import { PHOTO_MAX_BYTES, PhotoError, validatePhoto } from '../src/lib/photo';

describe('validatePhoto', () => {
  it('accepts jpeg/png/webp up to the size limit', () => {
    expect(validatePhoto('image/jpeg', 1000)).toBe('image/jpeg');
    expect(validatePhoto(undefined, 1000)).toBe('image/jpeg');
    expect(validatePhoto('IMAGE/PNG', PHOTO_MAX_BYTES)).toBe('image/png');
  });
  it('rejects other types, empty and oversize images', () => {
    expect(() => validatePhoto('image/gif', 10)).toThrow(PhotoError);
    expect(() => validatePhoto('text/html', 10)).toThrow(PhotoError);
    expect(() => validatePhoto('image/jpeg', 0)).toThrow(PhotoError);
    expect(() => validatePhoto('image/jpeg', PHOTO_MAX_BYTES + 1)).toThrow(PhotoError);
  });
});

describe('maps', () => {
  it('builds an open-in-maps link per platform', () => {
    expect(mapUrl(12.9716, 77.5946, 'ios')).toMatch(
      /^https:\/\/maps\.apple\.com\/\?ll=12\.971600,77\.594600/,
    );
    expect(mapUrl(12.9716, 77.5946, 'android')).toMatch(/^geo:12\.971600,77\.594600\?q=/);
    expect(mapUrl(12.9716, -77.5946, 'web')).toContain('openstreetmap.org');
  });
  it('formats coordinates with hemisphere letters', () => {
    expect(formatCoords(12.9716, 77.5946)).toBe('12.97160° N, 77.59460° E');
    expect(formatCoords(-33.8688, -70.5)).toBe('33.86880° S, 70.50000° W');
  });
});
