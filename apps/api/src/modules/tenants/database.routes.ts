import type { Router } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { HostingError, safeErrorMessage } from '../../database/hosting/errors';
import { recordConnectionResult } from '../../database/hosting/health';
import { tenantDatabaseManager } from '../../database/hosting/manager';
import { LATEST_SCHEMA_VERSION, migrateTenantDatabase } from '../../database/hosting/migrations';
import { encryptConnectionString } from '../../database/hosting/secrets';
import { databaseUsage } from '../../database/hosting/usage';
import { verifyCustomerDatabase } from '../../database/hosting/verify';
import { TENANT_DB_FIELDS } from '../../database/hosting/source';
import { Tenant } from '../../database/models/tenant.model';
import { TenantDbEvent, recordDbEvent } from '../../database/models/tenantDbEvent.model';
import { User } from '../../database/models/user.model';
import { authenticate, requirePermission, resolveTenantWithoutDatabase } from '../../middleware/auth';
import { createUserLimiter } from '../../middleware/rateLimit';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/errors';
import { route } from '../../utils/route';
import { verifyPassword } from '../../utils/security';
import { validate } from '../../utils/validate';
import { writeTenantAudit } from '../audit/audit.service';
import { parseMongoUri } from '../../database/hosting/connectionString';

const connectionBody = z
  .object({
    connectionString: z.string().trim().min(10).max(2048),
    databaseName: z.string().trim().min(1).max(60).optional(),
  })
  .strict();

const replaceBody = connectionBody
  .extend({
    /** Re-authentication: replacing the credentials is a high-risk action. */
    currentPassword: z.string().min(1).max(200),
    confirm: z.literal(true),
  })
  .strict();

/** What the customer is responsible for, per hosting mode (shown in Settings). */
const RESPONSIBILITIES = {
  MANAGED: {
    us: ['Database hosting and capacity', 'Backups and recovery', 'Monitoring', 'Maintenance and upgrades'],
    you: ['Choosing the right plan for your headcount and storage'],
  },
  CUSTOMER_OWNED: {
    us: ['The HRMS application, APIs and schema migrations', 'Secure storage of your connection details', 'Connection health checks'],
    you: [
      'Hosting, capacity and cost of your MongoDB (a replica set, version 6.0 or newer)',
      'Backups and disaster recovery of your data',
      'Allowing our servers through your firewall / IP allow-list',
      'Keeping the database user and its credentials valid',
    ],
  },
} as const;

const SERVICE_MESSAGES: Record<string, string> = {
  HEALTHY: 'Your database is connected and healthy.',
  UNKNOWN: 'Your database has not been checked yet.',
  DEGRADED: 'We had trouble reaching your database and are retrying. Some features may be slow or unavailable.',
  UNREACHABLE: 'Your database is unreachable, so HRMS is unavailable for your company. Your data is untouched. Check that your database is running and reachable, or replace the connection details.',
};

