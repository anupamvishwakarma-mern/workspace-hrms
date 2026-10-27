# Payroll, payslips, letters and the handbook

This is a **transparent calculator**, not a tax or statutory engine. HR defines the pay components; the system turns
salary structure + attendance + approved unpaid leave into a payslip and shows its working. It does **not** compute
income tax (TDS), provident fund rules, professional tax, ESI, bonuses, arrears, loans or full-and-final settlements,
and it does not pay anyone. Confirm outputs with your accountant before relying on them.

## Money

All amounts are integers in minor units (paise/cents). APIs that accept money from HR take decimal numbers with at
most two places (`amount: 40000`, `percent: 12.5`) and store `Math.round(x * 100)`. Responses return `*Minor`
integers. `PERCENT_OF_BASIC` stores percent x 100 (12.5% = `1250`). `BASIC` must be a FIXED earning.

## Salary structures

- One structure = a list of components (`code`, `name`, `kind` EARNING/DEDUCTION, `calc` FIXED/PERCENT_OF_BASIC,
  `prorate`). Earnings prorate by default; deductions never do.
- Versions are **immutable**. A change is a new version with an `effectiveFrom`. A version applies to a month when
  `effectiveFrom <= last day of that month`; the latest such version wins.
- HR cannot change their **own** structure (403). Employees can read only their own (`GET /payroll/my/structure`).
- Everything is permission `payroll:manage` (HR admin, owner, payroll admin) except the `my/*` reads.

## Monthly run

`POST /payroll/runs {month: "YYYY-MM"}` (only fully ended months, else `MONTH_NOT_COMPLETE`).

- `payableDays = daysInMonth - lopDays - notEmployedDays`.
- Loss of pay: ABSENT = 1, HALF_DAY = 0.5, approved **unpaid** leave = 1 (0.5 for a half day).
- Earnings with `prorate` are scaled by `payableDays / daysInMonth` (round half up, half-days exact). Deductions are
  the full amount.
- `INCOMPLETE` attendance days (a missing check-out) are treated as **paid** and flagged `INCOMPLETE_DAYS` so HR
  fixes them via corrections and regenerates.
- Employees with no structure are listed under `skipped` (`NO_SALARY_STRUCTURE`).
- Missing absence rows are materialised first so a person who never opened the app is still counted absent.
- A **draft** can be regenerated; **publishing** freezes it (409 afterwards). A run with a negative net pay carries
  `NEGATIVE_NET` and cannot be published (422).
- Payslips store the lines, days and warnings that produced them, so history does not change if the structure or
  attendance is edited later.

Employees see only **published** payslips (`GET /payroll/my/payslips`, `GET /payroll/payslips/:id` which checks
ownership). Publishing and generation are audited.

## Letters

HR keeps templates (plain text with `{{placeholders}}`) and issues them to an employee. Allowed placeholders:
`employee.name|firstName|code|designation|department|email|joiningDate|lastWorkingDate`, `company.name`,
`date.today`, and `salary.monthlyGross|annualGross` (the issuer needs `payroll:manage`).

- Unknown placeholder -> 422 `UNKNOWN_PLACEHOLDER`; a placeholder whose value is empty -> 422
  `MISSING_PLACEHOLDER_VALUE` (nothing is issued with blanks).
- An issued letter stores its **rendered text** and a reference `LTR-YYYY-NNNN`; editing the template later does not
  change it. Revoking keeps the text and records a reason. Employees read their own via `GET /letters/my`.
- Text is plain: no HTML is ever rendered on web or mobile. These are not digitally signed documents; "Print" on the
  web uses the browser's print dialog.

## HR handbook

Sections are plain text (`## heading`, `- bullet`, blank-line paragraphs), `DRAFT` or `PUBLISHED`. Employees and
managers only ever receive published sections, even if they send `includeDrafts=true`. Writing needs
`handbook:manage`.

## Team today

`GET /team/today` (needs `attendance:read:all` or `:team`): managers get their direct reports, HR/owners everyone
except themselves. Each person has a status (WORKING, ON_BREAK, CHECKED_OUT, ON_LEAVE, NOT_IN). It carries **no
locations and no photos**. The mobile Team tab is hidden for other roles; the API enforces the scope either way.

## Languages

English and Hindi. Mobile translates the new screens, tabs, Today, Requests, login and company chooser. The web
translates the navigation and the Team, Payroll, Letters and Handbook headings and main actions. Server messages,
company-written text (letters, handbook, holiday names) and some older screens stay in their original language.
**The Hindi text is a machine-assisted draft: have a native speaker review it before release.** To add a language,
add a dictionary with exactly the English keys (a test fails if keys or `{placeholders}` differ) and register it in
`LANGUAGES`.
