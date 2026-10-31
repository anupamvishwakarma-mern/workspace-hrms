import type { Router } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { redactSecrets } from '../../database/hosting/errors';
import { tenantDatabaseManager } from '../../database/hosting/manager';
import { migrateTenantDatabase } from '../../database/hosting/migrations';
import { decryptConnectionString, encryptConnectionString, needsRotation } from '../../database/hosting/secrets';
import { TENANT_DB_FIELDS } from '../../database/hosting/source';
import { Tenant } from '../../database/models/tenant.model';
import { recordDbEvent } from '../../database/models/tenantDbEvent.model';
import { authenticate, requirePlatformAdmin } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/errors';
import { route } from '../../utils/route';
import { idParams, validate } from '../../utils/validate';

const limitsBody = z
  .object({
    /** Storage entitlement for this company in MB; null removes the limit. Pricing lives in your billing system. */
    storageLimitMb: z.number().int().min(1).max(100_000_000).nullable(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

/** Platform (operator) endpoints for database hosting. Metadata only: no tenant data, never any connection string. */
export function registerPlatformDatabaseRoutes(v1: Router, env: Env): void {
  const chain = [authenticate(env), requirePlatformAdmin];

  route(
    v1,
    {
      method: 'get',
      path: '/platform/database/overview',
      summary: 'Hosting-mode and connection-health summary across all companies, with the ones needing attention.',
      tags: ['Platform'],
      auth: 'platform',
    },
    ...chain,
    asyncHandler(async (_req, res) => {
      const [byMode, byHealth, attention] = await Promise.all([
        Tenant.aggregate([{ $group: { _id: '$database.hostingMode', count: { $sum: 1 } } }]),
        Tenant.aggregate([
          { $match: { 'database.hostingMode': 'CUSTOMER_OWNED' } },
          { $group: { _id: '$database.health', count: { $sum: 1 } } },
        ]),
        Tenant.find({
          'database.hostingMode': 'CUSTOMER_OWNED',
          $or: [{ 'database.health': { $in: ['DEGRADED', 'UNREACHABLE'] } }, { 'database.status': { $in: ['FAILED', 'SUSPENDED'] } }],
        })
          .select('name slug status database.status database.health database.lastError database.lastErrorCode database.lastFailureAt database.lastSuccessfulConnection')
          .limit(100)
          .lean(),
      ]);
      res.json({
        success: true,
        data: {
          managedClusterHealthy: await tenantDatabaseManager.managed.ping(),
          customerOwnedEnabled: tenantDatabaseManager.getSettings().customerOwnedEnabled,
          hostingModes: Object.fromEntries(byMode.map((r: { _id: string | null; count: number }) => [r._id ?? 'MANAGED', r.count])),
          customerOwnedHealth: Object.fromEntries(byHealth.map((r: { _id: string | null; count: number }) => [r._id ?? 'UNKNOWN', r.count])),
          needsAttention: attention.map((t) => ({
            id: String(t._id),
            name: t.name,
            slug: t.slug,
            status: t.status,
            databaseStatus: t.database?.status,
            health: t.database?.health,
            lastError: t.database?.lastError,
            lastErrorCode: t.database?.lastErrorCode,
            lastFailureAt: t.database?.lastFailureAt,
            lastSuccessfulConnection: t.database?.lastSuccessfulConnection,
          })),
        },
      });
    }),
  );

  route(
    v1,
    {
      method: 'patch',
      path: '/platform/tenants/:id/database-limits',
      summary: 'Set a company\'s database storage entitlement (MB). Entitlements are configuration, not hard-coded plans.',
      tags: ['Platform'],
      auth: 'platform',
      body: limitsBody,
    },
    ...chain,
    validate({ params: idParams, body: limitsBody }),
    asyncHandler(async (req, res) => {
      const t = await Tenant.findById(req.params.id).select('database.storageLimitMb').lean();
      if (!t) throw AppError.notFound('Company not found');
      const { storageLimitMb, reason } = req.body as z.infer<typeof limitsBody>;
      await Tenant.updateOne(
        { _id: t._id },
        storageLimitMb === null ? { $unset: { 'database.storageLimitMb': '' } } : { $set: { 'database.storageLimitMb': storageLimitMb } },
      );
      await recordDbEvent({
        tenantId: t._id,
        type: 'LIMITS_CHANGED',
        ok: true,
        actorUserId: req.auth!.userId,
        requestId: String(req.id),
        detail: { from: t.database?.storageLimitMb ?? null, to: storageLimitMb, reason },
      });
      res.json({ success: true, data: { storageLimitMb } });
    }),
  );

  route(
    v1,
    {
      method: 'post',
      path: '/platform/tenants/:id/database/migrate',
      summary: 'Run pending schema migrations for one company now (idempotent; managed or customer-owned).',
      tags: ['Platform'],
      auth: 'platform',
    },
    ...chain,
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const t = await Tenant.findById(req.params.id).select(TENANT_DB_FIELDS).lean();
      if (!t) throw AppError.notFound('Company not found');
      const { conn, release } = await tenantDatabaseManager.lease(t);
      try {
        res.json({ success: true, data: await migrateTenantDatabase(String(t._id), conn, { actorUserId: req.auth!.userId }) });
      } finally {
        release();
      }
    }),
  );

  route(
    v1,
    {
      method: 'post',
      path: '/platform/database/rotate-keys',
      summary:
        'Re-encrypt every stored customer connection string with the active key version (TENANT_DB_ACTIVE_KEY_VERSION). Run after adding a new key, then remove the old key from TENANT_DB_ENCRYPTION_KEYS.',
      tags: ['Platform'],
      auth: 'platform',
    },
    ...chain,
    asyncHandler(async (req, res) => {
      const ring = tenantDatabaseManager.getSettings().keyRing;
      if (!ring) throw AppError.unprocessable('No encryption keys are configured.');
      const tenants = await Tenant.find({ 'database.hostingMode': 'CUSTOMER_OWNED' })
        .select('+database.connectionConfig.encryptedConnectionString +database.connectionConfig.encryptionKeyVersion')
        .lean();
      let rotated = 0;
      let failed = 0;
      for (const t of tenants) {
        const cfg = t.database?.connectionConfig;
        if (!cfg?.encryptedConnectionString || !needsRotation(ring, cfg)) continue;
        try {
          const id = String(t._id);
          const uri = decryptConnectionString(ring, id, { encryptedConnectionString: cfg.encryptedConnectionString, encryptionKeyVersion: cfg.encryptionKeyVersion });
          const enc = encryptConnectionString(ring, id, uri);
          // Compare-and-set on the old ciphertext so a concurrent credential replacement is never overwritten.
          const r = await Tenant.updateOne(
            { _id: t._id, 'database.connectionConfig.encryptedConnectionString': cfg.encryptedConnectionString },
            { $set: { 'database.connectionConfig.encryptedConnectionString': enc.encryptedConnectionString, 'database.connectionConfig.encryptionKeyVersion': enc.encryptionKeyVersion } },
          );
          if (r.modifiedCount) {
            rotated += 1;
            await recordDbEvent({ tenantId: t._id, type: 'SECRET_ROTATED', ok: true, actorUserId: req.auth!.userId, requestId: String(req.id), detail: { from: cfg.encryptionKeyVersion, to: enc.encryptionKeyVersion } });
          }
        } catch (e) {
          failed += 1;
          req.log?.error({ tenantId: String(t._id), err: redactSecrets((e as Error).message) }, 'secret rotation failed');
        }
      }
      res.json({ success: true, data: { rotated, failed, activeKeyVersion: ring.active } });
    }),
  );
}
