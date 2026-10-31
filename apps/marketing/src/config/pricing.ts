/**
 * Pricing configuration: the ONLY place plan names, prices and commercial rules live.
 * All amounts are ILLUSTRATIVE, not confirmed commercial prices. `illustrative` drives the banner and labels
 * shown on every pricing surface; set it to false once prices are final. Replace this file (or load it from a CMS
 * in lib/integrations) to change prices without touching components.
 *
 * Money is whole rupees per employee per month, monthly billing, before GST.
 */
export const pricingConfig = {
  currency: 'INR',
  currencySymbol: '₹',
  illustrative: true,
  /** Annual billing discount, in percent. Illustrative. */
  annualDiscountPercent: 20,
  /** GST percentage, shown as an estimate. Confirm with your tax advisor before publishing. */
  gstPercent: 18,
  minEmployees: 1,
  maxEmployees: 10000,
  /** Commercial rules for database hosting. Edit to match the final commercial model. */
  databaseHosting: {
    managedIncludedInPlan: true,
    managedNote:
      'HRMS-managed MongoDB hosting is included in the subscription for the plan limits you select. Very large storage needs may be priced separately.',
    customerOwnedNote:
      'With a customer-owned database you pay your own MongoDB provider directly. The application subscription is separate from your database infrastructure costs.',
  },
} as const;

export type PlanId = 'starter' | 'growth' | 'enterprise';
export type Availability = true | false | string;

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /** null = custom quotation. */
  pricePerEmployeeMonth: number | null;
  highlighted?: boolean;
  features: string[];
  cta: 'trial' | 'sales';
}

export const plans: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'Core HR and attendance for small teams.',
    pricePerEmployeeMonth: 49,
    cta: 'trial',
    features: [
      'Employee Management',
      'Attendance Management',
      'Leave Management',
      'Basic Reports',
      'Standard Support',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    tagline: 'More control for growing companies.',
    pricePerEmployeeMonth: 99,
    highlighted: true,
    cta: 'trial',
    features: [
      'Everything in Starter',
      'Shift Management',
      'Advanced Attendance',
      'Approval Workflows',
      'Advanced Reports',
      'Priority Support',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'Infrastructure choice and tailored rollout.',
    pricePerEmployeeMonth: null,
    cta: 'sales',
    features: [
      'Everything in Growth',
      'Customer-Owned Database option',
      'Dedicated Infrastructure options',
      'Custom Integrations',
      'Advanced Access Controls',
      'Enterprise Support',
      'Custom Implementation',
    ],
  },
];

export interface ComparisonRow {
  label: string;
  starter: Availability;
  growth: Availability;
  enterprise: Availability;
  note?: string;
}
export const comparison: ComparisonRow[] = [
  { label: 'Employee Management', starter: true, growth: true, enterprise: true },
  { label: 'Attendance Management', starter: true, growth: true, enterprise: true },
  { label: 'Leave Management', starter: true, growth: true, enterprise: true },
  { label: 'Basic Reports', starter: true, growth: true, enterprise: true },
  { label: 'Shift Management', starter: false, growth: true, enterprise: true },
  { label: 'Advanced Attendance', starter: false, growth: true, enterprise: true },
  { label: 'Approval Workflows', starter: false, growth: true, enterprise: true },
  { label: 'Advanced Reports', starter: false, growth: true, enterprise: true },
  { label: 'HRMS-managed database', starter: true, growth: true, enterprise: true },
  { label: 'Customer-owned database', starter: false, growth: false, enterprise: true },
  {
    label: 'Dedicated infrastructure options',
    starter: false,
    growth: false,
    enterprise: 'On request',
  },
  { label: 'Custom integrations', starter: false, growth: false, enterprise: 'Quoted' },
  { label: 'Advanced access controls', starter: false, growth: false, enterprise: true },
  { label: 'Support', starter: 'Standard', growth: 'Priority', enterprise: 'Enterprise' },
  {
    label: 'Performance management',
    starter: 'Coming soon',
    growth: 'Coming soon',
    enterprise: 'Coming soon',
  },
];

export interface AddOn {
  name: string;
  description: string;
  price: string;
}
export const addOns: AddOn[] = [
  {
    name: 'Implementation and onboarding',
    description: 'Guided setup, data migration and training.',
    price: 'Quoted per project',
  },
  {
    name: 'Custom integrations',
    description: 'Connect to your existing systems.',
    price: 'Quoted per project',
  },
  {
    name: 'Dedicated database setup',
    description: 'Dedicated database arrangements.',
    price: 'Quoted per project',
  },
  {
    name: 'Extended support',
    description: 'Support beyond your plan.',
    price: 'Quoted per agreement',
  },
];

export const billingTerms = [
  'Prices shown are illustrative until confirmed, and are per employee per month, excluding GST.',
  'GST is added at the applicable rate. The estimate uses the configured percentage and may differ on your invoice.',
  'Annual billing, minimum seats, invoicing and payment terms are agreed in your order form.',
  'Online card payment is not enabled on this website. Plan selection hands you over to a trial or to our sales team.',
];
