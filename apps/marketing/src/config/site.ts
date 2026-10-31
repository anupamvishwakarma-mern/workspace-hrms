/** Deployment-level URLs. All overridable by environment variables; none are secrets. */
const env = (k: string, d: string) => ((process.env[k] ?? '').trim() || d).replace(/\/+$/, '');

export const site = {
  /** Public origin of this marketing website (canonical URLs, sitemap, Open Graph). */
  baseUrl: env('NEXT_PUBLIC_SITE_URL', 'http://localhost:3001'),
  /** The existing HRMS web application (sign in, activation). */
  appUrl: env('NEXT_PUBLIC_APP_URL', 'http://localhost:3000'),
  loginUrl: () => `${site.appUrl}/login`,
  /** Where the trial / demo CTAs point. Internal pages by default; change to an external booking URL if you use one. */
  trialUrl: env('NEXT_PUBLIC_TRIAL_URL', '/free-trial'),
  demoUrl: env('NEXT_PUBLIC_DEMO_URL', '/book-demo'),
  /** Optional external docs / help-centre URLs. Empty shows an honest placeholder page. */
  docsUrl: env('NEXT_PUBLIC_DOCS_URL', ''),
  helpUrl: env('NEXT_PUBLIC_HELP_URL', ''),
} as const;
