import type { TrialInput } from '@/lib/validation/schemas';

export type TrialOutcome =
  | {
      status: 'created';
      message: string;
      activationPath?: string;
      hostingMode: 'MANAGED' | 'CUSTOMER_OWNED';
    }
  | { status: 'existing_account'; message: string }
  | { status: 'validation_error'; message: string; fields?: Record<string, string> }
  | { status: 'database_error'; message: string; code?: string }
  | { status: 'unavailable'; message: string }
  | { status: 'failed'; message: string };

const apiOrigin = () => (process.env.API_ORIGIN ?? 'http://localhost:4000').replace(/\/+$/, '');

/** Messages for customer-database verification failures. Only known codes are surfaced; nothing from the upstream body is echoed raw. */
const DB_MESSAGES: Record<string, string> = {
  AUTH_FAILED: 'MongoDB rejected the username or password in the connection string.',
  NETWORK_UNREACHABLE:
    'We could not reach your MongoDB host. Check the address and that our servers are allowed through your firewall.',
  CONNECTION_TIMEOUT: 'The connection to your MongoDB timed out.',
  TLS_ERROR: 'The secure (TLS) connection to your MongoDB failed.',
  UNSUPPORTED_VERSION: 'Your MongoDB version is older than the minimum we support.',
  UNSUPPORTED_TOPOLOGY:
    'Your MongoDB must be a replica set (or sharded cluster) so transactions work.',
  PERMISSION_DENIED:
    'The database user needs permission to create collections, indexes and write data.',
  DATABASE_NOT_EMPTY: 'The target database already contains data. Use an empty database.',
  DATABASE_IN_USE: 'That database is already connected to another company.',
  DATABASE_MISMATCH: 'That database belongs to a different company.',
  INVALID_CONNECTION_STRING: 'That does not look like a valid MongoDB connection string.',
  HOST_NOT_ALLOWED: 'That host is not allowed. Use a publicly reachable MongoDB host.',
  VERIFICATION_FAILED: 'We could not verify your MongoDB. Please check the details and try again.',
};

/**
 * Hands the trial registration to the EXISTING HRMS API (POST /api/v1/signup). This site creates no users and no
 * tenants itself. The connection string is forwarded server-to-server only and is never logged or echoed.
 */
export async function registerTrial(
  input: TrialInput,
  fetchImpl: typeof fetch = fetch,
): Promise<TrialOutcome> {
  const body = {
    name: input.companyName,
    maxEmployees: input.employees,
    timezone: input.timezone,
    owner: { email: input.email, firstName: input.firstName, lastName: input.lastName },
    database:
      input.hostingMode === 'CUSTOMER_OWNED'
        ? {
            hostingMode: 'CUSTOMER_OWNED',
            connectionString: input.connectionString,
            ...(input.databaseName ? { databaseName: input.databaseName } : {}),
          }
        : { hostingMode: 'MANAGED' },
  };
  let res: Response;
  try {
    res = await fetchImpl(`${apiOrigin()}/api/v1/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
      cache: 'no-store',
    });
  } catch {
    return {
      status: 'failed',
      message:
        'We could not reach the registration service. Nothing was created. Please try again shortly.',
    };
  }
  let json: {
    data?: {
      message?: string;
      activationLink?: string;
      company?: { hostingMode?: 'MANAGED' | 'CUSTOMER_OWNED' };
    };
    error?: { code?: string; details?: { path: string; message: string }[] };
  } = {};
  try {
    json = await res.json();
  } catch {
    /* non-JSON upstream */
  }

  if (res.status === 201 && json.data) {
    let activationPath: string | undefined;
    try {
      if (json.data.activationLink) {
        const u = new URL(json.data.activationLink);
        activationPath = u.pathname + u.search;
      }
    } catch {
      /* ignore a malformed link */
    }
    return {
      status: 'created',
      message: json.data.message ?? 'Your workspace has been created.',
      activationPath,
      hostingMode: json.data.company?.hostingMode ?? input.hostingMode,
    };
  }
  const code = json.error?.code;
  if (res.status === 409 && code === 'EMAIL_IN_USE')
    return {
      status: 'existing_account',
      message:
        'An account with this email already exists. Sign in instead, or use a different email.',
    };
  if (res.status === 409)
    return {
      status: 'validation_error',
      message:
        'A company with a similar name already exists. Try a slightly different company name.',
      fields: { companyName: 'Try a different company name' },
    };
  if (res.status === 403 && code === 'SIGNUP_DISABLED')
    return {
      status: 'unavailable',
      message:
        'Self-service signup is not open right now. Please book a demo and we will set you up.',
    };
  if (res.status === 422 && code === 'VALIDATION_ERROR') {
    const fields: Record<string, string> = {};
    for (const d of json.error?.details ?? []) fields[d.path] ??= d.message;
    return {
      status: 'validation_error',
      message: 'Some details were not accepted. Please review the form.',
      fields,
    };
  }
  if (code && DB_MESSAGES[code])
    return { status: 'database_error', code, message: DB_MESSAGES[code]! };
  if (res.status === 429)
    return {
      status: 'failed',
      message: 'Too many attempts. Please wait a few minutes and try again.',
    };
  return {
    status: 'failed',
    message:
      'Registration could not be completed and no account was confirmed. Please try again, or contact us if it keeps happening.',
  };
}