export function registerTenantDatabaseRoutes(v1: Router, env: Env): void {
  // No database scope: these routes must work while a customer-owned database is unreachable.
  const chain = [authenticate(env), resolveTenantWithoutDatabase];
  const limiter = createUserLimiter(env.RATE_LIMIT_DB_TEST_MAX);

  async function loadOwn(req: { tenantCtx?: { tenantId: unknown } }) {
    const t = await Tenant.findById(req.tenantCtx!.tenantId as string)
      .select(`${TENANT_DB_FIELDS}`)
      .lean();
    if (!t) throw AppError.notFound();
    return t;
  }

  route(
    v1,
    {
      method: 'get',
      path: '/tenants/current/database/status',
      summary: 'Service status of the company database (hosting mode and health only; no connection details).',
      tags: ['Database'],
      auth: 'tenant',
      permission: 'tenant:database | employee:read:all',
    },
    ...chain,
    requirePermission('tenant:database', 'employee:read:all'),
    asyncHandler(async (req, res) => {
      const t = await loadOwn(req);
      const db = t.database!;
      const health = db.hostingMode === 'MANAGED' ? ((await tenantDatabaseManager.managed.ping()) ? 'HEALTHY' : 'UNREACHABLE') : (db.health ?? 'UNKNOWN');
      res.json({
        success: true,
        data: {
          hostingMode: db.hostingMode,
          status: db.status,
          health,
          message: SERVICE_MESSAGES[health],
          lastSuccessfulConnection: db.hostingMode === 'MANAGED' ? undefined : (db.lastSuccessfulConnection ?? undefined),
        },
      });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/tenants/current/database',
      summary:
        'Database & Infrastructure settings: hosting mode, status, health, schema version and usage. Never includes the connection string or credentials.',
      tags: ['Database'],
      auth: 'tenant',
      permission: 'tenant:database',
    },
    ...chain,
    requirePermission('tenant:database'),
    asyncHandler(async (req, res) => {
      const t = await loadOwn(req);
      const db = t.database!;
      const managed = db.hostingMode === 'MANAGED';
      const health = managed ? ((await tenantDatabaseManager.managed.ping()) ? 'HEALTHY' : 'UNREACHABLE') : (db.health ?? 'UNKNOWN');
      let usage;
      if (db.status === 'READY' && (!managed || t.dbName)) {
        try {
          usage = await databaseUsage(String(t._id), await tenantDatabaseManager.getTenantDatabase(String(t._id)));
        } catch {
          usage = undefined;
        }
      }
      const limitMb = db.storageLimitMb ?? undefined;
      res.json({
        success: true,
        data: {
          hostingMode: db.hostingMode,
          provider: db.provider ?? 'MONGODB',
          status: db.status,
          health,
          message: SERVICE_MESSAGES[health],
          // The physical name of a managed database is internal; a customer's own database name is theirs to see.
          databaseName: managed ? undefined : db.databaseName,
          schemaVersion: db.schemaVersion ?? 0,
          latestSchemaVersion: LATEST_SCHEMA_VERSION,
          lastConnectionCheck: db.lastConnectionCheck ?? undefined,
          lastSuccessfulConnection: managed ? undefined : (db.lastSuccessfulConnection ?? undefined),
          lastFailureAt: db.lastFailureAt ?? undefined,
          lastError: db.lastError ?? undefined,
          lastMigration: db.lastMigration ?? undefined,
          usage: usage ? { ...usage, limitMb, overLimit: limitMb ? usage.storageSizeMb > limitMb : false } : undefined,
          responsibilities: RESPONSIBILITIES[db.hostingMode as 'MANAGED' | 'CUSTOMER_OWNED'],
          managed: managed
            ? {
                backupPolicy: env.MANAGED_BACKUP_POLICY_TEXT ?? 'Backups are managed by the platform operator.',
                planId: (await Tenant.findById(t._id).select('planId').lean())?.planId,
                storageLimitMb: limitMb,
              }
            : undefined,
          // Switching hosting mode needs a data-migration workflow that is not available yet, so no control is offered.
          canChangeConnection: !managed,
          canSwitchHostingMode: false,
        },
      });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/tenants/current/database/events',
      summary: 'History of database connection changes, tests, health changes and migrations (no secrets).',
      tags: ['Database'],
      auth: 'tenant',
      permission: 'tenant:database',
    },
    ...chain,
    requirePermission('tenant:database'),
    asyncHandler(async (req, res) => {
      const items = await TenantDbEvent.find({ tenantId: req.tenantCtx!.tenantId })
        .sort({ createdAt: -1 })
        .limit(50)
        .select('type ok detail createdAt actorUserId')
        .lean();
      res.json({ success: true, data: items });
    }),
  );

  route(
    v1,
    {
      method: 'post',
      path: '/tenants/current/database/test',
      summary:
        'Test new customer-owned connection details WITHOUT saving them. Rate limited. The database must already be this company\'s own database.',
      tags: ['Database'],
      auth: 'tenant',
      permission: 'tenant:database',
      body: connectionBody,
    },
    ...chain,
    requirePermission('tenant:database'),
    limiter,
    validate({ body: connectionBody }),
    asyncHandler(async (req, res) => {
      const t = await loadOwn(req);
      if (t.database?.hostingMode !== 'CUSTOMER_OWNED')
        throw AppError.conflict('This company uses the HRMS-managed database; there is no connection to test.');
      const body = req.body as z.infer<typeof connectionBody>;
      try {
        const r = await verifyCustomerDatabase(tenantDatabaseManager.getSettings(), { ...body, tenantId: String(t._id) });
        await recordDbEvent({ tenantId: t._id, type: 'CONNECTION_TESTED', ok: true, actorUserId: req.auth!.userId, requestId: String(req.id), detail: { databaseName: r.databaseName } });
        res.json({ success: true, data: { ok: true, databaseName: r.databaseName, serverVersion: r.serverVersion, checks: r.checks } });
      } catch (e) {
        await recordDbEvent({ tenantId: t._id, type: 'CONNECTION_TESTED', ok: false, actorUserId: req.auth!.userId, requestId: String(req.id), detail: { code: (e as HostingError).hostingCode } });
        throw e;
      }
    }),
  );

  route(
    v1,
    {
      method: 'post',
      path: '/tenants/current/database/recheck',
      summary: 'Check the current database connection now (and clear any retry back-off).',
      tags: ['Database'],
      auth: 'tenant',
      permission: 'tenant:database',
    },
    ...chain,
    requirePermission('tenant:database'),
    limiter,
    asyncHandler(async (req, res) => {
      const t = await loadOwn(req);
      if (t.database?.hostingMode === 'CUSTOMER_OWNED') tenantDatabaseManager.customer.resetFailures(String(t._id));
      const ok = await tenantDatabaseManager.verifyConnection(String(t._id));
      if (t.database?.hostingMode === 'CUSTOMER_OWNED' && ok)
        await recordConnectionResult(t._id, { ok: true }, { recheckMs: tenantDatabaseManager.getSettings().health.minIntervalMs });
      res.json({ success: true, data: { ok } });
    }),
  );

  route(
    v1,
    {
      method: 'put',
      path: '/tenants/current/database/connection',
      summary:
        'Replace the credentials of a customer-owned database (owner only, requires the owner\'s password). The new connection must reach the SAME company database; moving to a different database is a data migration, not available here. The old secret is overwritten and never returned.',
      tags: ['Database'],
      auth: 'tenant',
      permission: 'tenant:database',
      body: replaceBody,
    },
    ...chain,
    requirePermission('tenant:database'),
    limiter,
    validate({ body: replaceBody }),
    asyncHandler(async (req, res) => {
      const t = await loadOwn(req);
      const id = String(t._id);
      if (t.database?.hostingMode !== 'CUSTOMER_OWNED')
        throw AppError.conflict('This company uses the HRMS-managed database; it has no connection details to replace.');
      const settings = tenantDatabaseManager.getSettings();
      if (!settings.keyRing) throw new HostingError('CUSTOMER_DB_DISABLED', 'Customer-owned databases are not enabled on this platform.');
      const body = req.body as z.infer<typeof replaceBody>;

      const user = await User.findById(req.auth!.userId).select('passwordHash').lean();
      if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, body.currentPassword))) {
        await recordDbEvent({ tenantId: t._id, type: 'CONNECTION_REPLACE_REJECTED', ok: false, actorUserId: req.auth!.userId, requestId: String(req.id), detail: { reason: 'reauthentication_failed' } });
        throw new AppError(403, 'REAUTH_FAILED', 'The password you entered is not correct.');
      }
      try {
        const verified = await verifyCustomerDatabase(settings, {
          connectionString: body.connectionString,
          databaseName: body.databaseName,
          tenantId: id, // must already be this company's database
        });
        const clash = await Tenant.exists({ 'database.connectionConfig.fingerprint': verified.fingerprint, _id: { $ne: t._id } });
        if (clash) throw new HostingError('DATABASE_IN_USE', 'This database is already in use by another HRMS company.');
        const enc = encryptConnectionString(settings.keyRing, id, body.connectionString);
        await Tenant.updateOne(
          { _id: t._id, 'database.hostingMode': 'CUSTOMER_OWNED' },
          {
            $set: {
              'database.databaseName': verified.databaseName,
              'database.connectionConfig.encryptedConnectionString': enc.encryptedConnectionString,
              'database.connectionConfig.encryptionKeyVersion': enc.encryptionKeyVersion,
              'database.connectionConfig.fingerprint': verified.fingerprint,
              'database.connectionConfig.updatedAt': new Date(),
              'database.status': 'READY',
            },
          },
        );
        // Drop the old connection everywhere it is cached here; other instances notice the changed timestamp.
        await tenantDatabaseManager.closeTenantConnection(id);
        tenantDatabaseManager.customer.resetFailures(id);
        const conn = await tenantDatabaseManager.getTenantDatabase(id);
        const m = await migrateTenantDatabase(id, conn, { actorUserId: req.auth!.userId });
        await recordConnectionResult(t._id, { ok: true }, { recheckMs: settings.health.minIntervalMs, actorUserId: req.auth!.userId });
        const detail = { databaseName: verified.databaseName, hosts: parseMongoUri(body.connectionString).hosts.length, migration: m.status };
        await recordDbEvent({ tenantId: t._id, type: 'CONNECTION_REPLACED', ok: true, actorUserId: req.auth!.userId, requestId: String(req.id), detail });
        await writeTenantAudit(req, t._id, { action: 'tenant.database_connection_replaced', entityType: 'Tenant', entityId: t._id, after: detail });
        res.json({ success: true, data: { ok: true, databaseName: verified.databaseName, serverVersion: verified.serverVersion, checks: verified.checks } });
      } catch (e) {
        await recordDbEvent({ tenantId: t._id, type: 'CONNECTION_REPLACE_REJECTED', ok: false, actorUserId: req.auth!.userId, requestId: String(req.id), detail: { code: (e as HostingError).hostingCode ?? 'ERROR', error: safeErrorMessage(e) } });
        throw e;
      }
    }),
  );
}
