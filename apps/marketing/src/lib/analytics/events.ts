/** Conversion events. Properties must never contain personal data. */
export const EVENTS = [
  'hero_trial_click',
  'hero_demo_click',
  'pricing_plan_select',
  'pricing_calculator_use',
  'database_hosting_view',
  'demo_form_submit',
  'trial_registration_start',
  'trial_registration_success',
  'newsletter_signup',
] as const;
export type AnalyticsEvent = (typeof EVENTS)[number];
export type EventProps = Record<string, string | number | boolean>;

const PROVIDER = process.env.NEXT_PUBLIC_ANALYTICS_PROVIDER ?? 'none';
export const analyticsProvider = PROVIDER === 'plausible' || PROVIDER === 'ga4' ? PROVIDER : 'none';
export const analyticsId = (process.env.NEXT_PUBLIC_ANALYTICS_ID ?? '').trim();
export const CONSENT_KEY = 'analytics-consent';

const ALLOWED_KEYS = new Set([
  'plan',
  'billing',
  'mode',
  'source',
  'employees_band',
  'location',
  'hosting',
  'tool',
]);
const PII = /@|\+?\d[\d\s-]{7,}/;

/** Pure: keeps only allow-listed keys with short, non-personal values. */
export function sanitizeProps(props: EventProps = {}): EventProps {
  const out: EventProps = {};
  for (const [k, v] of Object.entries(props)) {
    if (!ALLOWED_KEYS.has(k)) continue;
    if (typeof v === 'string' && (v.length > 40 || PII.test(v))) continue;
    out[k] = v;
  }
  return out;
}
