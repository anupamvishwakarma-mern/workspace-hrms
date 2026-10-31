import { createHash } from 'node:crypto';
import dns from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { HostingError } from './errors';
import type { HostingSettings } from './settings';

export interface MongoHost {
  host: string;
  port?: number;
}

export interface ParsedMongoUri {
  scheme: 'mongodb' | 'mongodb+srv';
  hosts: MongoHost[];
  username?: string;
  hasPassword: boolean;
  database?: string;
  options: Record<string, string>;
}

const URI_RE = /^(mongodb(?:\+srv)?):\/\/(?:([^:@/?#]*)(?::([^@/?#]*))?@)?([^/?#]+)(?:\/([^?#]*))?(?:\?([^#]*))?$/i;

/**
 * Only these URI options are accepted (lower-cased). Everything else is rejected, because several driver options are
 * dangerous when the URI is attacker-controlled: tlsCAFile / tlsCertificateKeyFile read files from OUR server,
 * authMechanism=MONGODB-AWS would sign with OUR cloud credentials, proxyHost opens tunnels, tlsInsecure disables
 * certificate checks, and so on. Timeouts and pool sizes are set by us.
 */
const ALLOWED_OPTIONS = new Set([
  'authsource',
  'authmechanism',
  'replicaset',
  'retrywrites',
  'retryreads',
  'w',
  'wtimeoutms',
  'readpreference',
  'tls',
  'ssl',
  'appname',
  'loadbalanced',
  'directconnection',
  'compressors',
]);
const ALLOWED_AUTH_MECHANISMS = new Set(['SCRAM-SHA-1', 'SCRAM-SHA-256', 'DEFAULT']);
const RESERVED_DATABASES = new Set(['admin', 'local', 'config']);
const DB_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,37}$/;

export function parseMongoUri(raw: string): ParsedMongoUri {
  const uri = raw.trim();
  const hasControl = [...uri].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
  if (uri.length > 2048 || hasControl || /\s/.test(uri))
    throw new HostingError('INVALID_CONNECTION_STRING', 'The connection string is not valid.');
  const m = URI_RE.exec(uri);
  if (!m) {
    if (!/^mongodb(\+srv)?:\/\//i.test(uri))
      throw new HostingError('UNSUPPORTED_SCHEME', 'The connection string must start with mongodb:// or mongodb+srv://.');
    throw new HostingError('INVALID_CONNECTION_STRING', 'The connection string is not valid. Special characters in the password must be percent-encoded.');
  }
  const scheme = m[1]!.toLowerCase() as ParsedMongoUri['scheme'];
  const hosts: MongoHost[] = [];
  for (const part of m[4]!.split(',')) {
    const hp = /^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+)(?::(\d{1,5}))?$/.exec(part);
    if (!hp) throw new HostingError('INVALID_CONNECTION_STRING', 'The connection string contains an invalid host.');
    const host = hp[1]!.replace(/^\[|\]$/g, '').toLowerCase();
    hosts.push({ host, port: hp[2] ? Number(hp[2]) : undefined });
  }
  if (hosts.length === 0 || hosts.length > 10)
    throw new HostingError('INVALID_CONNECTION_STRING', 'The connection string must list between 1 and 10 hosts.');
  if (scheme === 'mongodb+srv' && (hosts.length !== 1 || hosts[0]!.port !== undefined))
    throw new HostingError('INVALID_CONNECTION_STRING', 'A mongodb+srv:// string must name exactly one host and no port.');
  const options: Record<string, string> = {};
  if (m[6]) {
    for (const kv of m[6].split('&')) {
      if (!kv) continue;
      const i = kv.indexOf('=');
      const key = (i < 0 ? kv : kv.slice(0, i)).toLowerCase();
      const value = i < 0 ? '' : kv.slice(i + 1);
      if (!ALLOWED_OPTIONS.has(key))
        throw new HostingError('UNSUPPORTED_OPTION', `The connection option "${key.slice(0, 40)}" is not supported. Remove it from the connection string.`);
      options[key] = decodeURIComponent(value);
    }
  }
  const mech = options.authmechanism?.toUpperCase();
  if (mech && !ALLOWED_AUTH_MECHANISMS.has(mech))
    throw new HostingError('UNSUPPORTED_OPTION', 'Only username/password (SCRAM) authentication is supported.');
  return {
    scheme,
    hosts,
    username: m[2] ? decodeURIComponent(m[2]) : undefined,
    hasPassword: m[3] !== undefined,
    database: m[5] ? decodeURIComponent(m[5]) : undefined,
    options,
  };
}

export function resolveDatabaseName(parsed: ParsedMongoUri, explicit?: string): string {
  const fromUri = parsed.database || undefined;
  const given = explicit?.trim() || undefined;
  if (fromUri && given && fromUri !== given)
    throw new HostingError('INVALID_DATABASE_NAME', 'The database name differs from the one in the connection string. Provide it in only one place.');
  const name = fromUri ?? given;
  if (!name) throw new HostingError('INVALID_DATABASE_NAME', 'The connection string has no database name. Add one to the string or enter it separately.');
  if (!DB_NAME_RE.test(name) || RESERVED_DATABASES.has(name.toLowerCase()))
    throw new HostingError('INVALID_DATABASE_NAME', 'Use a database name of up to 38 letters, digits, "-" or "_" (not admin, local or config).');
  return name;
}

export function requireCredentials(parsed: ParsedMongoUri): void {
  if (!parsed.username || !parsed.hasPassword)
    throw new HostingError('INVALID_CONNECTION_STRING', 'The connection string must include a username and password.');
}

/**
 * Whether we must force TLS on the connection. mongodb+srv always uses TLS (driver default); a plain mongodb://
 * string uses TLS when it asks for it or when the platform requires it. An explicit tls=false is refused under the
 * platform policy.
 */
export function tlsEnabled(parsed: ParsedMongoUri, settings: Pick<HostingSettings, 'requireTls'>): boolean {
  const opt = (parsed.options.tls ?? parsed.options.ssl)?.toLowerCase();
  if (opt === 'false') {
    if (settings.requireTls) throw new HostingError('TLS_REQUIRED', 'TLS is required. Remove tls=false from the connection string.');
    return false;
  }
  if (opt === 'true' || parsed.scheme === 'mongodb+srv') return true;
  return settings.requireTls;
}

/** Stable identity of a database (hosts + name), used to refuse attaching one database to two companies. */
export function databaseFingerprint(parsed: ParsedMongoUri, databaseName: string): string {
  const hosts = parsed.hosts
    .map((h) => `${h.host}:${h.port ?? 27017}`)
    .sort()
    .join(',');
  return createHash('sha256').update(`${parsed.scheme}|${hosts}|${databaseName}`).digest('hex');
}

// ---- SSRF protection -----------------------------------------------------------------------------------------

const blocked = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, incl. cloud metadata 169.254.169.254
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
] as const)
  blocked.addSubnet(net, bits, 'ipv6');

