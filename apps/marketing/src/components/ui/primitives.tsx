import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const Container = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8', className)} {...p} />
);

export const Card = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'rounded-2xl border border-border bg-surface p-6 shadow-card transition-shadow',
      className,
    )}
    {...p}
  />
);

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'primary' | 'accent' | 'warn' | 'ok';
  className?: string;
}) {
  const tones = {
    neutral: 'bg-surface-2 text-muted',
    primary: 'bg-primary-soft text-link',
    accent: 'bg-accent-soft text-accent-text',
    warn: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
    ok: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Section({
  children,
  className,
  id,
  tone = 'plain',
  ...p
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  tone?: 'plain' | 'surface' | 'dark';
} & Omit<HTMLAttributes<HTMLElement>, 'id'>) {
  const bg =
    tone === 'surface'
      ? 'bg-surface'
      : tone === 'dark'
        ? 'bg-[#0f172a] text-white dark:bg-surface'
        : '';
  return (
    <section id={id} className={cn('py-16 sm:py-24', bg, className)} {...p}>
      <Container>{children}</Container>
    </section>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  text,
  align = 'center',
  as: H = 'h2',
}: {
  eyebrow?: string;
  title: string;
  text?: string;
  align?: 'center' | 'left';
  as?: 'h1' | 'h2';
}) {
  return (
    <div className={cn('max-w-3xl', align === 'center' ? 'mx-auto text-center' : '')}>
      {eyebrow ? (
        <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-link">{eyebrow}</p>
      ) : null}
      <H className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</H>
      {text ? <p className="mt-4 text-lg leading-relaxed text-muted">{text}</p> : null}
    </div>
  );
}

/** Accessible FAQ list using native disclosure elements (no JavaScript needed). */
export function FaqList({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="divide-y divide-border rounded-2xl border border-border bg-surface">
      {items.map((f) => (
        <details key={f.q} className="group p-5 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer items-center justify-between gap-4 text-left font-semibold">
            {f.q}
            <span
              aria-hidden
              className="text-xl leading-none text-muted transition group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <p className="mt-3 leading-relaxed text-muted">{f.a}</p>
        </details>
      ))}
    </div>
  );
}
