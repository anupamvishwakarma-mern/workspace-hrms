/**
 * Single source of truth for brand identity. The brand name is undecided: change it here (or via the
 * NEXT_PUBLIC_BRAND_* environment variables) and every page, metadata block and the footer follow.
 * Contact details are placeholders until real ones are supplied: nothing is shown when a value is empty.
 */
const env = (k: string, d: string) => (process.env[k] ?? '').trim() || d;

export const brand = {
  name: env('NEXT_PUBLIC_BRAND_NAME', 'YOUR_HRMS'),
  description: 'Modern Workforce & Human Resource Management Platform',
  tagline: 'Simplify HR. Empower People.',
  /** Letter(s) shown in the logo mark. */
  logoMark: env('NEXT_PUBLIC_BRAND_MARK', 'Y'),
  /** Optional path in /public (e.g. /logo.svg). When empty the text mark is used. */
  logoImage: env('NEXT_PUBLIC_BRAND_LOGO', ''),
  /**
   * Used only where CSS variables cannot reach (social image, browser theme colour). They mirror the
   * shared product theme in src/app/globals.css: change the theme there first, then keep these in sync.
   */
  colors: {
    primary: '#0F766E',
    secondary: '#0F172A',
    accent: '#2DD4BF',
    lightBackground: '#F5F7FA',
    lightSurface: '#FFFFFF',
    darkBackground: '#0A1014',
    darkSurface: '#111A20',
  },
  contact: {
    // Placeholders. Leave empty to hide. Never put real-looking fake values here.
    salesEmail: env('NEXT_PUBLIC_CONTACT_SALES_EMAIL', ''),
    supportEmail: env('NEXT_PUBLIC_CONTACT_SUPPORT_EMAIL', ''),
    phone: env('NEXT_PUBLIC_CONTACT_PHONE', ''),
    address: env('NEXT_PUBLIC_CONTACT_ADDRESS', ''),
  },
  social: {
    linkedin: env('NEXT_PUBLIC_SOCIAL_LINKEDIN', ''),
    x: env('NEXT_PUBLIC_SOCIAL_X', ''),
    youtube: env('NEXT_PUBLIC_SOCIAL_YOUTUBE', ''),
    github: env('NEXT_PUBLIC_SOCIAL_GITHUB', ''),
  },
} as const;

export type Brand = typeof brand;
