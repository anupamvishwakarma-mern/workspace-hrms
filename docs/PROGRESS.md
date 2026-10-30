# HRMS build progress

Last updated: 2026-10-30. Plan and gap analysis: [HRMS_AUDIT.md](HRMS_AUDIT.md).

## Done

- **Phase 1 (audit):** `docs/HRMS_AUDIT.md`.
- **Phase 2, increment 1 (API only):**
  - `Designation` model and `/designations` CRUD (`designation:read` for all roles, `designation:manage` for HR/owner; audited; unique title and optional unique code per company; delete blocked while assigned).
  - `Employee` gains `designationId`, `dateOfBirth`, `gender`, `personalEmail`. Assigning a designation copies its title into the existing `designation` text (payslips, letters and teams keep working unchanged) and writes a `DESIGNATION_CHANGE` history entry. DOB, gender and personal email are visible only to HR/owner and the employee themselves, not to managers or payroll.
  - Test file `apps/api/tests/designations.test.ts` (6 tests, passing).
- **Phase 2, increment 2 (web):** Designations page (`/designations`, nav entry EN+HI, visible with `designation:manage`); employee create/edit dialogs get a designation picker (free text only while the company has no designations) and date of birth, gender and personal email in the edit dialog.
- **Phase 2, increment 3 (probation and confirmation):** `POST /employees/:id/probation` (start or extend; extension needs a later date and a reason), `POST /employees/:id/confirm` (new permission `employee:confirm`, HR/owner; atomic, once only, never on your own record, not while serving notice), list filters `probationStatus` and `probationEndBefore`, history entries and audit. The old direct `confirmationDate` edit on `PATCH /employees/:id` was removed. Web: a Probation tab in the employee dialog. Tests: `apps/api/tests/probation.test.ts` (**not yet run**).

## Verification status

- `tsc --noEmit` on `apps/api`: clean.
- API suite on the owner's Windows machine: 290 passed, 2 skipped, 1 failed before the final signup fix (`signup.test.ts`, stale expectation: a repeated company name now gets a generated unique slug). That test was updated afterwards and **has not been re-run**; re-run `pnpm --filter @workforce/api test`.
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
- [ ] Sensitive subdocuments (bank, statutory IDs): new permission `employee:sensitive:read`, masked by default, audited reads/changes.
- [ ] Qualifications, previous employment, skills, certifications.
- [ ] Company settings: employee-ID and document numbering rules, office locations list, org hierarchy view.
- [ ] Configurable per-company roles (replace static map) or at least the new permission set listed in the audit.

Phase 3: approval engine first (workflows, requests, actions, self-approval and cycle prevention, escalation, delegation), then recruitment and onboarding.
Phase 4: leave policies/accrual/ledger/multi-level approval, shift types, WFH, manual attendance.
Phase 5: statutory rules (effective-dated config), adjustments, maker-checker payroll, payslip PDF, F&F groundwork.
Phase 6-10: as in the audit.

## Honest limits

Statutory payroll, letters and exit rules need review by qualified professionals before production use; nothing here claims compliance. Email, S3 and Expo integrations remain untested against real providers.
