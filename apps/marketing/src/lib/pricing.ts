import { pricingConfig, type Plan } from '@/config/pricing';

export interface PricingRules {
  annualDiscountPercent: number;
  gstPercent: number;
}

export type Billing = 'monthly' | 'annual';

export interface Estimate {
  /** null for custom-quote plans. */
  perEmployeeMonthly: number | null;
  monthly: number | null;
  yearly: number | null;
  /** The amount billed per period for the chosen billing cycle, before GST. */
  billedPerPeriod: number | null;
  gst: number | null;
  totalWithGst: number | null;
  billing: Billing;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function clampEmployees(n: number): number {
  if (!Number.isFinite(n)) return pricingConfig.minEmployees;
  return Math.min(pricingConfig.maxEmployees, Math.max(pricingConfig.minEmployees, Math.floor(n)));
}

/** Pure: subscription estimate for a plan. Annual billing applies the configured discount to the monthly price. */
export function estimate(
  plan: Pick<Plan, 'pricePerEmployeeMonth'>,
  employees: number,
  billing: Billing,
  cfg: PricingRules = pricingConfig,
): Estimate {
  const n = clampEmployees(employees);
  if (plan.pricePerEmployeeMonth == null)
    return {
      perEmployeeMonthly: null,
      monthly: null,
      yearly: null,
      billedPerPeriod: null,
      gst: null,
      totalWithGst: null,
      billing,
    };
  const factor = billing === 'annual' ? 1 - cfg.annualDiscountPercent / 100 : 1;
  const perEmployeeMonthly = r2(plan.pricePerEmployeeMonth * factor);
  const monthly = r2(perEmployeeMonthly * n);
  const yearly = r2(monthly * 12);
  const billedPerPeriod = billing === 'annual' ? yearly : monthly;
  const gst = r2((billedPerPeriod * cfg.gstPercent) / 100);
  return {
    perEmployeeMonthly,
    monthly,
    yearly,
    billedPerPeriod,
    gst,
    totalWithGst: r2(billedPerPeriod + gst),
    billing,
  };
}

export const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: pricingConfig.currency,
    maximumFractionDigits: n % 1 ? 2 : 0,
  }).format(n);
