# HRMS build progress

Last updated: 2026-10-30. Plan and gap analysis: [HRMS_AUDIT.md](HRMS_AUDIT.md).

## Done

- **Phase 1 (audit):** `docs/HRMS_AUDIT.md`.
- **Phase 2, increment 1 (API only):**
  - `Designation` model and `/designations` CRUD (`designation:read` for all roles, `designation:manage` for HR/owner; audited; unique title and optional unique code per company; delete blocked while assigned).
  - `Employee` gains `designationId`, `dateOfBirth`, `gender`, `personalEmail`. Assigning a designation copies its title into the existing `designation` text (payslips, letters and teams keep working unchanged) and writes a `DESIGNATION_CHANGE` history entry. DOB, gender and personal email are visible only to HR/owner and the employee themselves, not to managers or payroll.
  - Test file `apps/api/tests/designations.test.ts` (6 tests, passing).
- **Phase 2, increment 2 (web):** Designations page (`/designations`, nav entry EN+HI, visible with `designation:manage`); employee create/edit dialogs get a designation picker (free text only while the company has no designations) and date of birth, gender and personal email in the edit dialog.
- **Phase 2, increment 3 (probation and confirmation):** `POST /employees/:id/probation` (start or extend; extension needs a later date and a reason), `POST /employees/:id/confirm` (new permission `employee:confirm`, HR/owner; atomic, once only, never on your own record, not while serving notice), list filters `probationStatus` and `probationEndBefore`, history entries and audit. The old direct `confirmationDate` edit on `PATCH /employees/:id` was removed. Web: a Probation tab in the employee dialog. Tests: `apps/api/tests/probation.test.ts` (9 tests, passing).

- **Phase 2, increment 4 (restricted bank and statutory data, API only):** `EmployeeSensitive` model (one record per employee) with bank account, IFSC, PAN, Aadhaar, UAN and similar identifiers encrypted at rest with AES-256-GCM (context-bound to tenant, employee and field). `GET /employees/:id/sensitive` returns masked values; `?reveal=true` (HR/owner only) returns plaintext and writes an audit entry. `PUT /employees/:id/sensitive` (HR/owner) audits field names only, never values. Nobody edits their own record; ordinary employee endpoints never return these fields. New permissions `employee:sensitive:read` and `employee:sensitive:update`. **Requires `FIELD_ENCRYPTION_KEY` (64 hex characters) in `apps/api/.env`. Back it up: losing it makes stored values unreadable.** `.env.example` and `scripts/setup-env.mjs` updated. Tests: `field-crypto.test.ts` (5, pass in cloud), `sensitive.test.ts` (10, **not yet run** - needs your Mongo run).

- **Phase 3, increment 1 (approval engine core, API only):** configurable workflows per request type (`/approval-workflows`, `approval:manage` = HR/owner; one active workflow per type; steps are MANAGER (with skip-level), ROLE or a named EMPLOYEE). Requests (`/approvals`) snapshot their steps and approvers when raised, so later workflow edits do not change requests in flight. Rules enforced: the requester is never an approver (even by role or delegation); an unmanaged requester's MANAGER step goes to the owner; steps with no eligible approver are skipped, and a request with none at all is refused (422); decisions are atomic (no double-decide); out-of-turn approvers get 404; reject ends the request; requester can cancel while pending; manager-chain walk is cycle-safe. Delegation (`/approval-delegations`, up to 90 days, revocable, records who acted for whom). Inbox, mine and all scopes. Audited. Tests: `apps/api/tests/approvals.test.ts` (13 tests). **Not yet wired into leave/attendance/etc.** API suite last run: 335 passed, 2 skipped. - those keep the existing manager/owner rule until each module is migrated deliberately. **Not built yet:** escalation of overdue steps (needs a scheduler), parallel/any-n-of approvers, conditional routing, notifications on assignment, web delegation screen.
- **Phase 3, increment 2 (web):** `/requests` (tabs: Waiting on me, My requests, All requests for HR/owner; raise, approve/reject with comment, withdraw; shows each step and who acted for whom) and `/workflows` (HR/owner: add/edit chains with manager, role or named-person steps). Nav entries EN+HI. API responses now include requester and approver names. Web checked in cloud: `tsc` clean, 19/19 unit tests, `next build` succeeds. **Not tried in a browser.** The older `/approvals` page remains the attendance-correction review.

