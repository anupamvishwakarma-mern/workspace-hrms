import type { Env } from '../../config/env';
import { parseKeyRing, type KeyRing } from './secrets';

/** Hosting configuration derived from the environment (see docs/DATABASE_HOSTING.md). */
export interface HostingSettings {
  /** Platform switch: when false (or no encryption keys), only managed hosting is offered. */
  customerOwnedEnabled: boolean;
  keyRing?: KeyRing;
  managedClusterId: string;
  allowPrivateHosts: boolean;
  /** Username and password are mandatory in the connection string (relaxed only where private hosts are allowed: dev/tests). */
  requireCredentials: boolean;
  requireTls: boolean;
  allowedPorts: { min: number; max: number };
  connectTimeoutMs: number;
  socketTimeoutMs: number;
  maxPoolSize: number;
  idleCloseMs: number;
  maxCustomerConnections: number;
  minMongoVersion: string;
  health: { minIntervalMs: number; maxBackoffMs: number; concurrency: number };
  migrationBatch: number;
  /** Backoff after a failed open of a customer connection, so requests fail fast instead of piling up. */
  openBackoff: { baseMs: number; maxMs: number };
}

export const DEFAULT_SETTINGS: HostingSettings = {
  customerOwnedEnabled: false,
  managedClusterId: 'primary',
  allowPrivateHosts: false,
  requireCredentials: true,
  requireTls: true,
  allowedPorts: { min: 27000, max: 27999 },
  connectTimeoutMs: 8_000,
  socketTimeoutMs: 30_000,
  maxPoolSize: 5,
  idleCloseMs: 30 * 60_000,
  maxCustomerConnections: 200,
  minMongoVersion: '6.0',
  health: { minIntervalMs: 4 * 60_000, maxBackoffMs: 60 * 60_000, concurrency: 5 },
  migrationBatch: 5,
  openBackoff: { baseMs: 5_000, maxMs: 5 * 60_000 },
};

export function hostingSettingsFromEnv(env: Env): HostingSettings {
  const keyRing = env.TENANT_DB_ENCRYPTION_KEYS
    ? parseKeyRing(env.TENANT_DB_ENCRYPTION_KEYS, env.TENANT_DB_ACTIVE_KEY_VERSION)
    : undefined;
  return {
    customerOwnedEnabled: env.CUSTOMER_DB_ENABLED && !!keyRing,
    keyRing,
    managedClusterId: env.MANAGED_CLUSTER_ID,
    allowPrivateHosts: env.CUSTOMER_DB_ALLOW_PRIVATE_HOSTS,
    requireCredentials: !env.CUSTOMER_DB_ALLOW_PRIVATE_HOSTS,
    requireTls: env.CUSTOMER_DB_REQUIRE_TLS,
    allowedPorts: { min: env.CUSTOMER_DB_PORT_MIN, max: env.CUSTOMER_DB_PORT_MAX },
    connectTimeoutMs: env.CUSTOMER_DB_CONNECT_TIMEOUT_MS,
    socketTimeoutMs: DEFAULT_SETTINGS.socketTimeoutMs,
    maxPoolSize: env.CUSTOMER_DB_MAX_POOL_SIZE,
    idleCloseMs: env.CUSTOMER_DB_IDLE_CLOSE_MINUTES * 60_000,
    maxCustomerConnections: env.CUSTOMER_DB_MAX_CONNECTIONS,
    minMongoVersion: env.CUSTOMER_DB_MIN_MONGO_VERSION,
    health: { ...DEFAULT_SETTINGS.health, minIntervalMs: env.CUSTOMER_DB_HEALTH_MIN_INTERVAL_SECONDS * 1000 },
    migrationBatch: env.TENANT_DB_MIGRATION_BATCH,
    openBackoff: DEFAULT_SETTINGS.openBackoff,
  };
}
