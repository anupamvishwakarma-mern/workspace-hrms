# Phase 6: lifecycle, documents, audit, jobs, notifications, leave

## Running the worker

Background jobs run in a **separate process** and need Redis.

```powershell
# API (as before)
pnpm dev:api
# Worker: development / production
pnpm --filter @workforce/api worker          # tsx
pnpm --filter @workforce/api start:worker    # after pnpm build
```

The worker exits with a clear error if `REDIS_URL` is not set. The API itself does not need Redis.

| Job (BullMQ queue `workforce-maintenance`) | Schedule (server UTC) | What it does                                                                                                                                                                                   |
| ------------------------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `attendance-sweep`                         | every hour at :05     | For tenants whose **local** hour is 01:00-02:59, closes stale sessions and materialises absent/leave/holiday day rows for the last 3 days. Idempotent.                                         |
| `upload-cleanup`                           | every hour at :30     | Marks `PENDING_UPLOAD` documents older than 2 hours as `DELETED` and removes any object.                                                                                                       |
| `location-purge`                           | daily 03:15           | Removes raw GPS coordinates and accuracy from attendance events and exceptions older than `LOCATION_RETENTION_DAYS` (default 90, minimum 7). Times, distance and verification result are kept. |

One broken tenant (for example an invalid timezone) is logged and skipped; it does not stop the others.

The purge uses a native `updateMany`, the **only deliberate bypass** of the immutable attendance ledger. It touches nothing but the two location fields and sets `locationPurgedAt`; pending exceptions are not purged. Retention is a server-wide setting, not per tenant.

## Notifications

- **Email**: `EMAIL_PROVIDER=smtp` with `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`. Each message is first written to `emailoutboxes` as `QUEUED`, then delivered after the request completes: `SENT` or `FAILED` (with `error`). With `EMAIL_PROVIDER=none` the status stays `RECORDED_NOT_SENT`: nothing is sent. In production TLS is required. When a real provider is used, the activation/reset **link is not stored** in the outbox (it is a credential).
- **Push**: `PUSH_PROVIDER=expo` (+ optional `EXPO_ACCESS_TOKEN`). `POST /me/push-tokens` registers an Expo token for the signed-in user, `POST /me/push-tokens/remove` removes it. Payloads are minimal (no reason text, no names). Tokens reported `DeviceNotRegistered` are deleted.
- Events that notify the employee: correction and exception decisions, leave decisions.

## Leave

- `GET/POST/PATCH /leave-types` (manage: `leave:manage`; everyone can list active types).
- `GET /leave/balances?year=&employeeId=`, `POST /leave/requests`, `GET /leave/requests?scope=mine|review`, `POST /leave/requests/:id/approve|reject|cancel`.
- Chargeable days exclude the employee's shift weekly offs and holidays. A request is within one calendar year and at most 60 days; half days are single-day. Any overlap with an existing pending/approved request is a 409.
- Nobody approves their own request unless the tenant setting `allowSelfApproval` is on **and** the approver has company-wide review rights. Managers review their direct/indirect reports.
- The decision is an atomic PENDING-to-decision flip inside the per-employee transaction. Approved leave re-computes attendance days up to today and shows as `ON_LEAVE`/half day.
- Payroll admins can read leave dates and types but never reasons.

## Documents

Private S3-compatible storage (`OBJECT_STORAGE_*`). Flow: `POST /employees/:id/documents` (metadata) returns a presigned **PUT** (5 min, content type and length signed) → the browser uploads directly → `POST .../:docId/confirm` (server HEADs the object; size/type mismatch discards it) → `GET .../:docId/download` returns a 60-second presigned GET (`Content-Disposition: attachment`). Keys never contain the user's file name. Allowed: PDF, PNG, JPEG, DOCX, max 10 MB. Employees see only their own documents marked visible; HR/owner manage everything; everyone else gets 404. Without storage configured the endpoints answer 503 `STORAGE_NOT_CONFIGURED`.

**Deployment requirements for the web uploader:**

1. Build the web app with `STORAGE_ORIGIN=https://<your storage origin>` so the Content-Security-Policy `connect-src` allows exactly that origin (found by browser testing: without it uploads are blocked).
2. Configure bucket CORS to allow `PUT` and `GET` from the web origin with header `Content-Type`.

## Lifecycle and audit

- `POST /employees/:id/notice-period` (status `NOTICE_PERIOD`, last working day), `POST /employees/:id/reactivate` (returns with the EMPLOYEE role only, reason required). Both write history and audit entries.
- `GET /audit-logs` (`audit:read`: HR and owner): filters action, entityType, entityId, actorUserId, from, to; values were sanitised when written (no passwords, tokens or coordinates).
- Auto-generated employee codes now retry on a duplicate instead of failing with 409.

## Web

New pages: Leave (my leave, to review, leave types), Audit log, `/activate`, `/forgot-password`, `/reset-password`; employee dialog tabs Documents and Offboard (notice period, deactivate, reactivate). Navigation entries are cosmetic; the API enforces access.

## Limitations (honest list)

- The **mobile app does not yet register push tokens** (needs `expo-notifications` in a real build) and has no leave or document screens. The endpoints exist; push delivery was only tested against a local mock of the Expo API.
- Email was only tested against an in-process SMTP server, storage only against `s3rver` (which does not enforce signed Content-Length/Type; real S3/MinIO do, and `confirm` is the server-side backstop). Neither was run against a real provider.
- A `QUEUED` email that never gets delivered (process killed mid-send) is not retried because the link is intentionally not stored.
- No in-app notification list. No leave carry-over, accrual or manual balance adjustment; requests cannot span years.
- Sole owner/HR cannot approve their own leave unless the tenant setting `settings.attendance.allowSelfApproval` is on (the same switch as for corrections) and they have company-wide review rights.
- Location retention is global, not per tenant. The worker is a single separate process; run one in production.
- Web has no component or browser tests in the repo (a manual Playwright run covered the new pages); download uses a plain navigation to the signed URL.
