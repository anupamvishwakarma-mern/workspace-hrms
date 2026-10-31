import {
  BarChart3,
  CalendarClock,
  CalendarDays,
  FileText,
  Fingerprint,
  IdCard,
  KeyRound,
  Smartphone,
  Target,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

/**
 * Product capability copy. Everything under `capabilities` describes what the application does TODAY
 * (checked against docs/HRMS_AUDIT.md and the codebase). Anything not built yet lives in `comingSoon`
 * and is rendered with a "Coming soon" label. Keep it that way: do not move items across without checking.
 */
export type PreviewKind =
  | 'directory'
  | 'attendance'
  | 'leave'
  | 'shifts'
  | 'analytics'
  | 'payroll'
  | 'documents'
  | 'roles'
  | 'mobile'
  | 'performance';

export interface Feature {
  slug: string;
  title: string;
  icon: LucideIcon;
  short: string;
  keyword: string;
  heroTitle: string;
  heroText: string;
  overview: string;
  capabilities: { title: string; text: string }[];
  benefits: { title: string; text: string }[];
  comingSoon?: string[];
  preview: PreviewKind;
  faqs: { q: string; a: string }[];
  related: string[];
  /** True when the module is not available yet; the page is shown as an upcoming module. */
  upcoming?: boolean;
}

export const features: Feature[] = [
  {
    slug: 'employee-management',
    title: 'Employee Management',
    icon: Users,
    short: 'One accurate employee record, from invitation to exit.',
    keyword: 'Employee management system',
    heroTitle: 'An employee management system your whole HR team trusts',
    heroText:
      'Keep every employee record, reporting line and status change in one place, with a clear history of who changed what.',
    overview:
      'Employee records are the foundation of every other HR process. The platform keeps the core record together with the manager, department, designation and employment status, records each status change in the employee history, and handles invitations so people can activate their own accounts.',
    capabilities: [
      {
        title: 'Central employee directory',
        text: 'Search and filter employees with department, designation, manager and status.',
      },
      {
        title: 'Lifecycle and status changes',
        text: 'Move people through invited, active and ended states, including notice periods and reactivation, with history kept on the record.',
      },
      {
        title: 'Departments and designations',
        text: 'Model your structure with departments, designations and reporting managers.',
      },
      {
        title: 'Bulk import',
        text: 'Bring existing employees in from CSV or Excel files, with validation before anything is saved.',
      },
      {
        title: 'Seat-aware onboarding',
        text: 'Employee limits are enforced per company so growth is deliberate.',
      },
      { title: 'Audit trail', text: 'Sensitive changes are written to an append-only audit log.' },
    ],
    benefits: [
      {
        title: 'Less rework',
        text: 'One record feeds attendance, leave and payroll, so data is entered once.',
      },
      {
        title: 'Clear accountability',
        text: 'History and audit logs show who changed an employee record and when.',
      },
      {
        title: 'Faster onboarding',
        text: 'Imports and invitations replace spreadsheets and email threads.',
      },
    ],
    comingSoon: [
      'Extended personal and qualification fields',
      'Probation and confirmation workflow',
    ],
    preview: 'directory',
    faqs: [
      {
        q: 'Can I import our existing employee list?',
        a: 'Yes. The platform supports CSV and Excel imports with validation. Data migration help is available as a service.',
      },
      {
        q: 'Is there an employee limit?',
        a: 'Each company has a seat limit that matches its plan. It is enforced when employees are added.',
      },
      {
        q: 'Does it record employment history?',
        a: 'Status changes are recorded on the employee record, and important changes are written to the audit log.',
      },
    ],
    related: ['attendance-management', 'roles-permissions', 'document-management'],
  },
  {
    slug: 'attendance-management',
    title: 'Attendance Management',
    icon: Fingerprint,
    short: 'GPS check-in and check-out with geofencing and corrections.',
    keyword: 'Attendance management software',
    heroTitle: 'Attendance management software with real-time visibility',
    heroText:
      'Employees check in from the mobile app. Managers and HR see who is present, late or absent as the day unfolds.',
    overview:
      'Attendance is calculated on the server from an immutable log of check-in, check-out and break events, so the numbers do not depend on a phone clock. Office geofences, optional proof photos, correction requests and exception approvals cover real-world situations.',
    capabilities: [
      {
        title: 'GPS check-in and check-out',
        text: 'Punches are verified against the configured office locations and geofence radius.',
      },
      {
        title: 'Breaks and working time',
        text: 'Break events and daily working time are derived by the server.',
      },
      {
        title: 'Corrections and exceptions',
        text: 'Employees can request corrections or approval for an out-of-fence punch, and managers or HR review them.',
      },
      {
        title: 'Field and remote modes',
        text: 'Support teams that do not work from a fixed office.',
      },
      {
        title: 'Optional punch photo',
        text: 'Require a photo with a punch where your policy needs it. Needs object storage to be configured.',
      },
      {
        title: 'Daily sweep',
        text: 'A background job marks absent, on-leave, holiday and weekly-off days automatically.',
      },
    ],
    benefits: [
      {
        title: 'Trustworthy records',
        text: 'Events are append-only and the server decides the time and the result.',
      },
      {
        title: 'Less manual chasing',
        text: 'Missed punches become reviewable requests instead of email threads.',
      },
      {
        title: 'Live visibility',
        text: 'Team and company views show attendance status for today.',
      },
    ],
    comingSoon: ['Biometric device integration', 'Offline attendance'],
    preview: 'attendance',
    faqs: [
      {
        q: 'How does geofencing work?',
        a: 'Each office has a location and radius. A punch outside the radius is flagged and can be sent for approval as an exception.',
      },
      {
        q: 'Can employees fake the time?',
        a: 'The server assigns the punch time. The phone clock is only stored as a diagnostic value.',
      },
      {
        q: 'Does it work offline or with biometric devices?',
        a: 'Not today. Both are on the roadmap and are not part of the current product.',
      },
    ],
    related: ['mobile-hrms', 'shift-management', 'leave-management'],
  },
  {
    slug: 'leave-management',
    title: 'Leave Management',
    icon: CalendarDays,
    short: 'Leave types, requests, approvals and live balances.',
    keyword: 'Leave management software',
    heroTitle: 'Leave management software that removes the back-and-forth',
    heroText:
      'Employees apply in a few taps. Managers approve with full context. Balances update correctly every time.',
    overview:
      'Define leave types and annual allowances, let employees apply for full or half days, and route decisions to the right reviewer. Decisions are applied atomically so balances stay correct even when two people act at once.',
    capabilities: [
      { title: 'Configurable leave types', text: 'Set allowances per leave type for your policy.' },
      {
        title: 'Apply, approve, reject, cancel',
        text: 'Full and half-day requests with a clear status trail.',
      },
      { title: 'Accurate balances', text: 'Approvals update balances in a single transaction.' },
      { title: 'Holiday awareness', text: 'Company holidays are part of the calendar.' },
      {
        title: 'Optional monthly accrual',
        text: 'Credit leave automatically each month and carry unused days forward up to a limit, if you switch it on.',
      },
      {
        title: 'Email notifications',
        text: 'Requesters and reviewers are notified about decisions.',
      },
    ],
    benefits: [
      { title: 'Fewer disputes', text: 'Balances and history are visible to everyone involved.' },
      { title: 'Faster decisions', text: 'Reviewers see team context in one place.' },
      {
        title: 'Consistent policy',
        text: 'Rules live in the system, not in individual spreadsheets.',
      },
    ],
    comingSoon: ['Leave encashment', 'Multi-level leave approval chains'],
    preview: 'leave',
    faqs: [
      {
        q: 'Can employees apply from their phone?',
        a: 'Yes, the mobile app includes leave application and a view of balances.',
      },
      {
        q: 'Can we prevent self-approval?',
        a: 'Yes. Self-approval is off by default and is a company setting.',
      },
      {
        q: 'Does it support carry-forward?',
        a: 'Optional monthly accrual with carry-forward limits is available as a company setting.',
      },
    ],
    related: ['attendance-management', 'employee-management', 'reports-analytics'],
  },
  {
    slug: 'shift-management',
    title: 'Shift Management',
    icon: CalendarClock,
    short: 'Shifts, weekly offs and effective-dated assignments.',
    keyword: 'Shift scheduling and workforce management',
    heroTitle: 'Plan shifts once. Let attendance follow.',
    heroText:
      'Define shifts with grace and break rules, assign them with effective dates, and let attendance use them automatically.',
    overview:
      'Shifts carry start and end times, grace periods, break policy and weekly offs. Assignments are effective-dated so history stays accurate when someone changes shift. Attendance uses the assigned shift when it classifies a day.',
    capabilities: [
      {
        title: 'Shift definitions',
        text: 'Start and end time, grace period, break policy and weekly offs.',
      },
      {
        title: 'Effective-dated assignments',
        text: 'Change a shift going forward without rewriting the past.',
      },
      { title: 'Holiday calendar', text: 'Holidays feed attendance classification.' },
      {
        title: 'Late and early indicators',
        text: 'Attendance shows late arrivals and early departures against the shift.',
      },
    ],
    benefits: [
      {
        title: 'Correct classifications',
        text: 'Present, late and absent follow the assigned shift.',
      },
      { title: 'Accurate history', text: 'Shift changes never rewrite past days.' },
    ],
    comingSoon: ['Rotating and split shift patterns', 'Shift swap requests'],
    preview: 'shifts',
    faqs: [
      {
        q: 'Can I run more than one shift?',
        a: 'Yes. Create as many shifts as you need and assign them per employee.',
      },
      {
        q: 'Are rotating rosters supported?',
        a: 'Rotating and split patterns are not available yet. Fixed shifts with weekly offs are.',
      },
    ],
    related: ['attendance-management', 'leave-management', 'employee-management'],
  },
  {
    slug: 'payroll-management',
    title: 'Payroll Management',
    icon: Wallet,
    short: 'Salary structures, monthly runs and payslips.',
    keyword: 'Payroll and HR management software',
    heroTitle: 'A transparent payroll run, from attendance to payslip',
    heroText:
      'Versioned salary structures, monthly runs with loss-of-pay from attendance, and payslips employees can read in the app.',
    overview:
      'Payroll is built as a transparent calculator: every amount comes from a versioned salary structure and the month’s attendance. Runs move from draft to published, employees view published payslips, and money is stored exactly (in minor units).',
    capabilities: [
      {
        title: 'Versioned salary structures',
        text: 'Immutable versions keep every past payslip reproducible.',
      },
      {
        title: 'Monthly payroll runs',
        text: 'Run payroll with loss-of-pay derived from attendance.',
      },
      { title: 'Draft then publish', text: 'Review a run before it is published to employees.' },
      { title: 'Payslips on web and mobile', text: 'Employees view their own published payslips.' },
      {
        title: 'Separate publisher option',
        text: 'Require a different person to publish than the one who ran payroll.',
      },
    ],
    benefits: [
      { title: 'Fewer calculation errors', text: 'Attendance feeds payroll directly.' },
      {
        title: 'Explainable results',
        text: 'Each figure traces back to a structure and a month of attendance.',
      },
    ],
    comingSoon: [
      'Statutory rules engine (PF, ESI, professional tax, TDS)',
      'Bank file export',
      'Full and final settlement',
    ],
    preview: 'payroll',
    faqs: [
      {
        q: 'Does it calculate statutory deductions such as PF or TDS?',
        a: 'Not as a built-in rules engine today. Confirm your exact payroll requirements in a demo; custom configuration is available as a service.',
      },
      {
        q: 'Can employees see their payslips?',
        a: 'Yes, published payslips are visible to each employee on web and mobile.',
      },
    ],
    related: ['attendance-management', 'employee-management', 'reports-analytics'],
  },
  {
    slug: 'performance-management',
    title: 'Performance Management',
    icon: Target,
    short: 'Goals and reviews. Coming soon.',
    keyword: 'Performance management software',
    heroTitle: 'Performance management is on our roadmap',
    heroText:
      'Goal tracking and review cycles are planned. This page describes what we intend to build, not what you can use today.',
    overview:
      'Performance management is not part of the current product. If it is important to your evaluation, tell us during a demo so we can share the plan and timing as it firms up.',
    capabilities: [],
    benefits: [
      { title: 'Planned: goals', text: 'Set and track goals per employee and team.' },
      { title: 'Planned: review cycles', text: 'Run structured review cycles with manager input.' },
    ],
    comingSoon: ['Goal setting and tracking', 'Review cycles', 'Manager feedback', '1:1 notes'],
    preview: 'performance',
    upcoming: true,
    faqs: [
      {
        q: 'Can I use performance reviews today?',
        a: 'No. Performance management is planned and is not available yet.',
      },
      {
        q: 'How can I influence the roadmap?',
        a: 'Tell us what you need during a demo or through the contact form.',
      },
    ],
    related: ['employee-management', 'reports-analytics', 'roles-permissions'],
  },
  {
    slug: 'document-management',
    title: 'Document Management',
    icon: FileText,
    short: 'Secure employee documents, letters and the HR handbook.',
    keyword: 'HR document management',
    heroTitle: 'Keep employee documents private and easy to find',
    heroText:
      'Store employee documents in private object storage, issue letters from templates, and publish your HR handbook.',
    overview:
      'Documents are stored in a private bucket and shared through short-lived links. Letters use templates with placeholders and are issued with a reference number and an immutable rendered copy. The handbook holds your policies in draft and published states.',
    capabilities: [
      {
        title: 'Private document storage',
        text: 'Uploads and downloads use short-lived signed links with type and size limits.',
      },
      {
        title: 'Owner-based visibility',
        text: 'Documents are visible to their owner and authorised HR roles.',
      },
      { title: 'Letters from templates', text: 'Issue and revoke letters with reference numbers.' },
      { title: 'HR handbook', text: 'Publish policy sections for employees to read.' },
    ],
    benefits: [
      { title: 'Everything in one place', text: 'Documents sit next to the employee record.' },
      { title: 'Safer sharing', text: 'No public links to sensitive files.' },
    ],
    comingSoon: ['Document verification and expiry', 'PDF letters', 'Policy acknowledgements'],
    preview: 'documents',
    faqs: [
      {
        q: 'Where are files stored?',
        a: 'In S3-compatible object storage that you configure. Files are private and accessed through short-lived links.',
      },
      {
        q: 'Can letters be exported as PDF?',
        a: 'Not yet. Letters are issued as text with a reference number today.',
      },
    ],
    related: ['employee-management', 'roles-permissions', 'payroll-management'],
  },
  {
    slug: 'reports-analytics',
    title: 'Reports and Analytics',
    icon: BarChart3,
    short: 'Attendance and leave reports with CSV and Excel export.',
    keyword: 'HR reports and workforce analytics',
    heroTitle: 'Reports that answer the questions HR gets every week',
    heroText:
      'See attendance and leave patterns by team and period, then export the data for finance or leadership.',
    overview:
      'Reporting covers attendance and leave with filters for period, department and employee scope. Exports are available for the data you need to share. Reports respect the same role and team permissions as the rest of the application.',
    capabilities: [
      { title: 'Attendance reports', text: 'Daily and period views by employee and team.' },
      { title: 'Leave insights', text: 'Balances and usage over time.' },
      { title: 'Exports', text: 'Download report data as CSV and Excel files.' },
      { title: 'Permission-aware', text: 'People only see the data their role allows.' },
    ],
    benefits: [
      { title: 'Faster answers', text: 'No more building monthly summaries by hand.' },
      { title: 'Safer sharing', text: 'Exports follow the same access rules as the screens.' },
    ],
    comingSoon: [
      'PDF export',
      'Payroll and headcount report packs',
      'Custom dashboards (available as a service)',
    ],
    preview: 'analytics',
    faqs: [
      {
        q: 'Can we get custom reports?',
        a: 'Custom reports and dashboards are offered as a professional service.',
      },
      {
        q: 'Can we export to Excel?',
        a: 'Yes, report data can be exported as CSV and Excel files.',
      },
    ],
    related: ['attendance-management', 'leave-management', 'payroll-management'],
  },
  {
    slug: 'mobile-hrms',
    title: 'Mobile HRMS',
    icon: Smartphone,
    short: 'An employee app for punching in, leave and payslips.',
    keyword: 'GPS attendance system and mobile HRMS',
    heroTitle: 'A mobile HRMS your employees will actually open',
    heroText:
      'Check in, check out, request leave and read payslips from the app built with React Native and Expo.',
    overview:
      'The mobile app is employee-first: punch in and out with location verification, review attendance history, raise correction requests, apply for leave and read payslips, letters, the handbook and holidays. Managers can review team requests.',
    capabilities: [
      {
        title: 'GPS check-in and check-out',
        text: 'One location reading per tap, verified by the server against your office geofence.',
      },
      { title: 'Attendance history', text: 'Employees see their own days and statuses.' },
      {
        title: 'Correction and exception requests',
        text: 'Raise a request when a punch went wrong.',
      },
      { title: 'Leave applications', text: 'Apply for leave and see balances.' },
      {
        title: 'Payslips, letters and handbook',
        text: 'Read published payslips, letters and policies.',
      },
      {
        title: 'Secure sessions',
        text: 'Refresh tokens are kept in the device keychain or keystore.',
      },
    ],
    benefits: [
      { title: 'Higher adoption', text: 'People handle HR tasks where they already are.' },
      { title: 'Cleaner data', text: 'Location is checked at the moment of the punch.' },
    ],
    comingSoon: ['Push notifications', 'Offline attendance', 'Biometric authentication'],
    preview: 'mobile',
    faqs: [
      {
        q: 'Which platforms are supported?',
        a: 'The app is built with React Native and Expo for Android and iOS. Store availability depends on your deployment.',
      },
      {
        q: 'Does it support push notifications or offline mode?',
        a: 'Not yet. Notifications are by email today; push and offline are on the roadmap.',
      },
    ],
    related: ['attendance-management', 'leave-management', 'employee-management'],
  },
  {
    slug: 'roles-permissions',
    title: 'Role and Permission Management',
    icon: KeyRound,
    short: 'Role-based access with company-defined roles.',
    keyword: 'Role-based access control for HR',
    heroTitle: 'The right people see the right data',
    heroText:
      'Built-in roles for owners, HR, managers, payroll and employees, plus company-defined roles for everything in between.',
    overview:
      'Access follows the person’s role and scope: their own data, their team, or the whole company. Company owners can define custom roles from a list of grantable permissions, while sensitive permissions stay locked to built-in roles.',
    capabilities: [
      {
        title: 'Built-in roles',
        text: 'Company owner, HR admin, manager, payroll admin and employee.',
      },
      { title: 'Custom roles', text: 'Compose roles from grantable permissions.' },
      {
        title: 'Scope-aware access',
        text: 'Self, team and company-wide scopes for sensitive screens.',
      },
      {
        title: 'Tenant isolation',
        text: 'Every request is scoped to the signed-in company membership.',
      },
      { title: 'Audit log', text: 'Important actions are recorded in an append-only log.' },
    ],
    benefits: [
      { title: 'Least privilege', text: 'People only get what their job needs.' },
      { title: 'Safer growth', text: 'Roles scale as the company adds HR and managers.' },
    ],
    comingSoon: ['Multi-factor authentication', 'Delegation of approvals'],
    preview: 'roles',
    faqs: [
      {
        q: 'Can managers see salary data?',
        a: 'Salary and payroll permissions are separate from manager permissions.',
      },
      {
        q: 'Can we create our own roles?',
        a: 'Yes. Company owners can create custom roles from the permissions that can be granted.',
      },
    ],
    related: ['employee-management', 'document-management', 'reports-analytics'],
  },
];

export const featureBySlug = (slug: string) => features.find((f) => f.slug === slug);
export const selfServiceIcon = IdCard;
