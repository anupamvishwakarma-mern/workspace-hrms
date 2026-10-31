'use client';
import { useEffect } from 'react';
import { track } from '@/lib/analytics/track';
import type { AnalyticsEvent } from '@/lib/analytics/events';

/** Fires one conversion event when a page is viewed (consent permitting). */
export function ViewTracker({ event }: { event: AnalyticsEvent }) {
  useEffect(() => {
    track(event);
  }, [event]);
  return null;
}
