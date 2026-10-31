import { AppError } from '../../utils/errors';
import type { HostingErrorCode } from './types';

const STATUS: Record<HostingErrorCode, number> = {
  CUSTOMER_DB_DISABLED: 503,
  INVALID_CONNECTION_STRING: 422,
  UNSUPPORTED_SCHEME: 422,
  UNSUPPORTED_OPTION: 422,
  INVALID_DATABASE_NAME: 422,
  HOST_NOT_ALLOWED: 422,
  TLS_REQUIRED: 422,
  AUTH_FAILED: 422,
  PERMISSION_DENIED: 422,
  NETWORK_UNREACHABLE: 422,
  CONNECTION_TIMEOUT: 422,
  TLS_ERROR: 422,
  UNSUPPORTED_VERSION: 422,
  UNSUPPORTED_TOPOLOGY: 422,
  DATABASE_NOT_EMPTY: 409,
  DATABASE_IN_USE: 409,
  DATABASE_MISMATCH: 409,
  SCHEMA_TOO_NEW: 409,
  TENANT_DB_UNAVAILABLE: 503,
  TENANT_DB_NOT_READY: 503,
  VERIFICATION_FAILED: 422,
};

/** A hosting/connection problem. Its message is safe to show to a company administrator (never holds credentials). */
export class HostingError extends AppError {
  constructor(
    public readonly hostingCode: HostingErrorCode,
    message: string,
    details?: unknown,
  ) {
    super(STATUS[hostingCode], hostingCode, redactSecrets(message), details);
    this.name = 'HostingError';
  }
}

/** Removes credentials from any text that may contain a MongoDB connection string. */
export function redactSecrets(text: string): string {
  return text
    .replace(/(mongodb(?:\+srv)?:\/\/)[^@\s/]*@/gi, '$1***:***@')
    .replace(/(password|pwd|passwd)=([^&\s]+)/gi, '$1=***');
}

export function safeErrorMessage(err: unknown): string {
  return redactSecrets(err instanceof Error ? err.message : String(err)).slice(0, 300);
}

/**
 * Maps a driver error to a stable code and a message that tells the administrator what to fix. Raw driver text is
 * never returned: it can echo hosts, usernames or parts of the URI.
 */
export function classifyMongoError(err: unknown): HostingError {
  if (err instanceof HostingError) return err;
  const e = err as { name?: string; code?: number | string; codeName?: string; message?: string; cause?: unknown };
  const msg = `${e.name ?? ''} ${e.message ?? ''} ${(e.cause as { message?: string } | undefined)?.message ?? ''}`;
  const code = e.code;
  if (code === 18 || /authentication failed|bad auth|SCRAM|auth.*fail/i.test(msg))
    return new HostingError(
      'AUTH_FAILED',
      'The database rejected the username or password. Check the credentials and the authentication database (authSource).',
    );
  if (code === 13 || code === 8000 || code === 'Unauthorized' || /not authorized|unauthorized|requires authentication|permission denied/i.test(msg))
    return new HostingError(
      'PERMISSION_DENIED',
      'The database user lacks the required permissions. Grant it readWrite on this database (it must be able to create collections and indexes).',
    );
  if (/ssl|tls|certificate|handshake|self.signed|CERT_|ERR_SSL/i.test(msg))
    return new HostingError(
      'TLS_ERROR',
      'A secure (TLS) connection could not be established. Check that the server presents a valid, trusted certificate.',
    );
  if (/timed? ?out|ETIMEDOUT|serverSelectionTimeout|Server selection timed out|connect.*timeout/i.test(msg))
    return new HostingError(
      'CONNECTION_TIMEOUT',
      'The connection timed out. Check that the database is running and that its firewall or IP allow-list permits our servers.',
    );
  if (/ENOTFOUND|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|getaddrinfo|querySrv|ECONNRESET|MongoNetworkError|MongoServerSelectionError/i.test(msg))
    return new HostingError(
      'NETWORK_UNREACHABLE',
      'The database host could not be reached. Check the host name, port and network access (firewall or IP allow-list).',
    );
  return new HostingError('VERIFICATION_FAILED', 'The database could not be verified. Please check the connection string and try again.');
}
