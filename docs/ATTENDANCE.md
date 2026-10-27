# Attendance (Phase 3)

## Principles

- **The server decides the time.** `occurredAt` is the server clock at receipt. A client `clientTimestamp` is stored for diagnostics only and never used in any calculation.
- **Punches are an immutable ledger.** `AttendanceEvent` rows cannot be updated or deleted (model hooks throw). Fixes are separate `AttendanceCorrection` records that the calculator applies on top.
- **Tenant, employee and role always come from the verified session**, never from the request body. Every query is scoped by `tenantId`; out-of-scope ids return 404.
- **GPS is evidence, not proof.** See "What location checks do and do not prove".

## Punch state machine

States: `OFF`, `WORKING`, `ON_BREAK`.

| From     | Allowed events                                            |
| -------- | --------------------------------------------------------- |
| OFF      | CHECK_IN                                                  |
| WORKING  | BREAK_START, CHECK_OUT                                    |
| ON_BREAK | BREAK_END (CHECK_OUT is refused until the break is ended) |

Anything else returns `409 INVALID_TRANSITION` with the current state and the allowed actions.
State is derived from the employee's latest event, not stored. **Stale-session rule:** if the open check-in is older than `settings.attendance.maxOpenSessionHours` (default 16) the state is treated as `OFF` so a forgotten check-out cannot block tomorrow; the old day is flagged as open/incomplete for correction.

`POST /attendance/{check-in,check-out,break-start,break-end}` require an `idempotencyKey` (8-100 chars, unique per employee). A replay returns the **original** event with `200` (first time is `201`), so mobile retries after a dropped response are safe.

Concurrency: each punch runs in a transaction that also writes the employee's day summary, so simultaneous requests conflict and retry, then fail the state check (`409`). A per-employee counter write is kept as an explicit lock as defense in depth. Tests cover 6 concurrent HTTP and 12 concurrent service-level check-ins with distinct keys. A mutation check showed those tests still pass without the explicit lock (the day-summary write already serializes same-day punches), so the tests prove the outcome but **do not prove the lock itself is necessary**.

## Work date and shifts

- `workDate` (`YYYY-MM-DD`) is computed in the shift's timezone (else the tenant's), using luxon so DST and overnight shifts work.
- A check-in is matched to the shift window (-4h/+4h tolerance) of yesterday, today or tomorrow, picking the nearest start. Overnight shifts therefore belong to the day they started. Check-out/break events inherit the open session's workDate.
- Shift assignments have `effectiveFrom/To` (string dates), cannot overlap for one employee, and a change never rewrites past days (the day record stores the policy version used).
- Holidays may be company-wide or per work location; weekly offs come from the shift (`weeklyOffDays`) else the tenant workweek.

## Daily calculation (`calculateDay`, version 1)

A pure function: same inputs and the same injected `now` always give the same result. Output is stored in `AttendanceDay` with `calculationVersion`.

