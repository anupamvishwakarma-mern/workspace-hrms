import { createHash } from 'node:crypto';
import { decryptField, encryptField, parseEncryptionKey } from '../../utils/fieldCrypto';

/**
 * Versioned encryption keys for customer connection strings.
 * TENANT_DB_ENCRYPTION_KEYS = "v1:<64 hex>,v2:<64 hex>"; new secrets use the active version, older versions stay
 * readable until every record has been re-encrypted (rotateConnectionSecret), then the old key can be dropped.
 * In production, prefer injecting these from a secret manager / KMS-decrypted at deploy time (docs/DATABASE_HOSTING.md).
 */
export interface KeyRing {
  active: string;
  keys: ReadonlyMap<string, Buffer>;
}

const VERSION_RE = /^[A-Za-z0-9_-]{1,20}$/;

export function parseKeyRing(raw: string, activeVersion?: string): KeyRing {
  const keys = new Map<string, Buffer>();
  let last = '';
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const i = part.indexOf(':');
    const version = i > 0 ? part.slice(0, i) : '';
    if (!VERSION_RE.test(version)) throw new Error('TENANT_DB_ENCRYPTION_KEYS entries must look like "v1:<64 hex characters>"');
    if (keys.has(version)) throw new Error(`Duplicate key version in TENANT_DB_ENCRYPTION_KEYS: ${version}`);
    keys.set(version, parseEncryptionKey(part.slice(i + 1)));
    last = version;
  }
  if (keys.size === 0) throw new Error('TENANT_DB_ENCRYPTION_KEYS is empty');
  const active = activeVersion ?? last;
  if (!keys.has(active)) throw new Error(`TENANT_DB_ACTIVE_KEY_VERSION "${active}" is not in TENANT_DB_ENCRYPTION_KEYS`);
  return { active, keys };
}

export interface EncryptedConnection {
  encryptedConnectionString: string;
  encryptionKeyVersion: string;
}

/** The tenant id is bound in as authenticated data: a ciphertext copied onto another tenant fails to decrypt. */
const aad = (tenantId: string) => `tenant-db-connection:${tenantId}`;

export function encryptConnectionString(ring: KeyRing, tenantId: string, uri: string): EncryptedConnection {
  return {
    encryptedConnectionString: encryptField(uri, ring.keys.get(ring.active)!, aad(tenantId)),
    encryptionKeyVersion: ring.active,
  };
}

export function decryptConnectionString(
  ring: KeyRing,
  tenantId: string,
  cfg: { encryptedConnectionString: string; encryptionKeyVersion?: string | null },
): string {
  const version = cfg.encryptionKeyVersion ?? ring.active;
  const key = ring.keys.get(version);
  if (!key) throw new Error(`Encryption key version "${version}" is not configured`);
  return decryptField(cfg.encryptedConnectionString, key, aad(tenantId));
}

export const needsRotation = (ring: KeyRing, cfg: { encryptionKeyVersion?: string | null }): boolean =>
  (cfg.encryptionKeyVersion ?? ring.active) !== ring.active;

/** Stable short id of a stored secret, used to notice that another instance replaced the credentials. */
export const secretStamp = (encrypted: string): string =>
  createHash('sha256').update(encrypted).digest('hex').slice(0, 16);
