'use client';
import Script from 'next/script';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { analyticsId, analyticsProvider, CONSENT_KEY } from '@/lib/analytics/events';
import { hasConsent } from '@/lib/analytics/track';

/** Loads the configured provider only after consent. Renders nothing when no provider is configured. */
export function Analytics() {
  const [consent, setConsent] = useState<'granted' | 'denied' | 'unset'>('unset');
  useEffect(() => {
    try {
      const v = localStorage.getItem(CONSENT_KEY);
      setConsent(v === 'granted' ? 'granted' : v === 'denied' ? 'denied' : 'unset');
    } catch {
      setConsent('unset');
    }
  }, []);

  if (analyticsProvider === 'none' || !analyticsId) return null;

  const choose = (v: 'granted' | 'denied') => {
    try {
      localStorage.setItem(CONSENT_KEY, v);
    } catch {
      /* ignore */
    }
    setConsent(v);
  };

  return (
    <>
      {consent === 'granted' && hasConsent() ? (
        analyticsProvider === 'plausible' ? (
          <Script
            defer
            data-domain={analyticsId}
            src="https://plausible.io/js/script.tagged-events.js"
            strategy="afterInteractive"
          />
        ) : (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(analyticsId)}`}
              strategy="afterInteractive"
            />
            <Script
              id="ga-init"
              strategy="afterInteractive"
            >{`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}window.gtag=gtag;gtag('js',new Date());gtag('config','${analyticsId.replace(/[^A-Za-z0-9-]/g, '')}',{anonymize_ip:true});`}</Script>
          </>
        )
      ) : null}
      {consent === 'unset' ? (
        <div
          role="dialog"
          aria-label="Cookie and analytics consent"
          className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-xl rounded-xl border border-border bg-surface p-4 shadow-pop"
        >
          <p className="text-sm text-muted">
            We use privacy-conscious analytics to understand which pages help visitors. It stays off
            unless you accept. No personal details are sent. See the{' '}
            <a className="text-link underline" href="/cookie-policy">
              Cookie Policy
            </a>
            .
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => choose('granted')}>
              Accept analytics
            </Button>
            <Button size="sm" variant="outline" onClick={() => choose('denied')}>
              Decline
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