- Worked minutes = sum of work sessions minus unpaid break time. Break policy `RECORDED`: unpaid break = recorded break minutes beyond `paidAllowanceMinutes`; `AUTO_DEDUCT`: a fixed `autoDeductMinutes` is deducted. Scheduled minutes = shift duration minus the expected break.
- Late: if the first check-in is later than `start + graceMinutes`, **all** minutes after the shift start count as late (grace is a threshold, not a discount). Early departure works the same way against the shift end and `earlyDepartureGraceMinutes`. Overtime applies only when the shift's `overtimePolicy` is enabled, worked exceeds scheduled, and the threshold/daily cap allow.
- Status: `PRESENT` when worked >= full-day requirement (default = scheduled minutes minus both grace allowances, or the shift's `minFullDayMinutes`), `HALF_DAY` when >= half-day requirement (`minHalfDayMinutes` or half of scheduled), else `ABSENT`. `HOLIDAY`, `WEEKLY_OFF` and `ON_LEAVE` take precedence on non-working days; `INCOMPLETE` marks a stale open session or a correction that supplied only one boundary. A past working day with no punches calculates as `ABSENT`; today with no punches is undetermined.
- Open sessions on the current day are shown as in-progress using `now`; they are not finalized.
- Leave integration: `resolveLeave()` is a hook that currently returns `null` (no leave module yet).
- Changing rules means bumping `calculationVersion`; recalculation is explicit, never silent.

## Geofencing and exceptions

Per employee `attendanceMode`: `OFFICE` (must be inside an assigned work-location fence), `FIELD` (location recorded, no fence), `REMOTE` (location optional).

For OFFICE mode: the reading must include accuracy <= `maxAccuracyMeters` (default 100) and the haversine distance to the nearest assigned fence must be <= its radius. Otherwise `422` with a specific code (`LOCATION_REQUIRED`, `POOR_ACCURACY`, `OUTSIDE_GEOFENCE`, `NO_GEOFENCE_CONFIGURED`) and **nothing is recorded**.

If the tenant allows it (`allowGpsExceptions`), the employee may resubmit with `exceptionReason`: an `AttendanceException` (PENDING) is created instead of an event. On **approval** the event is created, stamped with the _original attempt time_ and `verification.status = EXCEPTION_APPROVED`; it is refused if later events exist for that employee. Rejection records the reviewer's reason. A mock-location flag from the device is stored as a **risk signal only** and shown to reviewers; it never silently blocks or approves.

### What location checks do and do not prove

A geofence check shows that the device _reported_ coordinates inside the fence within the stated accuracy. It does **not** prove the employee is physically there: GPS can be spoofed, devices can be passed to others, and accuracy varies indoors. Treat it as one signal alongside review, shift context and audit trail. The app records location only at the moment of an explicit punch; there is **no continuous or background tracking**.

## Corrections

An employee requests a correction for a day in the last 60 days (`CORRECTION_WINDOW_DAYS`) with a reason and the proposed first-in / last-out (and optionally break) times. A reviewer approves or rejects; approval is applied by the calculator as an override of the **boundary punches only**; original events remain untouched and visible. Self-approval is blocked unless the tenant sets `allowSelfApproval` **and** the reviewer holds `attendance:review:all`. Managers can review only their direct reports; HR/Owner any employee in the tenant. Approve/reject/create actions are audited (without coordinates).

## Permissions

| Permission                                               | Roles                               |
| -------------------------------------------------------- | ----------------------------------- |
| attendance:punch, read:self                              | every role with an employee profile |
| attendance:read:team, events:read, review:team           | MANAGER (direct reports only)       |
| attendance:read:all, review:all, events:read             | COMPANY_OWNER, HR_ADMIN             |
| attendance:read:all (summaries only, no punch-level GPS) | PAYROLL_ADMIN                       |

## Endpoints (all under `/api/v1`, see the generated OpenAPI)

Punching: `POST /attendance/check-in | check-out | break-start | break-end`; self: `GET /attendance/me/today | me/events | me/history | me/exceptions`; admin: `GET /attendance/days`, `GET /attendance/days/:id`; workflow: `POST/GET /attendance/corrections`, `POST /attendance/corrections/:id/approve|reject`, `GET /attendance/exceptions`, `POST /attendance/exceptions/:id/approve|reject`.
Setup: `/shifts`, `/shift-assignments`, `/work-locations` (+ `POST /work-locations/:id/test` to check a coordinate against a fence), `/holidays`.

## Privacy and retention of location data

Coordinates are stored only on punch events and exception requests, are returned only to roles with `attendance:events:read` (plus the employee themself), and are never written to the audit log or application logs. A retention policy/purge job for old coordinates is **not implemented yet** (planned with the Phase 6 jobs); until then, retention is indefinite, so decide a policy and notify employees before production use.

## Known limitations

- No nightly job creates ABSENT rows for days with no punches; absence is computed when a day is queried or recalculated (planned with BullMQ in Phase 6).
- Leave is not integrated (`resolveLeave` returns `null`).
- Shift-change and approval notifications are not sent (Phase 6); the review queue is API-only until the dashboard (Phase 5).
- Cross-tenant tests exist for attendance, corrections and exceptions; exports and reports will add their own in Phase 5.
