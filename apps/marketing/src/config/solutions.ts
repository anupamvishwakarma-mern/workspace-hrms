import {
  Briefcase,
  Building,
  Building2,
  Cpu,
  Factory,
  GraduationCap,
  HeartPulse,
  Home,
  Rocket,
  Store,
  type LucideIcon,
} from 'lucide-react';

/** Industry and company-size pages. Written around problems and workflows; no case studies or statistics are claimed. */
export interface Solution {
  slug: string;
  title: string;
  icon: LucideIcon;
  /** Shown on cards. */
  short: string;
  heroTitle: string;
  heroText: string;
  problems: string[];
  workflows: { title: string; text: string }[];
  /** Feature slugs that matter most here. */
  features: string[];
  /** Qualitative operational outcomes (never numbers). */
  outcomes: string[];
  note?: string;
  group: 'size' | 'industry';
}

export const solutions: Solution[] = [
  {
    slug: 'startups',
    title: 'Startups',
    icon: Rocket,
    group: 'size',
    short: 'Set up HR basics in days and grow without re-platforming.',
    heroTitle: 'HR software that keeps up with a startup',
    heroText:
      'Replace spreadsheets with attendance, leave and employee records that scale from your first hire.',
    problems: [
      'HR lives in spreadsheets and chat threads',
      'Nobody owns attendance or leave policy',
      'Fast hiring makes records inconsistent',
    ],
    workflows: [
      {
        title: 'Self-service signup',
        text: 'Create a company workspace and invite your team without a long implementation.',
      },
      {
        title: 'Simple leave and attendance',
        text: 'Start with default leave types and a default shift, then tune them.',
      },
      {
        title: 'Grow into more modules',
        text: 'Add shifts, approvals and payroll runs as the team grows.',
      },
    ],
    features: ['employee-management', 'attendance-management', 'leave-management'],
    outcomes: [
      'Less time spent on HR administration',
      'One place for employee information',
      'A clear policy from the first hire',
    ],
  },
  {
    slug: 'small-business',
    title: 'Small Business',
    icon: Building,
    group: 'size',
    short: 'Attendance, leave and payroll runs without a dedicated HR team.',
    heroTitle: 'HRMS for small business without the enterprise overhead',
    heroText:
      'A founder or office manager can run attendance, leave and monthly payroll from one tool.',
    problems: [
      'No dedicated HR person',
      'Manual attendance registers',
      'Month-end payroll takes days',
    ],
    workflows: [
      {
        title: 'Mobile attendance',
        text: 'Employees check in from their phone against your office location.',
      },
      {
        title: 'Approvals in one place',
        text: 'Leave and correction requests reach the right manager.',
      },
      {
        title: 'Attendance-driven payroll',
        text: 'Loss-of-pay is derived from attendance when you run payroll.',
      },
    ],
    features: ['attendance-management', 'leave-management', 'payroll-management'],
    outcomes: ['Fewer manual registers', 'Fewer month-end surprises', 'Self-service for employees'],
  },
  {
    slug: 'medium-business',
    title: 'Medium Business',
    icon: Building2,
    group: 'size',
    short: 'Roles, approvals and reporting across departments and locations.',
    heroTitle: 'Bring order to growing departments and locations',
    heroText:
      'Managers, HR and payroll each get the access they need, with reporting across the company.',
    problems: [
      'Managers use different processes',
      'HR cannot see company-wide attendance',
      'Policy exceptions are handled ad hoc',
    ],
    workflows: [
      {
        title: 'Role-based access',
        text: 'Give managers team scope and keep payroll data separate.',
      },
      { title: 'Multiple locations', text: 'Configure office geofences per location.' },
      { title: 'Reporting for leadership', text: 'Export attendance and leave data for review.' },
    ],
    features: ['roles-permissions', 'shift-management', 'reports-analytics'],
    outcomes: [
      'Consistent process across teams',
      'Better visibility for HR and leadership',
      'Clear separation of duties',
    ],
  },
  {
    slug: 'enterprise',
    title: 'Enterprise',
    icon: Building2,
    group: 'size',
    short: 'Customer-owned database, dedicated infrastructure options and custom integrations.',
    heroTitle: 'Enterprise HRMS with control over your data infrastructure',
    heroText:
      'Run on your own MongoDB, request dedicated infrastructure, and get implementation and integration support.',
    problems: [
      'Data residency and infrastructure policies',
      'Need integration with existing systems',
      'Complex rollout across entities',
    ],
    workflows: [
      {
        title: 'Customer-owned MongoDB',
        text: 'Your tenant runs on a MongoDB you operate, with verified connection and schema setup.',
      },
      { title: 'Dedicated infrastructure', text: 'Discuss dedicated deployments with our team.' },
      {
        title: 'Implementation support',
        text: 'Migration, workflow customization and training are available as services.',
      },
    ],
    features: ['roles-permissions', 'reports-analytics', 'document-management'],
    outcomes: [
      'Infrastructure decisions stay with you',
      'Rollout planned with experts',
      'Integrations scoped to your systems',
    ],
    note: 'Enterprise requirements vary. Talk to us about security reviews, networking and contractual terms.',
  },
  {
    slug: 'it-companies',
    title: 'IT and Software Companies',
    icon: Cpu,
    group: 'industry',
    short: 'Hybrid and distributed engineering teams with flexible attendance.',
    heroTitle: 'HR software for IT and software teams',
    heroText:
      'Support hybrid and remote work modes with clear attendance rules, leave and self-service.',
    problems: [
      'Mixed office, remote and client-site work',
      'Attendance rules differ by team',
      'Leave planning around releases',
    ],
    workflows: [
      { title: 'Work modes', text: 'Office, field and remote attendance modes per employee.' },
      { title: 'Team leave view', text: 'Managers see team leave before approving.' },
      {
        title: 'Employee self-service',
        text: 'Engineers handle requests, payslips and letters without HR tickets.',
      },
    ],
    features: ['attendance-management', 'leave-management', 'mobile-hrms'],
    outcomes: ['Less HR ticket volume', 'Clearer hybrid-work records', 'Faster approvals'],
  },
  {
    slug: 'manufacturing',
    title: 'Manufacturing',
    icon: Factory,
    group: 'industry',
    short: 'Shift-based attendance for plants, sites and floors.',
    heroTitle: 'Shift-based workforce management for manufacturing',
    heroText: 'Define shifts, weekly offs and grace rules and let attendance follow them.',
    problems: [
      'Multiple shifts across a day',
      'Late and early punches affect pay',
      'Contractors and permanent staff mixed',
    ],
    workflows: [
      { title: 'Shift definitions', text: 'Grace periods, breaks and weekly offs per shift.' },
      { title: 'Site geofencing', text: 'Verify punches against plant and site locations.' },
      { title: 'Attendance-based payroll', text: 'Loss-of-pay follows attendance.' },
    ],
    features: ['shift-management', 'attendance-management', 'payroll-management'],
    outcomes: [
      'Fewer shift disputes',
      'Cleaner attendance for payroll',
      'Supervisor visibility on the day',
    ],
    note: 'Biometric and device-based attendance are not available yet.',
  },
  {
    slug: 'retail',
    title: 'Retail',
    icon: Store,
    group: 'industry',
    short: 'Store-level attendance and leave across many locations.',
    heroTitle: 'Attendance and leave for multi-store retail',
    heroText: 'Give every store its own location and give managers a clear view of today.',
    problems: [
      'Many small locations',
      'High staff turnover',
      'Shift cover and last-minute changes',
    ],
    workflows: [
      {
        title: 'Per-store locations',
        text: 'Configure each store as a work location with its own geofence.',
      },
      { title: 'Manager team view', text: 'Store managers see who is in today.' },
      { title: 'Fast onboarding', text: 'Invite and import new joiners in bulk.' },
    ],
    features: ['attendance-management', 'shift-management', 'employee-management'],
    outcomes: [
      'Faster onboarding of store staff',
      'Daily visibility per store',
      'Less manual shift tracking',
    ],
  },
  {
    slug: 'healthcare',
    title: 'Healthcare',
    icon: HeartPulse,
    group: 'industry',
    short: 'Round-the-clock shifts and strict access to employee data.',
    heroTitle: 'Workforce management for healthcare teams',
    heroText: 'Handle round-the-clock shifts and keep access to employee data limited by role.',
    problems: ['Round-the-clock coverage', 'Sensitive employee records', 'Complex leave patterns'],
    workflows: [
      { title: 'Shift assignments', text: 'Effective-dated assignments for rotating teams.' },
      { title: 'Role-based access', text: 'Keep employee data limited by role and scope.' },
      { title: 'Leave and attendance together', text: 'Leave feeds attendance classification.' },
    ],
    features: ['shift-management', 'roles-permissions', 'leave-management'],
    outcomes: [
      'Clear coverage records',
      'Controlled access to employee data',
      'Less manual roster work',
    ],
    note: 'We do not make healthcare-specific regulatory compliance claims. Discuss your requirements with us.',
  },
  {
    slug: 'education',
    title: 'Education',
    icon: GraduationCap,
    group: 'industry',
    short: 'Staff attendance, leave and records for schools and institutes.',
    heroTitle: 'HR management for schools and institutions',
    heroText: 'Manage teaching and non-teaching staff records, leave and attendance in one place.',
    problems: [
      'Staff leave across terms',
      'Records spread over spreadsheets',
      'Different rules for staff groups',
    ],
    workflows: [
      {
        title: 'Staff records',
        text: 'Departments and designations for academic and admin staff.',
      },
      { title: 'Leave policy', text: 'Leave types and allowances for your policy.' },
      { title: 'Handbook', text: 'Publish staff policies in one place.' },
    ],
    features: ['employee-management', 'leave-management', 'document-management'],
    outcomes: ['Consistent staff records', 'Transparent leave', 'One place for policies'],
    note: 'This product manages staff HR. It is not a student information system.',
  },
  {
    slug: 'remote-teams',
    title: 'Distributed and Remote Teams',
    icon: Home,
    group: 'industry',
    short: 'Remote work modes, mobile access and self-service for people everywhere.',
    heroTitle: 'HR for distributed and remote teams',
    heroText:
      'Time zones, remote work and self-service built in, so HR does not depend on one office.',
    problems: [
      'Teams across time zones',
      'Remote attendance without a fixed office',
      'HR requests across chat and email',
    ],
    workflows: [
      {
        title: 'Remote attendance mode',
        text: 'Support employees without a fixed office location.',
      },
      { title: 'Company time zone', text: 'Attendance days follow the company time zone.' },
      { title: 'Mobile self-service', text: 'Requests, leave and payslips from the phone.' },
    ],
    features: ['mobile-hrms', 'attendance-management', 'employee-management'],
    outcomes: [
      'One system instead of scattered chats',
      'Fewer manual follow-ups',
      'Consistent policy across locations',
    ],
  },
];

export const solutionBySlug = (slug: string) => solutions.find((s) => s.slug === slug);
export const solutionIcons = { Briefcase };