- **Phase 3, increment 3 (leave on the engine, opt-in):** if a company has an ACTIVE approval workflow with request type `LEAVE`, new leave requests are routed through it (e.g. Manager -> HR). The leave stays PENDING until the last step; a rejection at any step rejects it; approving/rejecting works from either `/leave/requests/:id/approve|reject` or `/approvals/:id/decision`, and the same effects apply (attendance recalculation, allowance re-check before the final approval). Withdrawing either side withdraws both. If nobody is eligible to approve, the request is refused and nothing is left behind. Without an active `LEAVE` workflow nothing changes (existing manager/owner rule). Engine hooks (`registerHooks`) let other modules (expenses, assets, exit) plug in the same way. Known limits: the leave review list (`scope=review`) still shows requests by the old manager/HR scope, so a named-person approver who is not a manager/HR sees them under `/requests` only; the company's `allowSelfApproval` setting is ignored for workflow-routed leave (self-approval is never allowed there). Tests: `apps/api/tests/leave-workflow.test.ts` (7 tests, **not yet run**).

- **Phase 4, increment 1 (leave policy, accrual, ledger; API only):** leave types gain `accrualMode` (ANNUAL = whole allowance from 1 Jan, the old behaviour and the default; MONTHLY = credited month by month) and `carryForwardMaxDays`. New append-only `LeaveLedger` (accruals, carry-forward, manual adjustments; never edited, corrected by a new adjustment). Entitlement = base allowance (ANNUAL only) + ledger entries; applying, approving, balances (`entitlement` breakdown, `allowanceDays` = total) and the leave insights report all use it. Endpoints: `POST /leave/ledger/accrue` (month `YYYY-MM`, idempotent, future months refused), `POST /leave/ledger/carry-forward` (finished years only, idempotent, pending+approved count as used), `POST /leave/ledger/adjustments` (reason required, audited), `GET /leave/ledger` (own, or within read scope). Rules chosen (company policy, not law): twelve monthly credits add up exactly to the allowance in half-day steps; people accrue from the month they joined with no back-fill. **Accrual and carry-forward are triggered by HR through the API; nothing runs them on a schedule yet** (the job queue exists and can host them). Tests: `leave-ledger.test.ts` (10, **not yet run**), `leave-ledger-calc.test.ts` (8, pass in cloud). API suite last run: 353 passed, 2 skipped.
- **Phase 4, increment 2 (web for the above):** Leave types form gets accrual mode and carry-over limit (and the table shows them); HR Balances tab shows each entitlement with its breakdown (base, accrued, carried, adjusted), an Adjust action per leave type (reason required), the year's credits and adjustments list, and buttons for monthly accrual and year-end carry-forward. Web checked in cloud: `tsc` clean, 19/19 unit tests, `next build` succeeds. **Not tried in a browser.** Employees do not yet see their own ledger in the web app (API exists). API suite last run: 353 passed, 2 skipped.

- **Phase 4, increment 3 (attendance: manual entry, flexible shifts, work from home; API only):**
  - **Manual attendance:** `POST /attendance/manual` (new permission `attendance:manual`, HR/owner). Reason required, never for your own record. Stored as an already-approved correction marked `HR_MANUAL`, so original punches stay untouched and the existing calculator applies it; entries that clash with real punches are refused and leave nothing pending. Audited. (The correction review code was split so the apply step is shared; behaviour of normal reviews is unchanged.)
  - **Shift types:** `shiftType` FIXED (default, unchanged) or FLEXIBLE (no late or early-departure marks; the day counts by hours, so `minFullDayMinutes` is required). Overnight/night shifts already worked and are reported as `overnight`. Rotational patterns are still done with dated shift assignments; there is no rotation generator.
  - **Work from home:** `POST/GET /wfh/requests`, `POST /wfh/requests/:id/cancel` (permission `wfh:request`, all roles). Decided through the approval engine: if the company has no active `WFH` workflow, a one-step "manager (owner if none)" workflow is created automatically and HR can edit it under Approval workflows. While a request is APPROVED, an office employee's punches on those days use remote rules (no office location needed); field and remote staff are unaffected. Approved days that have started cannot be withdrawn. There is no web screen yet; approvers decide under `/requests`.
  - Tests: `phase4-attendance.test.ts` (15, **not yet run**); DB-free suites pass in cloud (calculation, geo).

