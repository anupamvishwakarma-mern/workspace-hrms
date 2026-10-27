export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  get isNetwork(): boolean {
    return this.code === 'NETWORK_ERROR' || this.code === 'TIMEOUT';
  }
}

const MESSAGES: Record<string, string> = {
  NETWORK_ERROR: 'Cannot reach the server. Check your connection and try again.',
  TIMEOUT: 'The server took too long to respond. Try again.',
  INVALID_CREDENTIALS: 'Incorrect email or password.',
  ACCOUNT_LOCKED: 'Too many failed attempts. Try again later.',
  RATE_LIMITED: 'Too many requests. Wait a moment and try again.',
  INVALID_TRANSITION: 'That action is not available right now.',
  LOCATION_REQUIRED: 'Location is required to record attendance.',
  POOR_ACCURACY: 'GPS accuracy is too low. Move to an open area and try again.',
  NO_GEOFENCE_CONFIGURED: 'No office location is configured for you. Contact HR.',
  OUTSIDE_GEOFENCE: 'You are outside your permitted attendance area.',
  PHOTO_REQUIRED: 'Your company requires a photo for check in and check out.',
  PHOTO_INVALID: 'The photo did not upload properly. Take it again.',
  PHOTO_ALREADY_USED: 'That photo was already used. Take a new one.',
  STORAGE_NOT_CONFIGURED: 'Photo upload is not set up for this company yet. Contact HR.',
  FORBIDDEN: 'You do not have permission to do that.',
  NOT_FOUND: 'That item was not found.',
};

/** Message safe to show to the user. Server messages are used for validation/business errors. */
export function userMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return MESSAGES.RATE_LIMITED!;
    if (err.code === 'STORAGE_NOT_CONFIGURED') return MESSAGES.STORAGE_NOT_CONFIGURED!;
    if (err.status >= 500) return 'Something went wrong on the server. Try again shortly.';
    return MESSAGES[err.code] ?? err.message;
  }
  return 'Something went wrong. Try again.';
}

export interface GeoErrorDetails {
  exceptionAllowed?: boolean;
  distanceMeters?: number;
  maxAccuracyMeters?: number;
}
export const GEO_CODES = new Set([
  'LOCATION_REQUIRED',
  'POOR_ACCURACY',
  'NO_GEOFENCE_CONFIGURED',
  'OUTSIDE_GEOFENCE',
]);
export const isGeoFailure = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status === 422 && GEO_CODES.has(e.code);
