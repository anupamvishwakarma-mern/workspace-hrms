# Dual MongoDB hosting (managed or customer-owned)

Every company (tenant) chooses where its data lives at signup:

- **MANAGED** - a private database (`<SLUG>_HRM`) on the platform's shared cluster, selected with `connection.useDb()`. No per-tenant connection string. This is the original behaviour and the default when `database` is omitted from signup.
- **CUSTOMER_OWNED** - the company's own MongoDB (Atlas or self-hosted, replica set, 6.0+). The connection string is verified, encrypted, and used by a dedicated pooled connection.

Switching a live company between modes is **not implemented** (see "Mode switching").

## Architecture

```
request -> authenticate -> resolveTenant (membership check, fail-closed)
        -> tenantDatabaseManager.scopeFor(tenant)  -> { dbName } | { connection }
        -> AsyncLocalStorage scope -> tenantModel() proxies resolve the model on that scope's connection
```

- `apps/api/src/database/hosting/manager.ts` is the only place that decides which database a tenant uses (`getTenantDatabase`, `verifyConnection`, `closeTenantConnection`, `runInTenant`, `forEachTenant`).
- `providers/managed.ts` and `providers/customer.ts` implement the two modes. The customer provider decrypts on demand, keeps one pool per tenant (deduplicated opens, LRU cap, idle sweep, leases so an in-flight request is never cut off, back-off circuit breaker after failures).
- Tenant identity always comes from the verified token and the membership record. `X-Tenant-Id` is only a selector; a database name or connection string is never accepted from a request except in the explicit owner-only "test/replace" flows.
- If a tenant has no `database` configuration, or it is not `READY`, requests fail with `TENANT_DB_UNAVAILABLE` / `TENANT_DB_NOT_READY`. There is **no fallback to another database**. A startup backfill gives pre-existing tenants an explicit managed config.
- Models are registered per connection (`modelOnConnection`), so two tenants can never share a compiled model/connection by accident.
- Control-plane data (tenants, users, memberships, platform audit, `TenantDbEvent`) stays on the managed cluster. Business data lives in the tenant database.
- Background jobs load each tenant, check its status, resolve its mode and run on that tenant's database. One unreachable customer database fails only that tenant (`failed: [{tenantId, code}]`).

## Tenant record (`Tenant.database`)

`hostingMode`, `provider`, `status` (PENDING / PROVISIONING / VERIFYING / READY / FAILED / SUSPENDED), `clusterId`, `databaseName`, `schemaVersion`, `connectionConfig` (`encryptedConnectionString`, `encryptionKeyVersion`, `fingerprint`; all `select:false`), `health`, `lastConnectionCheck`, `lastSuccessfulConnection`, `lastError` (redacted), `consecutiveFailures`, `nextCheckAt`, `lastMigration`, `storageLimitMb`.

## Customer-owned onboarding / verification

Run by `verifyCustomerDatabase`; the company becomes `READY` only after all pass:

1. URI parses; only `mongodb://` / `mongodb+srv://`; allow-listed options; SCRAM auth only; credentials required; TLS required (configurable).
2. Host policy (SSRF): DNS/SRV resolved, loopback/private/link-local/metadata addresses refused, port range enforced.
3. Connect + authenticate within the timeout.
4. Server version >= `CUSTOMER_DB_MIN_MONGO_VERSION`; replica set or mongos (needed for transactions).
5. Permission probe (create collection, index, transactional write, drop).
6. Database is empty, or already bound to this company (`_hrms_meta` binding), and the fingerprint is not used by another company.
7. Schema is created through the migration system, the string is encrypted, then the tenant is activated.

Errors are mapped to meaningful codes (bad credentials, network, timeout, TLS, version, permissions, topology, not empty, in use) with credentials redacted.

## Security

