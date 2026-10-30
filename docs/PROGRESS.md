# HRMS build progress

Last updated: 2026-10-30. Plan and gap analysis: [HRMS_AUDIT.md](HRMS_AUDIT.md).

## Done

- **Phase 1 (audit):** `docs/HRMS_AUDIT.md`.
- **Phase 2, increment 1 (API only):**
  - `Designation` model and `/designations` CRUD (`designation:read` for all roles, `designation:manage` for HR/owner; audited; unique title and optional unique code per company; delete blocked while assigned).
  - `Employee` gains `designationId`, `dateOfBirth`, `gender`, `personalEmail`. Assigning a designation copies its title into the existing `designation` text (payslips, letters and teams keep working unchanged) and writes a `DESIGNATION_CHANGE` history entry. DOB, gender and personal email are visible only to HR/owner and the employee themselves, not to managers or payroll.
  - Test file `apps/api/tests/designations.test.ts`.

## Verification status (read this)

- `tsc --noEmit` on `apps/api`: clean.
- **No test has been run**, old or new. My workspace cannot download MongoDB and your `node_modules` are Windows builds. Run on your machine:
  `pnpm --filter @workforce/api test` (set `MONGOMS_SYSTEM_BINARY` if the download is blocked). Expect to fix small issues in the new test file. In particular, check the existing authorization-matrix and tenant-guard tests still pass with the new routes.
- No web or mobile changes yet, so there is no UI for designations.

## Before continuing

1. Commit the existing uncommitted work (87 files) so my changes are reviewable.
2. Run the full API test suite and tell me the result.
3. `_to_delete/cloud-baseline-snapshot.tgz` is a temporary copy I made; delete it.

## Continuation checklist (in order)

Phase 2 remainder
- [ ] Web: Designations page; designation picker and personal fields in the employee dialog; i18n keys (EN+HI parity test).
- [ ] Employee statuses PROBATION/CONFIRMED/RESIGNED/RETIRED with transition table, probation end/confirmation action, history.
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