export function isBlockedAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 0) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return blocked.check(mapped[1]!, 'ipv4');
  return blocked.check(address, v === 4 ? 'ipv4' : 'ipv6');
}

export interface Resolver {
  lookupAll(host: string): Promise<string[]>;
  resolveSrv(name: string): Promise<{ name: string; port: number }[]>;
}
export const systemResolver: Resolver = {
  lookupAll: async (host) => (await dns.lookup(host, { all: true })).map((a) => a.address),
  resolveSrv: (name) => dns.resolveSrv(name),
};

const notAllowed = () =>
  new HostingError('HOST_NOT_ALLOWED', 'This database host is not allowed. Use a publicly reachable MongoDB host (private, loopback and internal addresses are blocked).');

/**
 * Refuses hosts that resolve to private, loopback, link-local or metadata addresses, and ports outside the allowed
 * range, so the connection test cannot be used to probe our internal network. Every address a name resolves to must
 * be public. (The driver resolves again when it connects; residual DNS-rebinding risk is documented.)
 */
export async function assertHostsAllowed(
  parsed: ParsedMongoUri,
  settings: Pick<HostingSettings, 'allowPrivateHosts' | 'allowedPorts'>,
  resolver: Resolver = systemResolver,
): Promise<void> {
  const targets: MongoHost[] = [];
  if (parsed.scheme === 'mongodb+srv') {
    const apex = parsed.hosts[0]!.host;
    if (isIP(apex)) throw new HostingError('INVALID_CONNECTION_STRING', 'A mongodb+srv:// string needs a DNS name, not an IP address.');
    let records: { name: string; port: number }[];
    try {
      records = await resolver.resolveSrv(`_mongodb._tcp.${apex}`);
    } catch {
      throw new HostingError('NETWORK_UNREACHABLE', 'The database host could not be found. Check the host name.');
    }
    if (records.length === 0 || records.length > 20) throw notAllowed();
    for (const r of records) targets.push({ host: r.name.toLowerCase(), port: r.port });
  } else {
    targets.push(...parsed.hosts);
  }
  for (const t of targets) {
    const port = t.port ?? 27017;
    if (!settings.allowPrivateHosts && (port < settings.allowedPorts.min || port > settings.allowedPorts.max))
      throw new HostingError('HOST_NOT_ALLOWED', `The database port must be between ${settings.allowedPorts.min} and ${settings.allowedPorts.max}.`);
    if (settings.allowPrivateHosts) continue;
    if (/^localhost$|\.localhost$|\.local$|\.internal$|\.lan$|\.home$|\.corp$/i.test(t.host)) throw notAllowed();
    if (isIP(t.host)) {
      if (isBlockedAddress(t.host)) throw notAllowed();
      continue;
    }
    let addrs: string[];
    try {
      addrs = await resolver.lookupAll(t.host);
    } catch {
      throw new HostingError('NETWORK_UNREACHABLE', 'The database host could not be found. Check the host name.');
    }
    if (addrs.length === 0 || addrs.some(isBlockedAddress)) throw notAllowed();
  }
}