- AES-256-GCM, tenant id as AAD, versioned key ring (`TENANT_DB_ENCRYPTION_KEYS`). Never returned by any API, never logged (`redactSecrets` on errors and audit sanitizer), never in OpenAPI examples.
- Only `COMPANY_OWNER` has `tenant:database`; it is a locked permission that custom roles cannot hold. HR admins cannot read or replace credentials.
- Replacing credentials needs password re-authentication, `confirm: true`, must point to the same bound database, closes the old pool, re-runs migrations, and is audited.
- Test endpoints are rate limited (`RATE_LIMIT_DB_TEST_MAX`; per IP for signup, per user in Settings).
- `CUSTOMER_DB_ALLOW_PRIVATE_HOSTS=true` is refused in production.
- **Key rotation:** add `v2:<hex>` to the key ring (keep `v1`), set `TENANT_DB_ACTIVE_KEY_VERSION=v2`, deploy, call `POST /platform/database/rotate-keys` (platform admin), confirm none use `v1`, then remove `v1`.

## Migrations

`migrations.ts` holds ordered, forward-only, idempotent steps (`v1` = baseline schema + binding). A per-tenant lock in `Tenant.database.lastMigration` prevents concurrent runs (stale locks are taken over). Failures mark the tenant, record an event and retry on the next sweep. Destructive steps must take a backup first and are not allowed in the framework. Pending tenants are migrated by the `tenant-db-migrate` job; platform admins can force one via `POST /platform/tenants/:id/database/migrate`.

## Health

The `tenant-db-health` job (every 5 minutes) pings customer databases with back-off and records `HEALTHY / DEGRADED / UNREACHABLE`. Nothing is checked per request. Owners see state in Settings and can re-check manually. An outage never exposes data or switches database; the DB admin routes keep working so the owner can fix credentials.

## API

Interactive docs: `/api/v1/docs` (tags *Onboarding*, *Database*, *Platform*).

| Route | Purpose |
| --- | --- |
| `GET /signup/options` | which hosting modes are offered |
| `POST /signup/database/test` | test a customer DB before signup (no save, IP rate limited) |
| `POST /signup` | accepts `database: { hostingMode, connectionString?, databaseName? }` |
| `GET /tenants/current/database/status` | service status (no secrets) |
| `GET /tenants/current/database` | full settings view (owner) |
| `GET /tenants/current/database/events` | history |
| `POST /tenants/current/database/test` / `recheck` | test new details / re-check current |
| `PUT /tenants/current/database/connection` | replace credentials (re-auth + confirm) |
| `GET /platform/database/overview`, `PATCH /platform/tenants/:id/database-limits`, `POST /platform/tenants/:id/database/migrate`, `POST /platform/database/rotate-keys` | platform operations |

## Subscription / entitlements

Storage limits are data (`database.storageLimitMb`, set per tenant by platform admins), and plan ids are read from the tenant record. No prices are hard-coded; wire billing to these fields when a provider is chosen.

## Mode switching (future work)

Not offered in code or UI. A safe design needs: quiesce writes, snapshot, copy into the target (new database must pass verification), reconcile counts/checksums, atomically flip `database` config, keep the source read-only for a retention window, and a rollback path. Updating `hostingMode` alone would orphan data, so it is rejected.

## Deployment

1. Set `TENANT_DB_ENCRYPTION_KEYS` (see `.env.example`) on the API and the worker; both must share it.
2. Deploy API + worker. On start the backfill writes explicit managed config for existing tenants and the migrations sweep records schema version 1.
3. Tell customers to allow your API/worker egress IPs and to supply a replica-set user with `readWrite` (plus `dbAdmin`/create-collection) on the database.
4. Run `pnpm test` (integration tests need a MongoDB binary; set `MONGOMS_SYSTEM_BINARY` if downloads are blocked).

## Known limitations

- Hostname validation happens at verify time; a later DNS change (rebinding) is not re-validated on every reconnect.
- No mode switching; no billing integration.
- Customer-side backups, capacity and uptime are the customer's responsibility.
- The integration and regression suites need a MongoDB binary and were not run in the authoring sandbox.
