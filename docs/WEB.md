# Web admin (apps/web)

Next.js (App Router) + Tailwind 4 + TanStack Query + React Hook Form/Zod + Recharts. For **owners, HR, managers and payroll**. Plain employees use the mobile app; if one signs in on the web they see "Use the mobile app".

## Run

```powershell
pnpm dev:api                    # API on :4000 (see README for Mongo + seed)
pnpm dev:web                    # http://localhost:3000
```

Production-style: `pnpm --filter @workforce/web build` then `pnpm --filter @workforce/web start`.
`API_ORIGIN` (default `http://localhost:4000`) is read **at build time** because Next bakes rewrites into the build; set it when building for another environment. See `apps/web/.env.example`.
Demo logins after seeding: `owner@demo.test`, `hr@demo.test`, `manager@demo.test`, `payroll@demo.test` (password `Demo-Pass-12345`).

## Architecture decisions

- **Same-origin proxy.** `next.config.ts` rewrites `/api/v1/*` to `API_ORIGIN`. The browser only talks to its own origin, so the refresh cookie is first-party (`SameSite=Strict`, `HttpOnly`, path `/api/v1/auth`, `Secure` in production) and the API needs no CORS for the web app.
- **Tokens.** The access token lives in memory only (never localStorage/sessionStorage; the browser test asserts no JWT in web storage). A page reload restores the session from the refresh cookie. Refresh is single-flight: concurrent 401s share one refresh, which matters because the API rotates refresh tokens and treats reuse as theft (covered by a unit test that fails if single-flight is removed).
- **Company switching.** `X-Tenant-Id` is only a selector among the user's own memberships; the server re-checks membership on every request. All query keys include the tenant id and the cache is cleared on switch and sign-out, so one company's rows never render under another.
- **Authorization is enforced by the API.** The menu and the "no access to this page" screen are driven by the `permissions` list returned with each membership. That is cosmetic. Every endpoint checks permission and tenant scope itself, and `tests/web-contract.test.ts` proves forbidden calls fail even when the UI would not have offered them.
- **Security headers.** CSP, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` are set in `next.config.ts`; no third-party scripts are loaded. **Known weakness:** `script-src` allows `'unsafe-inline'` because Next injects inline bootstrap scripts; a nonce-based CSP was evaluated in Phase 7 and deferred (see SECURITY.md, residual risks). Dev mode additionally allows `'unsafe-eval'` for Next tooling; production does not.
- **Dates.** All times render in the **company** time zone (from `/tenants/current`), not the viewer's browser zone.

## Design system

Teal, light-first SaaS look (dark mode follows the OS). All colours, radii and shadows are CSS variables in `src/app/globals.css`; shared primitives live in `src/components/ui/` (`Button`, `Card`, `Badge`, `Alert`, `Table`, `TabBar`, `Avatar`, `Modal`, form fields). The app shell (grouped sidebar, company switcher, mobile drawer) is `(app)/layout.tsx`; sign-in, activation and password reset share the split-screen `components/auth-shell.tsx`. Change the brand colour by editing `--primary` and its hover/accent variants. Fonts are the system stack (Inter if installed), because the CSP allows no external font hosts. Motion respects `prefers-reduced-motion`.

## Pages

| Page                                                     | Needs                                    | Notes                                                                                                                                                                  |
| -------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard                                                | `attendance:read:all` or `:team`         | Today's counts, 14-day chart with a table alternative, pending approvals (never your own). Managers see their team only.                                               |
| Attendance                                               | same                                     | Day list with filters; detail shows verification result, distance, accuracy and mock-location flag, **not raw coordinates**.                                           |
| Approvals                                                | `attendance:review:*`                    | Corrections and location exceptions. Reject needs a comment (>= 3 chars).                                                                                              |
| Reports                                                  | `attendance:read:*`                      | Per-employee summary for up to 93 days; CSV export.                                                                                                                    |
| Employees                                                | `employee:read:*`                        | Search/filter/paginate; create, edit, grant access (invite), replace roles, deactivate.                                                                                |
| Departments, Shifts (+ assignments), Locations, Holidays | `*:manage`                               | Locations include a "test a point" check. Holidays are removed by deactivating.                                                                                        |
| Payroll                                                  | `payroll:manage`                         | Salary structures (new immutable version per change), monthly runs, run review with skipped employees and warnings, publish (blocked on negative net). See PAYROLL.md. |
| Letters                                                  | `letter:manage`                          | Templates with placeholders, issue to an employee, view, print, revoke. Plain text only.                                                                               |
| HR handbook                                              | `handbook:manage` (edit) / managers read | Sections with draft/published, ordering. Employees read it in the mobile app.                                                                                          |
| Team today                                               | `attendance:read:*`                      | Who is working, on break, on leave or not in yet; no locations.                                                                                                        |
| Settings                                                 | `tenant:update` (**owner only**)         | Name, time zone, work week, attendance policy.                                                                                                                         |

## Language

The sidebar has an English/Hindi switch (remembered in the browser). It covers navigation and the new pages; older pages stay English. The Hindi is a machine-assisted draft.

## Reports: how absences are produced

Nothing writes a row for a past day when nobody punches (the nightly job arrives in Phase 6). Reports therefore **materialise missing past days on demand** (idempotent upsert, never today, skips people with no shift, days before joining and after last working day). A request that would need more than 4,000 missing day-rows returns `422 RANGE_TOO_LARGE`; narrow the range. Because of this, the first report over a long range is slower than later ones.

## CSV export safety

Cells starting with `=`, `+`, `-`, `@`, tab or CR are prefixed with `'` so spreadsheets do not execute them as formulas. Output is UTF-8 with BOM and CRLF, max 93 days and 50,000 rows, and every export writes a `report.exported` audit entry (filters and row count only, no data).

