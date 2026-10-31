'use client';
import Link from 'next/link';
import type { ComponentProps } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { track } from '@/lib/analytics/track';
import type { AnalyticsEvent, EventProps } from '@/lib/analytics/events';
import { cn } from '@/lib/utils';
import type { VariantProps } from 'class-variance-authority';

interface Props
  extends Omit<ComponentProps<typeof Link>, 'href'>, VariantProps<typeof buttonVariants> {
  href: string;
  event?: AnalyticsEvent;
  eventProps?: EventProps;
}

/** A link styled as a button that optionally records a conversion event (consent permitting). */
export function CtaLink({
  href,
  event,
  eventProps,
  variant,
  size,
  className,
  onClick,
  ...p
}: Props) {
  const external = /^https?:\/\//.test(href);
  const cls = cn(buttonVariants({ variant, size }), className);
  const click: React.MouseEventHandler<HTMLAnchorElement> = (e) => {
    if (event) track(event, eventProps);
    onClick?.(e);
  };
  return external ? (
    <a href={href} className={cls} onClick={click} rel="noopener">
      {p.children}
    </a>
  ) : (
    <Link href={href} className={cls} onClick={click} {...p} />
  );
}
