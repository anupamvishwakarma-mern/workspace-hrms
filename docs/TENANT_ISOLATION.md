# Tenant isolation & authorization

## Model

Shared MongoDB database; every company-owned document carries `tenantId` and every unique index is
tenant-scoped (e.g. `{tenantId, employeeCode}`). Users are **global** (one login can belong to several companies);
company roles live on `Membership {tenantId, userId, roles, employeeId, status}`.

## Request pipeline

1. `authenticate` - verifies the HS256 JWT (issuer/audience pinned), then re-checks in the DB that the **session is not
   revoked/expired** and the **user is ACTIVE**. Logout, password reset and deactivation therefore take effect immediately.
2. `resolveTenant` - loads the caller's own ACTIVE memberships. `X-Tenant-Id` is only a _selector among those memberships_;
   a tenant the user does not belong to yields 403. With exactly one membership no header is needed. Suspended/closed tenants yield 403.
3. `requirePermission(...)` - role -> permission map in `modules/auth/permissions.ts`.
4. Handlers query with `tenantId` taken from `req.tenantCtx` (never from body/query/params).

## Rules every module must follow

- Look records up with `{ _id, tenantId }`; return **404** (not 403) when not found so existence is not revealed.
- Validate every referenced id (department, manager, location, ...) with a `{ _id, tenantId }` lookup before saving.
- Zod schemas are `.strict()`: unknown fields (e.g. `tenantId`, `roles`, `userId`) are rejected -> no mass assignment.
- Body/query/params containing `$`-prefixed or dotted keys are rejected before routing (NoSQL injection defence in depth).

## Visibility within a tenant (employees)

| Role                    | Sees                  | Fields                                                                   |
| ----------------------- | --------------------- | ------------------------------------------------------------------------ |
| COMPANY_OWNER, HR_ADMIN | all employees         | full (incl. address, emergency contacts, history)                        |
| MANAGER                 | self + direct reports | team view: no address/emergency/history; self: own view                  |
| EMPLOYEE                | self only             | own view (no history)                                                    |
| PAYROLL_ADMIN           | all employees         | minimal: code, name, department, designation, status, type, joining date |

## Platform super-admin

`User.isPlatformAdmin` is a platform capability, not a tenant role. A super-admin has no membership, so **cannot** read
employee data (tested). `/platform/*` exposes tenant metadata and counts only. Created only via CLI (`create-super-admin`).

## Privilege-escalation guards

Owners may assign any role; HR may assign only EMPLOYEE/MANAGER; nobody changes their own roles; the last active owner
cannot be removed or deactivated.

## Attendance visibility

| Role                    | Sees                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------- |
| EMPLOYEE                | own punches, days, corrections and exceptions                                           |
| MANAGER                 | direct reports' days/events; reviews only their direct reports; never their own request |
| COMPANY_OWNER, HR_ADMIN | everyone in the tenant, incl. GPS verification detail                                   |
| PAYROLL_ADMIN           | daily summaries only, no punch-level coordinates                                        |

Tenant, employee and role for a punch come from the session, never the body. Referenced work locations/shifts/employees are validated to belong to the same tenant.

## Phase 6 visibility

- **Audit log**: `audit:read` (owner, HR) only; always filtered by the caller's tenant.
- **Leave**: employees see their own requests and balances; managers see their reports' (not their own scope bypass); HR/owner see everyone; payroll sees dates and types without reasons. Out-of-scope ids answer 404.
- **Documents**: HR/owner manage any employee in the tenant; an employee sees only their own documents flagged visible; everyone else, and every other tenant, gets 404. Storage keys embed the tenant id but access is always checked in the API, never by key.
- **Push tokens**: bound to the authenticated user; a token re-registered by another user moves to that user.
- Background jobs iterate tenants one at a time and always filter by `tenantId`.

## Reports and exports

`/reports/dashboard`, `/reports/attendance/summary` and `/reports/attendance/export` require `attendance:read:all` (owner, HR, payroll: whole company, summaries only) or `attendance:read:team` (manager: direct reports only). The employee set is resolved server-side from the session's tenant and role; `departmentId`/`employeeId` filters can only narrow it, so a foreign or out-of-scope id yields an empty result, not data. Pending-approval counts exclude the viewer's own requests. Exports are audit-logged (filters and row count, never contents). Approval lists (`/attendance/corrections`, `/attendance/exceptions`) include a minimal employee reference (id, code, name) for reviewers only within their review scope.

Settings (`PATCH /tenants/current`) are owner-only with a strict body; HR and managers receive 403.

## Tests proving isolation

`tests/tenancy.test.ts`: cross-tenant read/list/update/invite/deactivate/role-change/department edits, cross-tenant
reference injection, `X-Tenant-Id` abuse, super-admin boundaries, suspended tenants. `tests/scheduling.test.ts` and `tests/corrections.test.ts` add cross-tenant checks for shifts, locations, corrections and exceptions. `tests/reports.test.ts` and `tests/web-contract.test.ts` cover reports, exports, settings and approval lists across tenants and roles.


## Dual hosting

A tenant's database is resolved only by `TenantDatabaseManager` from the verified membership; missing or non-READY config fails closed (never a fallback). Customer-owned tenants use their own pooled connection with connection-specific models. See DATABASE_HOSTING.md.
