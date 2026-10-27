import express, { type Express } from 'express';
import type { Env } from '../../config/env';
import { getStorage, LocalStorage } from './storage';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Serves the signed URLs issued by LocalStorage. Authorization is the signature itself (like an S3 presigned URL):
 * the key, method, content type, size and expiry are all signed, so a URL cannot be reused for anything else.
 */
export function registerLocalStorageRoutes(app: Express, env: Env): void {
  const handle = (method: 'PUT' | 'GET') =>
    async (req: express.Request, res: express.Response) => {
      const storage = getStorage(env);
      if (!(storage instanceof LocalStorage)) return void res.status(404).end();
      const q = req.query as Record<string, string | undefined>;
      const { k, m, e, sig } = q;
      const expired = !e || Number(e) < Date.now() / 1000;
      if (!k || !sig || m !== method || expired) return void res.status(403).end();
      const parts =
        method === 'PUT'
          ? [k, 'PUT', q.ct ?? '', q.sz ?? '', e!]
          : [k, 'GET', q.fn ?? '', e!];
      if (!storage.verify(parts, sig)) return void res.status(403).end();
      try {
        if (method === 'PUT') {
          const body = req.body as Buffer;
          if (
            !Buffer.isBuffer(body) ||
            body.length !== Number(q.sz) ||
            req.headers['content-type'] !== q.ct
          )
            return void res.status(400).end();
          await storage.write(k, body);
          return void res.status(200).end();
        }
        const file = storage.pathFor(k);
        const safe = (q.fn ?? 'file').replace(/[^\w.\- ]/g, '_');
        res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.sendFile(file, (err) => {
          if (err && !res.headersSent) res.status(404).end();
        });
      } catch {
        res.status(400).end();
      }
    };
  app.put(
    '/api/v1/storage/local',
    express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
    handle('PUT'),
  );
  app.get('/api/v1/storage/local', handle('GET'));
}
