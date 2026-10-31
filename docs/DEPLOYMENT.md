# Deployment guide

> The Dockerfiles and the compose file in `deploy/` were written and syntax-checked (`docker compose config`), but **images were not built here** (no Docker daemon in the build environment). The pruned production bundle they rely on (`pnpm deploy --legacy --prod` + `node dist/server.js`) _was_ run and answered health checks, with API docs off and HSTS on. Build and smoke-test the images in your CI before relying on them.

## What runs

| Process | Command                              | Notes                                                                                             |
| ------- | ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| API     | `node dist/server.js`                | Stateless, scale horizontally. Needs MongoDB **replica set**.                                     |
| Worker  | `node dist/worker.js`                | Exactly one instance. Needs MongoDB + Redis. Nightly sweep, upload cleanup, GPS purge.            |
| Web     | `pnpm --filter @workforce/web start` | Next.js. `API_ORIGIN` and `STORAGE_ORIGIN` are **build-time**.                                    |
| Mobile  | Expo / EAS build                     | Not covered by the Docker files. Set `EXPO_PUBLIC_API_URL` to the public API URL (see MOBILE.md). |

## Infrastructure requirements

1. **MongoDB 7 replica set** (a single-node replica set is acceptable). Transactions are used for punches, corrections, leave and onboarding; a standalone server will fail those. Turn on authentication and TLS, restrict network access to the API/worker, and enable **backups with a tested restore**. Mongoose builds indexes on startup (`autoIndex`); on a very large database create indexes in a maintenance window instead.
2. **Redis 7** with a password and persistence, only for the worker. The API does not need it.
3. **S3-compatible bucket**, private. Block all public access. Configure CORS for `PUT` and `GET` from the web origin (header `Content-Type`). Use credentials limited to this bucket (`s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:ListBucket` for HEAD). Consider a lifecycle rule for objects under unfinished uploads.
4. **TLS** terminated in front of web and API. The API sets `trust proxy` to **one hop** in production: your proxy must overwrite (not append to) `X-Forwarded-For`, otherwise clients can spoof their IP and dodge per-IP rate limits.
5. **SMTP** provider (optional but needed for activation/reset emails to actually be delivered). Production requires TLS to the SMTP server.

## Environment checklist

Production start-up **refuses** to run when: secrets are shorter than 32 characters or look like placeholders, the two token secrets are equal, `WEB_APP_URL` or any `CORS_ORIGINS` entry is not `https://`, or CORS contains `*`.

Generate secrets with `openssl rand -base64 48` (one for each of `JWT_ACCESS_SECRET`, `REFRESH_TOKEN_SECRET`).

| Variable                                       | Production guidance                                                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| `NODE_ENV`                                     | `production`                                                                        |
| `MONGODB_URI`                                  | replica-set URI with credentials and TLS                                            |
| `JWT_ACCESS_SECRET`, `REFRESH_TOKEN_SECRET`    | random, distinct, from a secret store. Rotating either logs everyone out.           |
| `WEB_APP_URL`                                  | public https URL of the web app (used in emailed links)                             |
| `CORS_ORIGINS`                                 | exactly the web origin(s); mobile apps send no Origin                               |
| `REDIS_URL`                                    | worker only                                                                         |
| `OBJECT_STORAGE_*`                             | endpoint, bucket, region, keys. Without them document endpoints answer 503.         |
| `EMAIL_PROVIDER=smtp` + `SMTP_*`, `EMAIL_FROM` | needed for real email; otherwise emails are only recorded                           |
| `PUSH_PROVIDER=expo`, `EXPO_ACCESS_TOKEN`      | optional; mobile does not register tokens yet                                       |
| `PHOTO_RETENTION_DAYS`                         | default 90. Proof photos are deleted from storage after this; needs object storage. |
| `LOCATION_RETENTION_DAYS`                      | default 90. Choose per your privacy policy/law.                                     |
| `ENABLE_API_DOCS`                              | leave unset: docs are off in production                                             |
| Web build args                                 | `API_ORIGIN` (internal API URL), `STORAGE_ORIGIN` (bucket origin for CSP)           |

`/api/v1/health` is liveness, `/api/v1/health/ready` checks MongoDB (use for load-balancer readiness), `/api/v1/health/config` lists which integrations are configured (no secrets).

## First deployment, step by step

1. Provision MongoDB replica set, Redis, bucket (+CORS), SMTP, TLS/proxy.
2. Build images (`deploy/api.Dockerfile`, `deploy/web.Dockerfile`), set environment from your secret store.
3. Start the API; confirm `/api/v1/health/ready` is 200 and the log has no "not a replica set" warning.
4. Create the platform super-admin **from a shell with database access** (there is deliberately no HTTP endpoint):
   inside the API container `SUPER_ADMIN_PASSWORD=<strong> node dist/scripts/createSuperAdmin.js --email ops@yourco.com` (or omit the variable to be prompted), or in a checkout `pnpm --filter @workforce/api create-super-admin --email ops@yourco.com`.
5. Onboard the first company as that super-admin (`POST /api/v1/platform/tenants`); the owner receives an activation link by email (when email is not configured the link is recorded in the `emailoutboxes` collection with status `RECORDED_NOT_SENT`; read it from the database and hand it over securely).
6. Start exactly one worker; the log shows `Worker started`. Check the three schedules exist in Redis.
7. **Never run `pnpm seed` in production**; it refuses when `NODE_ENV=production` and creates demo accounts with a known password.
8. Smoke test: sign in on the web, add an employee, upload a document, punch from a test device.

## Operations

- **Backups**: MongoDB snapshots/`mongodump` plus bucket versioning. The attendance ledger is immutable by design, so restore points matter more than point-edits. Test restores.
- **Upgrades**: deploy API and worker together; run new image, check readiness, drain old. The web app can be redeployed independently unless `API_ORIGIN` changes (rebuild).
- **Logs**: JSON (pino). Authorization headers, cookies, passwords and tokens are redacted. Each response carries `x-request-id`; users can quote the `requestId` from error responses.
- **Stuck work**: the worker is idempotent; restart it freely. Emails stuck in `QUEUED` after a crash are not retried (links are not stored by design): re-issue the invite/reset.
- **Rate limiting** is in-process per API instance. With N instances the effective limit is N times higher. Account lockout (`LOGIN_MAX_FAILURES`, `LOCKOUT_MINUTES`) is stored in MongoDB and is shared. Put a WAF/edge rate limit in front for stronger protection.
- **Time**: servers are authoritative for time. Keep hosts on NTP.
- **Data retention**: raw GPS coordinates are purged by the worker after `LOCATION_RETENTION_DAYS`. Other data (attendance, audit, documents) is retained until you delete it; there is **no tenant-deletion or employee-erasure tool yet**.

## Troubleshooting

| Symptom                                             | Likely cause                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| API exits with "Invalid environment configuration"  | see the listed variables; production rules above                   |
| Punch/leave/onboarding fail with transaction errors | MongoDB is not a replica set                                       |
| Web shows "Cannot reach the server"                 | `API_ORIGIN` wrong at build time, or API down                      |
| Document upload fails in the browser                | `STORAGE_ORIGIN` missing at web build (CSP) or bucket CORS missing |
| Everyone shares one rate-limit bucket               | proxy not setting `X-Forwarded-For`, or more than one proxy hop    |
| Worker exits at start                               | `REDIS_URL` not set                                                |


## Customer-owned databases

Set `TENANT_DB_ENCRYPTION_KEYS` on both API and worker before enabling the option; back the key up separately from the database. See DATABASE_HOSTING.md for rotation and firewall notes.
