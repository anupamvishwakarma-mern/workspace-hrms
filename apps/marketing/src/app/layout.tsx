import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { Analytics } from '@/components/analytics/Analytics';
import { brand } from '@/config/brand';
import { seo } from '@/config/seo';
import { site } from '@/config/site';
import './globals.css';

/** Self-hosted Inter (SIL OFL, see fonts/Inter-LICENSE.txt): no third-party font request, no layout shift. */
const inter = localFont({
  src: './fonts/Inter-Variable.woff2',
  variable: '--font-inter',
  display: 'swap',
  weight: '100 900',
});

export const metadata: Metadata = {
  metadataBase: new URL(site.baseUrl),
  title: { default: seo.defaultTitle, template: seo.titleTemplate },
  description: seo.defaultDescription,
  applicationName: brand.name,
  keywords: [...seo.keywords],
  openGraph: {
    type: 'website',
    siteName: brand.name,
    locale: 'en_IN',
    title: seo.defaultTitle,
    description: seo.defaultDescription,
  },
  twitter: {
    card: 'summary_large_image',
    title: seo.defaultTitle,
    description: seo.defaultDescription,
  },
  robots: { index: true, follow: true },
};
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f7fa' },
    { media: '(prefers-color-scheme: dark)', color: '#0a1014' },
  ],
};

/** Applies the saved theme before first paint so there is no flash. Reads only a theme preference. */
const themeScript = `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||((!t||t==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light');}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* Without JavaScript the entrance animations never run, so keep content visible. */}
        <noscript>
          <style>{'[style*="opacity: 0"]{opacity:1!important;transform:none!important}'}</style>
        </noscript>
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
