import { describe, expect, it } from 'vitest';
import {
  assertHostsAllowed,
  databaseFingerprint,
  isBlockedAddress,
  parseMongoUri,
  requireCredentials,
  resolveDatabaseName,
  tlsEnabled,
  type Resolver,
} from '../src/database/hosting/connectionString';
import { HostingError, classifyMongoError, redactSecrets } from '../src/database/hosting/errors';
import { decryptConnectionString, encryptConnectionString, needsRotation, parseKeyRing } from '../src/database/hosting/secrets';
import { DEFAULT_SETTINGS } from '../src/database/hosting/settings';
import { versionAtLeast } from '../src/database/hosting/verify';
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from '../src/database/hosting/migrations';
import { parseEnv } from '../src/config/env';

const KEY1 = 'a'.repeat(64);
const KEY2 = 'b'.repeat(64);
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as HostingError).hostingCode;
  }
  return 'NO_ERROR';
};
const codeAsync = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    return (e as HostingError).hostingCode;
  }
  return 'NO_ERROR';
};
const resolver = (map: Record<string, string[]>, srv: Record<string, { name: string; port: number }[]> = {}): Resolver => ({
  lookupAll: async (h) => {
    if (!map[h]) throw new Error('ENOTFOUND');
    return map[h]!;
  },
  resolveSrv: async (n) => {
    if (!srv[n]) throw new Error('ENOTFOUND');
    return srv[n]!;
  },
});

