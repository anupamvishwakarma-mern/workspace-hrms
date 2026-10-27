import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Env } from '../../config/env';

export interface ObjectStorage {
  presignUpload(
    key: string,
    contentType: string,
    sizeBytes: number,
    ttlSeconds: number,
  ): Promise<string>;
  presignDownload(key: string, fileName: string, ttlSeconds: number): Promise<string>;
  head(key: string): Promise<{ sizeBytes: number; contentType?: string } | null>;
  remove(key: string): Promise<void>;
}

export class S3Storage implements ObjectStorage {
  private readonly client: S3Client;
  constructor(
    endpoint: string,
    region: string,
    accessKeyId: string,
    secretAccessKey: string,
    private readonly bucket: string,
  ) {
    this.client = new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true, // works for MinIO/R2/S3 alike
    });
  }
  presignUpload(key: string, contentType: string, sizeBytes: number, ttl: number) {
    // Content-Type and Content-Length are part of the signature: the client cannot upload a different type or size.
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: sizeBytes,
      }),
      { expiresIn: ttl },
    );
  }
  presignDownload(key: string, fileName: string, ttl: number) {
    const safe = fileName.replace(/[^\w.\- ]/g, '_');
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${safe}"`,
      }),
      { expiresIn: ttl },
    );
  }
  async head(key: string) {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { sizeBytes: r.ContentLength ?? 0, contentType: r.ContentType };
    } catch (e) {
      const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || (e as Error).name === 'NotFound') return null;
      throw e;
    }
  }
  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

/**
 * Stores objects on the API server's disk. Mimics presigned URLs: the URL carries the key, method, content type,
 * size and expiry, signed with an HMAC, and is served by /api/v1/storage/local (see localStorageRoutes.ts).
 * Single-server only: use a persistent volume, or switch to S3-compatible storage when scaling out.
 */
export class LocalStorage implements ObjectStorage {
  readonly root: string;
  constructor(
    dir: string,
    private readonly baseUrl: string,
    private readonly secret: string,
  ) {
    this.root = path.resolve(dir);
  }
  sign(parts: string[]): string {
    return createHmac('sha256', this.secret).update(parts.join('\n')).digest('base64url');
  }
  verify(parts: string[], sig: string): boolean {
    const a = Buffer.from(this.sign(parts));
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  /** Resolves a key to a file path, refusing anything that escapes the storage root. */
  pathFor(key: string): string {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error('Invalid storage key');
    return full;
  }
  private url(q: Record<string, string>, parts: string[]) {
    const qs = new URLSearchParams({ ...q, sig: this.sign(parts) });
    return `${this.baseUrl.replace(/\/+$/, '')}/api/v1/storage/local?${qs}`;
  }
  async presignUpload(key: string, contentType: string, sizeBytes: number, ttl: number) {
    const exp = String(Math.floor(Date.now() / 1000) + ttl);
    return this.url({ k: key, m: 'PUT', ct: contentType, sz: String(sizeBytes), e: exp }, [
      key,
      'PUT',
      contentType,
      String(sizeBytes),
      exp,
    ]);
  }
  async presignDownload(key: string, fileName: string, ttl: number) {
    const exp = String(Math.floor(Date.now() / 1000) + ttl);
    return this.url({ k: key, m: 'GET', fn: fileName, e: exp }, [key, 'GET', fileName, exp]);
  }
  async write(key: string, data: Buffer) {
    const file = this.pathFor(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
  }
  async head(key: string) {
    try {
      const st = await fs.stat(this.pathFor(key));
      return { sizeBytes: st.size };
    } catch {
      return null;
    }
  }
  async remove(key: string) {
    await fs.rm(this.pathFor(key), { force: true });
  }
}

let cache: { sig: string; storage: ObjectStorage } | undefined;
/** Null when object storage is not configured: document endpoints then answer 503 instead of pretending. */
export function getStorage(env: Env): ObjectStorage | null {
  const {
    OBJECT_STORAGE_ENDPOINT: e,
    OBJECT_STORAGE_BUCKET: b,
    OBJECT_STORAGE_ACCESS_KEY: k,
    OBJECT_STORAGE_SECRET_KEY: s,
  } = env;
  if (!e || !b || !k || !s) {
    if (!env.LOCAL_STORAGE_DIR) return null;
    const sig = `local|${env.LOCAL_STORAGE_DIR}|${env.PUBLIC_API_URL}`;
    if (cache?.sig !== sig)
      cache = {
        sig,
        storage: new LocalStorage(env.LOCAL_STORAGE_DIR, env.PUBLIC_API_URL, env.JWT_ACCESS_SECRET),
      };
    return cache.storage;
  }
  const sig = `${e}|${b}|${k}|${env.OBJECT_STORAGE_REGION}`;
  if (cache?.sig !== sig)
    cache = { sig, storage: new S3Storage(e, env.OBJECT_STORAGE_REGION, k, s, b) };
  return cache.storage;
}
