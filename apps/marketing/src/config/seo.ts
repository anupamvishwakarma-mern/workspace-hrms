import { brand } from './brand';

/** Default SEO strings. Page-specific metadata is built with lib/seo/metadata.ts. */
export const seo = {
  titleTemplate: `%s | ${brand.name}`,
  defaultTitle: `${brand.name}: HRMS Software for Attendance, Leave, Shifts and Payroll`,
  defaultDescription:
    'HR management software with employee management, GPS attendance, leave, shifts, payroll runs, reports and a mobile app. Choose a managed MongoDB or bring your own.',
  keywords: [
    'HRMS software',
    'HR management software',
    'employee management system',
    'attendance management software',
    'leave management software',
    'workforce management',
    'GPS attendance system',
    'employee self-service',
    'HRMS for small business',
    'enterprise HRMS',
  ],
  twitterHandle: '',
} as const;
