'use client';
import {
  analyticsProvider,
  CONSENT_KEY,
  sanitizeProps,
  type AnalyticsEvent,
  type EventProps,
} from './events';

declare global {
  interface Window {
    plausible?: (name: string, o?: { props: EventProps }) => void;
    gtag?: (...a: unknown[]) => void;
  }
}

export function hasConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === 'granted';
  } catch {
    return false;
  }
}

/** Sends a conversion event only when a provider is configured AND the visitor consented. Never throws. */
export function track(name: AnalyticsEvent, props?: EventProps): void {
  try {
    if (analyticsProvider === 'none' || !hasConsent()) return;
    const clean = sanitizeProps(props);
    if (analyticsProvider === 'plausible') window.plausible?.(name, { props: clean });
    else window.gtag?.('event', name, clean);
  } catch {
    /* analytics must never break the page */
  }
}
