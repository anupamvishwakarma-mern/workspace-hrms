# HRMS Phase 1 Audit (2026-10-30)

Scope of this audit: repository structure, `docs/*`, the API module/model/permission layout, the web navigation and the mobile tab layout, plus a typecheck of the API. I did **not** read every file line by line, and I could not run the test suite in my environment (see "Verification status"). Treat claims about behaviour as "per the docs and code structure", not as independently tested.

## 1. Current architecture

pnpm workspace with three independent apps (no shared `packages/`, matching the requirement):

| App | Stack | Size |
| --- | --- | --- |
| `apps/api` | Express 4, TypeScript, Mongoose 8, Zod 4, BullMQ/ioredis, Argon2id, JWT, pino, nodemailer, S3 SDK | ~134 files, ~11k lines in modules/models |
| `apps/web` | Next.js App Router, Tailwind, TanStack Query | ~88 files |
| `apps/mobile` | Expo / Expo Router, TypeScript | ~96 files |

Key design points already in place:

- **Multi-tenancy:** every tenant-owned document has `tenantId`, tenant comes from the membership (never the client; `X-Tenant-Id` only selects among the user's own memberships), and `tenantModel()` additionally routes each company to its **own MongoDB database** (`tenantDb.ts`, `tenantContext.ts`). A test guard fails the suite if a query on a tenant model lacks a `tenantId` filter.
- **Auth:** Argon2id, 15-min access JWT bound to a DB session, rotating refresh tokens stored as HMAC with reuse detection, lockout, web HttpOnly cookie / mobile Keychain.
- **RBAC:** static role-to-permission map in `auth/permissions.ts` (roles: COMPANY_OWNER, HR_ADMIN, MANAGER, EMPLOYEE, PAYROLL_ADMIN) with scope-suffixed permissions (`:self`, `:team`, `:all`). An authorization-matrix test is generated from the route registry.
- **Money:** integer minor units (paise).
- **Audit:** append-only `auditlogs` with sanitised before/after.
- **Docs/storage:** private S3-compatible bucket, presigned PUT (5 min) / GET (60 s), type and size allow-list.
- **Jobs:** separate BullMQ worker (attendance sweep, upload cleanup, GPS purge). Email outbox + Expo push.
- **OpenAPI** generated from the route registry.

## 2. Existing modules (completed or partial) against the 20 requested modules

| # | Requested module | Status | Notes |
| --- | --- | --- | --- |
| 1 | Company management | Partial | Tenants, branding, timezone, workweek, attendance settings, work locations (geofence), holidays, departments, signup/provisioning. Missing: designations, org hierarchy view, ID/document numbering rules, per-company notification settings, approval config, policies. |
| 2 | Recruitment | **Missing** | |
| 3 | Employee management | Partial | Core record, manager, department, status transitions, history[], notice period, reactivation. Missing: DOB, gender, personal email, probation/confirmation workflow, qualifications, previous employment, skills, bank/statutory data, designation entity, promotion/transfer/salary-revision records, statuses PROBATION/CONFIRMED/RESIGNED/RETIRED. |
| 4 | Onboarding | **Missing** | Invite/activation email flow exists, no checklist/joining form. |
| 5 | Attendance | **Mostly complete** | GPS, geofence, check-in/out, breaks, immutable events, derived day rows, corrections, exceptions, punch photo, FIELD/REMOTE modes, reports. Missing: explicit overtime policy approval, manual attendance entry by HR, WFH request. |
| 6 | Shifts & holidays | Partial | Shifts (grace, break policy, weekly offs), assignments with effective dates, holidays. Missing: rotating/flexible/split shift types, optional holidays, shift change requests, overtime policy. |
| 7 | Leave | Partial | Types, annual allowance, requests, half-day, approve/reject/cancel, atomic decision in a transaction, balances. Missing: accrual, carry-forward, encashment, multi-level approval, comp-off, adjustment/grant history, cross-year requests. |
| 8 | Payroll | Partial ("transparent calculator") | Versioned immutable salary structures, monthly run, LOP, payslips, DRAFT→PUBLISHED. Missing: statutory rules engine (PF/ESI/PT/TDS/gratuity), adjustments/arrears/bonus/loans/advances, maker-checker approval, PDF payslips, F&F, 8-state lifecycle, salary revision workflow, per-period/per-employee record model (`PayrollRun` is one per month, payslip is the record). |
| 9 | Document management | Partial | Upload/confirm/download, owner visibility. Missing: categories taxonomy, verification/rejection/versioning/expiry, download history, approval states. |
| 10 | Letters | Partial | Plain-text templates with placeholders, issue, revoke, reference numbers, immutable rendered text. Missing: PDF, template versions, approval workflow states, signatory/logo, request flow. |
| 11 | Employee self-service | Partial | Mobile: Today, Attendance history, Requests, More; web has HR pages. No salary/document/leave/work screens on mobile per PHASE6 notes (may have changed in the uncommitted work). |
| 12 | Manager portal | Partial | Team tab, `/team/today`, team-scoped attendance/leave review. Missing: tasks, performance, WFH/shift approvals. |
| 13 | Performance | **Missing** | |
| 14 | Tasks | **Missing** | |
| 15 | Assets | **Missing** | |
| 16 | Exit / F&F | Partial (small) | Notice period + deactivate only. Missing resignation workflow, clearances, F&F. |
| 17 | Helpdesk | **Missing** | |
| 18 | Policies / announcements | Partial | HR handbook (draft/published sections). Missing: versioning, acknowledgements, announcements. |
| 19 | Reports | Partial | Attendance, leave insights, CSV export. Missing: Excel/PDF export, payroll/HR/recruitment reports. |
| 20 | Notifications | Partial | Email outbox, Expo push, decision notifications. Missing: in-app inbox, reminders, preferences. |
| – | Approval engine | **Missing** | Approvals are hard-coded per feature (corrections, exceptions, leave). |
| – | Subscriptions / SaaS super admin | Partial | `platform.routes.ts` and `planId` exist; no Subscription model. |

## 3. Database changes required

Existing collections to **extend** (not duplicate): `employees` (personal/employment/qualification/bank/statutory subdocs, new statuses), `membership` roles (see §6), `leavetypes` (accrual, carry-forward, encashment), `leaverequests` (approval chain), `salarystructures` / `payroll` (statutory, adjustments, lifecycle), `employeedocuments` (category, verification, version, expiry), `letters` (template version, status), `handbooksections` (versioning), `tenants` (numbering rules, notification and approval settings).

New collections (all with `tenantId`, compound indexes, registered through `tenantModel` so they get provisioned into the company DB): designations, recruitmentJobs, candidates, interviews, onboardingTasks, employeeChanges (promotion/transfer/revision history), approvalWorkflows, approvalRequests, approvalActions, leavePolicies/leaveBalances/leaveLedger, payrollComponents, statutoryRules (effective-dated), payrollAdjustments, loans/advances, documentTemplates (versioned), documentAccessLog, performanceCycles/Goals/Reviews, tasks, assets/assetAssignments, resignations, exitClearances, finalSettlements, helpdeskTickets, policies + acknowledgements, announcements, notifications (in-app), subscriptions (platform DB).

Open design decision: the existing `PayrollRun` + `Payslip` pair vs. the requested `payrollPeriods` / `payrollRecords`. Recommendation: keep `PayrollRun` as the period and `Payslip` as the record; add status states and an `adjustments` collection rather than renaming.

## 4. Functionality that must be preserved

Attendance state machine, immutable event ledger and its single documented GPS-purge bypass; calculation versioning; corrections and exceptions; geofence logic; punch photos; auth/session/refresh behaviour; per-company database routing and the tenant-filter test guard; the route-registry-driven authorization matrix and OpenAPI; integer-minor-unit money; append-only audit; seed/bootstrap scripts; bilingual (EN/HI) dictionaries with key-parity test; the existing web and mobile contract tests.

## 5. Security and permission gaps (against the requirements)

1. **No approval engine / maker-checker** for payroll, salary changes or letters (SECURITY.md already notes this). HR can publish payroll alone.
2. **Roles are a static map**, not configurable per company; no custom roles, no delegation, no escalation.
3. **No sensitive-field authorization** for bank/statutory identifiers (fields do not exist yet; design them as separate permission-gated subdocuments, masked by default).
4. **Document downloads are not logged** (no download history) and documents have no verification/approval states.
5. **No malware scanning hook**; no retention/secure-deletion workflow.
6. **No MFA**, rate limits are per process (in-memory), no Redis-backed limiter.
7. **Salary data unencrypted at application level** (field-level encryption not present).
8. **Manager scope** covers attendance/leave only; each new module (tasks, performance, documents, salary) needs an explicit team-scope rule and a "no salary/bank for managers" test.
9. **Super admin** is correctly not a tenant member; keep it that way (verify `platform.routes.ts` exposes no per-employee data).
10. **Self-approval:** leave has a tenant switch allowing it; the generic engine must forbid it for salary/payroll regardless of settings.
11. **Working tree is not committed:** 87 files are modified/uncommitted over a single commit ("initialize testing code"). Please commit or branch before large changes so work can be reviewed and reverted.

## 6. Phase-wise development plan

Aligned to your 10 phases. Each phase ends with API tests, web/mobile screens for that phase, docs and an updated `docs/PROGRESS.md`.

- **P2 Core HR foundation:** designations; extended employee record (personal/employment/probation); sensitive subdocuments with permission gating; employee statuses; employment-change history (promotion, transfer, manager change); org settings (numbering rules); roles/permissions additions (see below); directory search/filter.
- **P3 Recruitment & onboarding:** jobs, candidates, interviews, offers, candidate→employee conversion; onboarding checklist templates and tasks. Depends on the approval engine (offer approval), so build the engine's core at the start of P3.
- **P4 Attendance & leave:** shift types, optional holidays, leave policies, accrual/carry-forward, balance ledger, multi-level leave approval on the engine, manual attendance, WFH and shift-change requests.
- **P5 Payroll:** payroll components, effective-dated statutory rules (configurable, no hard-coded rates), adjustments/arrears/loans, 8-state lifecycle with maker-checker, salary revision workflow, payslip PDFs, payroll reports.
- **P6 Documents & letters:** categories, verification/versioning/expiry, download log, versioned templates, PDF generation, approval states, request flows.
- **P7 Self-service & manager:** mobile screens for salary, documents, leave, work, requests; manager dashboard; web "My" pages.
- **P8 Advanced HR:** performance, tasks, assets, resignation/exit/F&F, helpdesk, policies/announcements.
- **P9 Reports:** payroll/HR/recruitment reports, Excel + PDF export with permission checks.
- **P10 Production readiness:** tenant isolation and payroll accuracy test passes, security review, monitoring, backup docs, mobile device testing.

## 7. Recommended implementation order and rationale

1. Commit the current working tree (user action).
2. Run the existing suite on a machine with MongoDB to confirm a green baseline.
3. P2 (foundation) - everything else references employees, designations and permissions.
4. **Approval engine** (start of P3) - recruitment offers, leave, salary revision, payroll, letters and documents all need it; building it once avoids six bespoke flows.
5. P4/P5 before documents, because payroll and leave need the engine and balance ledger.
6. Then P6-P9, then hardening.

New permission set to add in P2 (names only; behaviour in later phases): `designation:read/manage`, `employee:sensitive:read` (bank/statutory), `employee:salary:read`, `recruitment:*`, `onboarding:*`, `approval:configure`, `payroll:approve`, `salary:revise`, `salary:approve`, `document:verify`, `document:approve`, `asset:manage`, `helpdesk:manage`, `grievance:read:restricted`, `announcement:manage`, `policy:manage`, `report:*`. Add roles later via configurable per-company role records rather than more hard-coded roles.

## 8. Verification status

- `tsc --noEmit` on `apps/api` source: **clean** (only errors are from API tests importing mobile/web source when those apps' dependencies are not installed).
- Test suite: **not run** here. mongodb-memory-server could not download its binary (HTTP 403) and no Docker daemon is available. Existing tests must be run on your machine (see README, `MONGOMS_SYSTEM_BINARY`).
- Everything built in later steps must be run by you before being trusted; each change will be listed with what was and was not verified.

## 9. Legal and product caveats

Statutory payroll (PF, ESI, PT, TDS, gratuity, labour welfare), letters, and termination/F&F rules vary by state, company and employee. All such rules will be effective-dated configuration with no hard-coded rates, and need review by a qualified payroll/legal professional before production use. The app will not claim compliance.
