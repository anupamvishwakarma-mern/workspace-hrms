import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';
const provider = process.env.NEXT_PUBLIC_ANALYTICS_PROVIDER ?? 'none';

// Analytics hosts are only allowed when that provider is configured (and it only loads after visitor consent).
const analyticsScript =
  provider === 'plausible'
    ? ' https://plausible.io'
    : provider === 'ga4'
      ? ' https://www.googletagmanager.com'
      : '';
const analyticsConnect =
  provider === 'plausible'
    ? ' https://plausible.io'
    : provider === 'ga4'
      ? ' https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com'
      : '';

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}${analyticsScript}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${analyticsConnect}${isDev ? ' ws:' : ''}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: { formats: ['image/avif', 'image/webp'] },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          ...(isDev
            ? []
            : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
        ],
      },
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ];
  },
};
export default config;
