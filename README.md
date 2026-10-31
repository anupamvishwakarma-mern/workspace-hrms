# Workforce HRMS

Multi-tenant Employee Attendance & HR Management SaaS (Express + MongoDB API, Next.js admin, Expo mobile app).
See [docs/ROADMAP.md](docs/ROADMAP.md) for phase status. **Currently: Phase 5 done (API through attendance, Expo mobile app, Next.js admin + reports).** Attendance rules: [docs/ATTENDANCE.md](docs/ATTENDANCE.md).

## Prerequisites

Node 20+, pnpm 10 (`corepack enable`), MongoDB 6+ **running as a replica set** (the Docker Compose file does this).

## Setup (Windows PowerShell)

```powershell
corepack enable
pnpm install
pnpm setup:env                 # creates apps\api\.env with generated secrets (never overwrites)
docker compose up -d mongo     # single-node replica set; or point MONGODB_URI at your own replica set
pnpm --filter @workforce/api seed
pnpm dev:api
```

Verify: `curl http://localhost:4000/api/v1/health/ready` -> `{"success":true,...}`.
`/api/v1/health/config` shows which optional integrations are configured (never secrets).

## Seed data and first admin

```powershell
pnpm --filter @workforce/api seed                      # LOCAL ONLY: demo company, 7 users, a Bengaluru HQ geofence, a 09:00-18:00 shift and ~10 days of sample punches (refuses in production)
$env:SUPER_ADMIN_PASSWORD="<strong password>"; pnpm --filter @workforce/api create-super-admin --email ops@yourco.com
```

Demo logins (local seed only, password `Demo-Pass-12345`): `owner@`, `hr@`, `manager@`, `asha@`, `ravi@`, `sara@`, `payroll@demo.test`.
There is no HTTP endpoint that creates a super-admin.

## API

Base path `/api/v1`. OpenAPI JSON: `GET /api/v1/docs/openapi.json` (generated from the route registry, so every route is documented).
Auth: `POST /auth/login` -> bearer access token (15 min) + rotating refresh token. Web clients send `X-Client-Type: web` to get the refresh token in an HttpOnly cookie.
Multi-company users send `X-Tenant-Id` to choose a company they belong to.
See [docs/TENANT_ISOLATION.md](docs/TENANT_ISOLATION.md) and [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md).

## Mobile app

```powershell
copy apps\mobile\.env.example apps\mobile\.env   # set EXPO_PUBLIC_API_URL (see docs/MOBILE.md)
pnpm dev:mobile
```

Details, device testing tips and limitations: [docs/MOBILE.md](docs/MOBILE.md).

## Web admin

```powershell
pnpm dev:web      # http://localhost:3000, proxies /api/v1 to the API on :4000
```

Sign in with `owner@demo.test` / `hr@demo.test` / `manager@demo.test` (seeded). Details, security design and limitations: [docs/WEB.md](docs/WEB.md).

## Background worker (Phase 6)

```powershell
pnpm --filter @workforce/api worker    # needs REDIS_URL; see docs/PHASE6.md
```

## Marketing website

`apps/marketing` is the public marketing site (features, pricing, database hosting, demo booking, free trial that hands off to the existing signup API). See [docs/MARKETING_SITE.md](docs/MARKETING_SITE.md). Run with `pnpm --filter @workforce/marketing dev` (port 3001).

## Database hosting (managed or customer-owned MongoDB)

Companies choose at signup between the platform-managed database and their own MongoDB. See [docs/DATABASE_HOSTING.md](docs/DATABASE_HOSTING.md) for architecture, env vars (`TENANT_DB_ENCRYPTION_KEYS`, `CUSTOMER_DB_*`), key rotation and limits.

## Deployment and security

[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (infrastructure, environment checklist, first deployment, operations) and [docs/SECURITY.md](docs/SECURITY.md) (controls, findings, residual risks). Example Dockerfiles and a compose file live in `deploy/`.

## Commands

`pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` · `pnpm format`

## Testing

Tests start a throwaway MongoDB replica set via `mongodb-memory-server` and never touch real data.
If its binary download is blocked, install `mongod` yourself and set `MONGOMS_SYSTEM_BINARY` (and `MONGOMS_VERSION`).

```powershell
$env:MONGOMS_SYSTEM_BINARY="C:\Program Files\MongoDB\Server\7.0\bin\mongod.exe"; pnpm test
```

## Troubleshooting

- _Startup exits with "Invalid environment configuration"_: fix the listed variables in `apps/api/.env`.
- _Readiness returns 503_: MongoDB is unreachable; check `MONGODB_URI`.