## Deployment note: client IP and rate limits

The API's login rate limit is keyed on client IP. Behind the Next proxy the API sees the proxy's address unless forwarding headers are trusted. The API sets `trust proxy = 1` in production, which is correct for exactly one proxy hop in front of it (Next -> API). If you add a load balancer in front of Next, review this setting, otherwise all users share one rate-limit bucket (or an attacker can spoof their address). Raise `RATE_LIMIT_LOGIN_MAX` only deliberately.

## Tests

- `apps/web/tests`: API client (headers, single-flight refresh, retry-once on 401, session expiry, 5xx keeps session, download) and utils (company-zone time formatting, date math, `compact`).
- `apps/api/tests/web-contract.test.ts`: cookie flags, membership permissions, owner-only settings, strict settings bodies, employee refs in approval lists, tenant isolation.
- A manual Playwright smoke run (login, every page, approve, create department/employee, CSV, settings, role checks, sign-out, 390px width) was executed against the real API and MongoDB during Phase 5. The script is not committed as an automated suite (see limitations).

## Limitations

- **No automated browser tests in the repo.** The Playwright run was done by hand; there are no component tests. A regression in page rendering would not be caught by `pnpm test`.
- Current roles of an employee are **not shown** in the UI (the employee API does not return them); "Replace roles" asks you to pick the full set.
- "Grant access" sends an activation email only when `EMAIL_PROVIDER=smtp`; otherwise it is recorded, not sent, and the owner/HR must tell the person how to activate. The link opens `/activate`.
- Pickers load the first 100 employees/departments; very large companies need a search-as-you-type picker.
- Phase 6 added Leave, Audit log, Documents/Offboard dialog tabs and the activate/reset pages (see [PHASE6.md](PHASE6.md)). Document upload needs `STORAGE_ORIGIN` at build time and bucket CORS.
- No map for locations (coordinates are typed in); `MAP_PROVIDER` is unused.
- The dashboard counts "today" from stored rows; people who have not punched yet show as "not checked in", and absence is only recorded after the day ends.
- English only; not audited against WCAG beyond labelled controls, focus-visible styles, a table alternative to the chart and no horizontal overflow at 390px.
