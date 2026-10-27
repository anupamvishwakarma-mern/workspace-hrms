import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';
// Server-side only. The browser talks to this app; this app forwards /api/v1/* to the API so the HttpOnly
// refresh cookie (scoped to /api/v1/auth, SameSite=Strict) is same-origin and no CORS is needed.
const API_ORIGIN = (process.env.API_ORIGIN ?? 'http://localhost:4000').replace(/\/+$/, '');

// Browser uploads/downloads of employee documents (and punch proof photos, shown as images) go straight to
// object storage with presigned URLs, so that one origin (and nothing else) must be allowed in connect-src/img-src. Build-time, like API_ORIGIN.
const STORAGE_ORIGIN = (process.env.STORAGE_ORIGIN ?? '').trim().replace(/\/+$/, '');

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob:${STORAGE_ORIGIN ? ` ${STORAGE_ORIGIN}` : ''}`,
  "font-src 'self' data:",
  `connect-src 'self'${STORAGE_ORIGIN ? ` ${STORAGE_ORIGIN}` : ''}${isDev ? ' ws:' : ''}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${API_ORIGIN}/api/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          ...(isDev
            ? []
            : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
        ],
      },
    ];
  },
};
export default config;
