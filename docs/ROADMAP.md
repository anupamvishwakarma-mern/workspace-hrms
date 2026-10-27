# Roadmap & Status

| Phase | Scope                                                                                                                                  | Status                                        |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1     | Monorepo, TS/ESLint/Prettier, env validation, Mongo connection, health checks                                                          | **Done**                                      |
| 2     | Tenants, users, memberships, employees, departments, auth (Argon2id, rotating refresh tokens), RBAC, tenant isolation, seed/CLI, tests | **Done**                                      |
| 3     | Shifts, work locations, attendance events/state machine, geofencing, corrections, exceptions                                           | **Done**                                      |
| 4     | React Native (Expo) app                                                                                                                | **Done** (not run on a device, see MOBILE.md) |
| 5     | Next.js admin dashboard, reports/exports                                                                                               | **Done** (see WEB.md limitations)             |
| 6     | Lifecycle, documents, audit logs, BullMQ jobs, notifications, leave                                                                    | **Done** (see PHASE6.md limitations)          |
| 7     | Full test pass, security review, deployment docs                                                                                       | **Done** (see SECURITY.md, DEPLOYMENT.md)     |

## Known limitations (Phase 7)

See [SECURITY.md](SECURITY.md#residual-risks-and-accepted-trade-offs) and the unverified items in [DEPLOYMENT.md](DEPLOYMENT.md): Docker images not built here, no independent penetration test, mobile not run on a device, no MFA, no erasure tooling.

## Known limitations (Phase 6)

See [PHASE6.md](PHASE6.md#limitations-honest-list). Main items: mobile does not register push tokens or show leave/documents; email/S3/Expo not tested against real providers; no leave accrual/carry-over.

## Known limitations (Phase 5)

See [WEB.md](WEB.md#limitations). Main items: no automated browser/component tests in the repo (a manual Playwright run was done); current roles are not displayed; "grant access" sends no email; absent days are materialised lazily by reports and now also by the Phase 6 nightly sweep; no map for locations. (Audit log, leave and document pages arrived in Phase 6.)

## Known limitations (Phase 4)

See [MOBILE.md](MOBILE.md#limitations). Main items: the app has been bundled for Android and iOS and tested at the client/contract level, but **never run on a device or emulator**; no push notifications, no biometric lock, no offline punch queue (by design), no screen/component tests.

## Known limitations (Phase 3)

See [ATTENDANCE.md](ATTENDANCE.md#known-limitations). Main items: leave integration hook returns `null` (no leave module yet); no nightly absent-row job; no location-data purge job; no notifications for approvals/shift changes; the explicit per-employee lock has no test that proves it is needed (outcome is tested).

## Known limitations (through Phase 2)

- Email/push providers exist since Phase 6; with `EMAIL_PROVIDER=none` emails are only _recorded_ as `RECORDED_NOT_SENT`.
- (Resolved in Phase 6: reactivation, audit-log API, documents and leave.)
- Tenant onboarding of a brand-new company is CLI/API-only (by design: no unauthenticated super-admin endpoint). Employee, role and settings management has a UI since Phase 5.

## Earlier limitations (Phase 1)

- Only health endpoints exist; no auth or business modules yet.
- `apps/web` and `apps/mobile` are placeholders.
- Docker Compose file is untested in the build sandbox (Docker Hub was unreachable); tests use a real `mongod` via mongodb-memory-server.