describe('connection string parsing and policy', () => {
  it('parses srv and multi-host strings', () => {
    const a = parseMongoUri('mongodb+srv://u:p%40ss@cluster0.abcde.mongodb.net/hrms?retryWrites=true&w=majority');
    expect(a).toMatchObject({ scheme: 'mongodb+srv', username: 'u', hasPassword: true, database: 'hrms' });
    const b = parseMongoUri('mongodb://u:p@h1.example.com:27017,h2.example.com:27018/db?replicaSet=rs0&tls=true');
    expect(b.hosts).toHaveLength(2);
    expect(b.options.replicaset).toBe('rs0');
  });

  it('rejects other schemes and malformed strings', () => {
    expect(code(() => parseMongoUri('http://x.com'))).toBe('UNSUPPORTED_SCHEME');
    expect(code(() => parseMongoUri('postgres://u:p@h/db'))).toBe('UNSUPPORTED_SCHEME');
    expect(code(() => parseMongoUri('mongodb://'))).toBe('INVALID_CONNECTION_STRING');
    expect(code(() => parseMongoUri('mongodb://u:p@h.example.com/db name'))).toBe('INVALID_CONNECTION_STRING');
    expect(code(() => parseMongoUri('mongodb+srv://u:p@a.example.com,b.example.com/db'))).toBe('INVALID_CONNECTION_STRING');
    expect(code(() => parseMongoUri('mongodb+srv://u:p@a.example.com:27017/db'))).toBe('INVALID_CONNECTION_STRING');
  });

  it('allow-lists URI options: file-reading, cloud-credential and certificate-weakening options are refused', () => {
    for (const bad of ['tlsCAFile=/etc/passwd', 'tlsCertificateKeyFile=/x', 'tlsInsecure=true', 'tlsAllowInvalidCertificates=true', 'proxyHost=evil.com', 'authMechanism=MONGODB-AWS', 'authMechanism=GSSAPI', 'maxPoolSize=5000'])
      expect(code(() => parseMongoUri(`mongodb://u:p@h.example.com/db?${bad}`)), bad).toBe('UNSUPPORTED_OPTION');
    expect(code(() => parseMongoUri('mongodb://u:p@h.example.com/db?authMechanism=SCRAM-SHA-256&authSource=admin'))).toBe('NO_ERROR');
  });

  it('resolves the database name from the string or the form, never two different ones', () => {
    expect(resolveDatabaseName(parseMongoUri('mongodb://u:p@h.example.com/hrms'))).toBe('hrms');
    expect(resolveDatabaseName(parseMongoUri('mongodb://u:p@h.example.com'), 'acme_hrms')).toBe('acme_hrms');
    expect(code(() => resolveDatabaseName(parseMongoUri('mongodb://u:p@h.example.com')))).toBe('INVALID_DATABASE_NAME');
    expect(code(() => resolveDatabaseName(parseMongoUri('mongodb://u:p@h.example.com/a'), 'b'))).toBe('INVALID_DATABASE_NAME');
    for (const bad of ['admin', 'local', 'config', 'a.b', 'a$b', '-x'])
      expect(code(() => resolveDatabaseName(parseMongoUri('mongodb://u:p@h.example.com'), bad)), bad).toBe('INVALID_DATABASE_NAME');
  });

  it('requires credentials and TLS according to policy', () => {
    expect(code(() => requireCredentials(parseMongoUri('mongodb://h.example.com/db')))).toBe('INVALID_CONNECTION_STRING');
    expect(code(() => requireCredentials(parseMongoUri('mongodb://u@h.example.com/db')))).toBe('INVALID_CONNECTION_STRING');
    expect(tlsEnabled(parseMongoUri('mongodb+srv://u:p@a.example.com/db'), { requireTls: true })).toBe(true);
    expect(tlsEnabled(parseMongoUri('mongodb://u:p@a.example.com/db'), { requireTls: true })).toBe(true);
    expect(tlsEnabled(parseMongoUri('mongodb://u:p@a.example.com/db'), { requireTls: false })).toBe(false);
    expect(code(() => tlsEnabled(parseMongoUri('mongodb://u:p@a.example.com/db?tls=false'), { requireTls: true }))).toBe('TLS_REQUIRED');
  });

  it('fingerprints the database identity, independent of credentials and host order', () => {
    const a = databaseFingerprint(parseMongoUri('mongodb://u:p@h1.example.com,h2.example.com/db'), 'db');
    const b = databaseFingerprint(parseMongoUri('mongodb://x:y@h2.example.com:27017,h1.example.com/db'), 'db');
    const c = databaseFingerprint(parseMongoUri('mongodb://u:p@h1.example.com,h2.example.com/db'), 'other');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('SSRF protection', () => {
  const policy = { allowPrivateHosts: false, allowedPorts: { min: 27000, max: 27999 } };
  it('classifies blocked addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1'])
      expect(isBlockedAddress(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '52.1.2.3', '2606:4700:4700::1111']) expect(isBlockedAddress(ip), ip).toBe(false);
  });
  it('refuses private, loopback, metadata and internal names, and odd ports', async () => {
    const r = resolver({ 'public.example.com': ['52.1.2.3'], 'sneaky.example.com': ['52.1.2.3', '10.0.0.5'], 'db.example.com': ['52.1.2.3'] });
    const check = (uri: string) => codeAsync(() => assertHostsAllowed(parseMongoUri(uri), policy, r));
    expect(await check('mongodb://u:p@public.example.com:27017/db')).toBe('NO_ERROR');
    expect(await check('mongodb://u:p@127.0.0.1:27017/db')).toBe('HOST_NOT_ALLOWED');
    expect(await check('mongodb://u:p@169.254.169.254:27017/db')).toBe('HOST_NOT_ALLOWED');
    expect(await check('mongodb://u:p@localhost:27017/db')).toBe('HOST_NOT_ALLOWED');
    expect(await check('mongodb://u:p@mongo.internal:27017/db')).toBe('HOST_NOT_ALLOWED');
    expect(await check('mongodb://u:p@sneaky.example.com:27017/db')).toBe('HOST_NOT_ALLOWED'); // one private answer is enough
    expect(await check('mongodb://u:p@public.example.com:6379/db')).toBe('HOST_NOT_ALLOWED'); // redis port
    expect(await check('mongodb://u:p@nope.example.com:27017/db')).toBe('NETWORK_UNREACHABLE');
    expect(await check('mongodb://u:p@[::1]:27017/db')).toBe('HOST_NOT_ALLOWED');
  });
  it('checks every SRV target', async () => {
    const srv = { '_mongodb._tcp.good.example.com': [{ name: 'shard0.example.com', port: 27017 }], '_mongodb._tcp.bad.example.com': [{ name: 'evil.example.com', port: 27017 }] };
    const r = resolver({ 'shard0.example.com': ['52.1.2.3'], 'evil.example.com': ['192.168.0.7'] }, srv);
    expect(await codeAsync(() => assertHostsAllowed(parseMongoUri('mongodb+srv://u:p@good.example.com/db'), policy, r))).toBe('NO_ERROR');
    expect(await codeAsync(() => assertHostsAllowed(parseMongoUri('mongodb+srv://u:p@bad.example.com/db'), policy, r))).toBe('HOST_NOT_ALLOWED');
    expect(await codeAsync(() => assertHostsAllowed(parseMongoUri('mongodb+srv://u:p@missing.example.com/db'), policy, r))).toBe('NETWORK_UNREACHABLE');
  });
  it('can be relaxed only explicitly (development)', async () => {
    expect(await codeAsync(() => assertHostsAllowed(parseMongoUri('mongodb://127.0.0.1:1234/db'), { allowPrivateHosts: true, allowedPorts: policy.allowedPorts }))).toBe('NO_ERROR');
  });
});

describe('connection-string encryption and key rotation', () => {
  const ring = parseKeyRing(`v1:${KEY1}`);
  const URI = 'mongodb+srv://user:S3cret!@cluster0.abcde.mongodb.net/hrms';
  it('never stores plaintext and round-trips', () => {
    const enc = encryptConnectionString(ring, 'tenantA', URI);
    expect(enc.encryptedConnectionString).not.toContain('S3cret');
    expect(enc.encryptedConnectionString).not.toContain('mongodb');
    expect(enc.encryptionKeyVersion).toBe('v1');
    expect(decryptConnectionString(ring, 'tenantA', enc)).toBe(URI);
  });
  it('is bound to the tenant: a ciphertext copied to another tenant cannot be decrypted', () => {
    const enc = encryptConnectionString(ring, 'tenantA', URI);
    expect(() => decryptConnectionString(ring, 'tenantB', enc)).toThrow();
  });
  it('supports rotation: new secrets use the active key, old ones stay readable until re-encrypted', () => {
    const old = encryptConnectionString(ring, 't', URI);
    const ring2 = parseKeyRing(`v1:${KEY1},v2:${KEY2}`);
    expect(ring2.active).toBe('v2');
    expect(needsRotation(ring2, old)).toBe(true);
    expect(decryptConnectionString(ring2, 't', old)).toBe(URI);
    const fresh = encryptConnectionString(ring2, 't', decryptConnectionString(ring2, 't', old));
    expect(fresh.encryptionKeyVersion).toBe('v2');
    expect(needsRotation(ring2, fresh)).toBe(false);
    // once v1 is retired, a v1 secret can no longer be read
    expect(() => decryptConnectionString(parseKeyRing(`v2:${KEY2}`), 't', old)).toThrow();
  });
  it('validates the key list', () => {
    expect(() => parseKeyRing('nokey')).toThrow();
    expect(() => parseKeyRing(`v1:${'a'.repeat(10)}`)).toThrow();
    expect(() => parseKeyRing(`v1:${KEY1},v1:${KEY2}`)).toThrow(/Duplicate/);
    expect(() => parseKeyRing(`v1:${KEY1}`, 'v9')).toThrow();
  });
});

describe('error handling never leaks credentials', () => {
  it('redacts connection strings and passwords', () => {
    expect(redactSecrets('failed for mongodb+srv://admin:hunter2@cluster.mongodb.net/x')).not.toMatch(/hunter2|admin/);
    expect(redactSecrets('bad mongodb://u:p@h/db?password=zzz')).not.toMatch(/zzz|u:p/);
  });
  it('maps driver failures to actionable codes with safe messages', () => {
    const e = (props: Record<string, unknown>) => Object.assign(new Error(String(props.message ?? '')), props);
    const c = (err: unknown) => classifyMongoError(err);
    expect(c(e({ code: 18, message: 'Authentication failed. user=bob pw=x' })).hostingCode).toBe('AUTH_FAILED');
    expect(c(e({ code: 13, message: 'not authorized on hrms to execute command' })).hostingCode).toBe('PERMISSION_DENIED');
    expect(c(e({ name: 'MongoServerSelectionError', message: 'Server selection timed out after 8000 ms' })).hostingCode).toBe('CONNECTION_TIMEOUT');
    expect(c(e({ message: 'getaddrinfo ENOTFOUND db.example.com' })).hostingCode).toBe('NETWORK_UNREACHABLE');
    expect(c(e({ message: 'connect ECONNREFUSED 10.0.0.1:27017' })).hostingCode).toBe('NETWORK_UNREACHABLE');
    expect(c(e({ message: 'self-signed certificate in certificate chain' })).hostingCode).toBe('TLS_ERROR');
    expect(c(e({ message: 'something odd mongodb://u:topsecret@h/db' })).message).not.toContain('topsecret');
    for (const m of ['AUTH_FAILED', 'PERMISSION_DENIED']) expect(m).toBeTruthy();
    expect(c(e({ code: 18, message: 'Authentication failed. user=bob pw=x' })).message).not.toContain('bob');
  });
});

describe('versions and migrations registry', () => {
  it('compares versions numerically', () => {
    expect(versionAtLeast('7.0.24', '6.0')).toBe(true);
    expect(versionAtLeast('6.0.0', '6.0')).toBe(true);
    expect(versionAtLeast('5.0.30', '6.0')).toBe(false);
    expect(versionAtLeast('10.0.0', '6.0')).toBe(true);
  });
  it('keeps migrations consecutive from 1 and idempotence-minded', () => {
    MIGRATIONS.forEach((m, i) => expect(m.version).toBe(i + 1));
    expect(LATEST_SCHEMA_VERSION).toBe(MIGRATIONS.length);
    for (const m of MIGRATIONS) expect(m.destructive ?? false).toBe(false); // destructive ones need a backup gate
  });
});

describe('environment configuration', () => {
  const base = { MONGODB_URI: 'mongodb://x/y', JWT_ACCESS_SECRET: 'x'.repeat(40), REFRESH_TOKEN_SECRET: 'y'.repeat(40) };
  it('defaults to a safe posture', () => {
    const env = parseEnv(base);
    expect(env.CUSTOMER_DB_ALLOW_PRIVATE_HOSTS).toBe(false);
    expect(env.CUSTOMER_DB_REQUIRE_TLS).toBe(true);
    expect(env.TENANT_DB_ENCRYPTION_KEYS).toBeUndefined();
  });
  it('rejects bad key lists and SSRF-disabling in production', () => {
    expect(() => parseEnv({ ...base, TENANT_DB_ENCRYPTION_KEYS: 'garbage' })).toThrow(/TENANT_DB_ENCRYPTION_KEYS/);
    expect(() =>
      parseEnv({ ...base, NODE_ENV: 'production', WEB_APP_URL: 'https://a.example.com', CORS_ORIGINS: 'https://a.example.com', CUSTOMER_DB_ALLOW_PRIVATE_HOSTS: 'true' }),
    ).toThrow(/CUSTOMER_DB_ALLOW_PRIVATE_HOSTS/);
    expect(parseEnv({ ...base, TENANT_DB_ENCRYPTION_KEYS: `v1:${KEY1}` }).TENANT_DB_ENCRYPTION_KEYS).toBeTruthy();
  });
  it('keeps defaults sane', () => {
    expect(DEFAULT_SETTINGS.customerOwnedEnabled).toBe(false);
  });
});
