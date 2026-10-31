import { z } from 'zod';

/** Schemas shared by the browser forms (instant feedback) and the API routes (the real validation). */
const text = (min: number, max: number, msg: string) =>
  z.string().trim().min(min, msg).max(max, `Keep it under ${max} characters`);
const optionalText = (max: number) =>
  z.string().trim().max(max, `Keep it under ${max} characters`).optional().or(z.literal(''));

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Enter your email')
  .email('Enter a valid email address')
  .max(254);
const phone = z
  .string()
  .trim()
  .max(30)
  .regex(/^[+()\d\s-]*$/, 'Use digits, spaces, + and - only')
  .optional()
  .or(z.literal(''));
const consent = z.literal(true, { message: 'Please accept to continue' });

/** Anti-spam fields every public form carries. `website` is a honeypot humans never see. */
export const antiSpam = {
  website: z.string().max(0).optional().or(z.literal('')),
  startedAt: z.number().int().optional(),
};

export const EMPLOYEE_BANDS = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'] as const;
export const INDUSTRIES = [
  'IT / Software',
  'Startup',
  'Consulting / Agency',
  'Manufacturing',
  'Retail',
  'Healthcare',
  'Education',
  'Remote / Distributed team',
  'Other',
] as const;
export const PLANS = ['Not sure yet', 'Starter', 'Growth', 'Enterprise'] as const;
export const HOSTING = ['Not sure yet', 'HRMS Managed Database', 'Customer-Owned MongoDB'] as const;
export const TIME_SLOTS = [
  'Morning (9am-12pm)',
  'Afternoon (12pm-4pm)',
  'Evening (4pm-7pm)',
] as const;

export const demoSchema = z.object({
  ...antiSpam,
  fullName: text(2, 120, 'Enter your full name'),
  email,
  phone,
  companyName: text(2, 160, 'Enter your company name'),
  jobTitle: text(2, 120, 'Enter your job title'),
  employees: z.enum(EMPLOYEE_BANDS, { message: 'Choose a company size' }),
  industry: z.enum(INDUSTRIES, { message: 'Choose an industry' }),
  preferredDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date')
    .refine((d) => d >= new Date().toISOString().slice(0, 10), 'Choose today or a later date'),
  preferredTime: z.enum(TIME_SLOTS, { message: 'Choose a time' }),
  plan: z.enum(PLANS),
  hosting: z.enum(HOSTING),
  notes: optionalText(2000),
  consent,
});
export type DemoInput = z.infer<typeof demoSchema>;

export const CONTACT_TYPES = [
  'General enquiry',
  'Sales enquiry',
  'Technical support',
  'Partnership enquiry',
] as const;
export const contactSchema = z.object({
  ...antiSpam,
  type: z.enum(CONTACT_TYPES, { message: 'Choose an enquiry type' }),
  fullName: text(2, 120, 'Enter your name'),
  email,
  phone,
  companyName: optionalText(160),
  message: text(10, 4000, 'Tell us a little more (at least 10 characters)'),
  consent,
});
export type ContactInput = z.infer<typeof contactSchema>;

export const serviceSchema = z.object({
  ...antiSpam,
  serviceId: z.string().min(1, 'Choose a service').max(60),
  fullName: text(2, 120, 'Enter your name'),
  email,
  phone,
  companyName: text(2, 160, 'Enter your company name'),
  employees: z.enum(EMPLOYEE_BANDS, { message: 'Choose a company size' }),
  details: text(10, 4000, 'Describe what you need (at least 10 characters)'),
  consent,
});
export type ServiceInput = z.infer<typeof serviceSchema>;

export const PARTNER_TYPES = ['Referral partner', 'Implementation partner', 'Reseller'] as const;
export const partnerSchema = z.object({
  ...antiSpam,
  partnerType: z.enum(PARTNER_TYPES, { message: 'Choose a partnership type' }),
  fullName: text(2, 120, 'Enter your name'),
  email,
  companyName: text(2, 160, 'Enter your company name'),
  website: z.string().max(0).optional().or(z.literal('')),
  companyUrl: z
    .string()
    .trim()
    .max(200)
    .url('Enter a valid URL, including https://')
    .optional()
    .or(z.literal('')),
  about: text(10, 4000, 'Tell us about your business (at least 10 characters)'),
  consent,
});
export type PartnerInput = z.infer<typeof partnerSchema>;

export const newsletterSchema = z.object({ ...antiSpam, email, consent });
export type NewsletterInput = z.infer<typeof newsletterSchema>;
export const unsubscribeSchema = z.object({ ...antiSpam, email });

export const trialSchema = z
  .object({
    ...antiSpam,
    firstName: text(1, 100, 'Enter your first name'),
    lastName: text(1, 100, 'Enter your last name'),
    email,
    phone,
    companyName: text(2, 200, 'Enter your company name'),
    employees: z
      .number({ message: 'Enter a number' })
      .int('Enter a whole number')
      .min(1, 'At least 1')
      .max(10000, 'At most 10,000'),
    country: text(2, 80, 'Enter your country'),
    timezone: text(1, 60, 'Choose a time zone'),
    hostingMode: z.enum(['MANAGED', 'CUSTOMER_OWNED']),
    connectionString: z.string().trim().max(2048).optional().or(z.literal('')),
    databaseName: z.string().trim().max(60).optional().or(z.literal('')),
    consent,
  })
  .refine((v) => v.hostingMode !== 'CUSTOMER_OWNED' || (v.connectionString ?? '').length >= 10, {
    path: ['connectionString'],
    message: 'Enter your MongoDB connection string, or choose the managed database',
  });
export type TrialInput = z.infer<typeof trialSchema>;