## Verification status

- `tsc --noEmit` on `apps/api`: clean.
- API suite on the owner's Windows machine, last run: 299 passed, 2 skipped, 1 failed. The 6 designations and 9 probation tests pass. The one failure (`signup.test.ts`, 429 rate limit) was a delivery mistake on my side: the fix that raises the signup rate limit for that test file had not reached the repo. It has now; re-run to confirm.
- Test tip (Windows): the temporary MongoDB needs free disk space in the temp folder; set `TMP`/`TEMP` to a drive with space.
- Web (checked in my cloud copy): `tsc --noEmit` clean, web unit tests 19/19 pass, `next build` succeeds with the new `/designations` route. **Not tried in a browser.**
- Mobile: unchanged.

## Decisions recorded

- **Approver rule (existing uncommitted code, kept by the owner):** a request is decided by the employee's manager; if the employee has no manager, by the company owner. HR does not approve on others' behalf. Old tests that assumed HR approval were updated. This differs from the "Manager -> HR" chains in the spec; HR approval is expected to come back through the approval engine (Phase 3) as a configurable step.
- **Bug fixed:** `GET /attendance/corrections` had become a review-only inbox, hiding employees' own requests; it now returns own requests plus those you decide.

- **Probation is not an employment status.** The spec lists PROBATION and CONFIRMED beside ACTIVE, but attendance, leave, payroll and the apps all treat ACTIVE/NOTICE_PERIOD as "working". Making probation a status would silently stop probationers from punching in. So probation is a separate field (`probationStatus`: ON_PROBATION or CONFIRMED) and the employee stays ACTIVE.

## Before continuing

1. Commit the working tree.
2. Delete `_to_delete/cloud-baseline-snapshot.tgz`.

## Continuation checklist (in order)

Phase 2 remainder
- [x] Web: Designations page; designation picker and personal fields in the employee dialog (browser check still pending).
- [x] Probation/confirmation (tracked as `probationStatus`, separate from `employmentStatus`, see decision below).
- [ ] RESIGNED and RETIRED as ended statuses: do together with the exit workflow (Phase 8); every place that treats TERMINATED as ended (seat limit, attendance, leave, shifts, platform stats, reactivation) must be switched to one shared `isEnded()` check first.
- [ ] Employment-change records (promotion, transfer, salary revision link) as a dedicated collection.
- [x] Sensitive subdocuments (bank, statutory IDs): API done (masked by default, audited reveal/changes). [ ] Web "Bank & IDs" tab still to do.
- [ ] Qualifications, previous employment, skills, certifications.
- [ ] Company settings: employee-ID and document numbering rules, office locations list, org hierarchy view.
- [ ] Configurable per-company roles (replace static map) or at least the new permission set listed in the audit.

Phase 3: approval engine first (workflows, requests, actions, self-approval and cycle prevention, escalation, delegation), then recruitment and onboarding.
Phase 4: leave policies/accrual/ledger/multi-level approval, shift types, WFH, manual attendance.
Phase 5: statutory rules (effective-dated config), adjustments, maker-checker payroll, payslip PDF, F&F groundwork.
Phase 6-10: as in the audit.

## Honest limits

Statutory payroll, letters and exit rules need review by qualified professionals before production use; nothing here claims compliance. Email, S3 and Expo integrations remain untested against real providers.
