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
}

/** Message safe to show. 5xx details are never surfaced. */
export function userMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'NETWORK_ERROR')
      return 'Cannot reach the server. Check your connection and try again.';
    if (err.status === 429) return 'Too many requests. Wait a moment and try again.';
    if (err.status >= 500) return 'Something went wrong on the server. Try again shortly.';
    if (err.code === 'VALIDATION_ERROR' && Array.isArray(err.details)) {
      const first = err.details[0] as { path?: string; message?: string } | undefined;
      if (first?.message) return first.path ? `${first.path}: ${first.message}` : first.message;
    }
    return err.message;
  }
  return 'Something went wrong. Try again.';
}
