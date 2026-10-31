export const HOSTING_MODES = ['MANAGED', 'CUSTOMER_OWNED'] as const;
export type DatabaseHostingMode = (typeof HOSTING_MODES)[number];

export const DB_STATUSES = [
  'PENDING',
  'PROVISIONING',
  'VERIFYING',
  'READY',
  'FAILED',
  'SUSPENDED',
] as const;
export type DatabaseStatus = (typeof DB_STATUSES)[number];

/** Connection health is tracked separately from the lifecycle status: a READY database can be temporarily unreachable. */
export const DB_HEALTH = ['UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNREACHABLE'] as const;
export type DatabaseHealth = (typeof DB_HEALTH)[number];

/** Machine-readable reasons shown to company administrators. Messages never contain credentials. */
export type HostingErrorCode =
  | 'CUSTOMER_DB_DISABLED'
  | 'INVALID_CONNECTION_STRING'
  | 'UNSUPPORTED_SCHEME'
  | 'UNSUPPORTED_OPTION'
  | 'INVALID_DATABASE_NAME'
  | 'HOST_NOT_ALLOWED'
  | 'TLS_REQUIRED'
  | 'AUTH_FAILED'
  | 'PERMISSION_DENIED'
  | 'NETWORK_UNREACHABLE'
  | 'CONNECTION_TIMEOUT'
  | 'TLS_ERROR'
  | 'UNSUPPORTED_VERSION'
  | 'UNSUPPORTED_TOPOLOGY'
  | 'DATABASE_NOT_EMPTY'
  | 'DATABASE_IN_USE'
  | 'DATABASE_MISMATCH'
  | 'SCHEMA_TOO_NEW'
  | 'TENANT_DB_UNAVAILABLE'
  | 'TENANT_DB_NOT_READY'
  | 'VERIFICATION_FAILED';

export interface VerificationCheck {
  name: 'connection' | 'authentication' | 'version' | 'topology' | 'permissions' | 'emptiness' | 'binding';
  ok: boolean;
  detail?: string;
}

export interface VerificationResult {
  ok: true;
  databaseName: string;
  serverVersion: string;
  fingerprint: string;
  checks: VerificationCheck[];
}
