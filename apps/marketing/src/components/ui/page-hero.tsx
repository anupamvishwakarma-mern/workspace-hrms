import type { ReactNode } from 'react';
import { Container } from './primitives';

export function PageHero({
  eyebrow,
  title,
  text,
  children,
}: {
  eyebrow?: string;
  title: string;
  text?: string;
  children?: ReactNode;
}) {
  return (
    <section className="border-b border-border bg-gradient-to-b from-primary-soft/40 to-transparent">
      <Container className="py-14 sm:py-20">
        <div className="max-w-3xl">
          {eyebrow ? (
            <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-link">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{title}</h1>
          {text ? <p className="mt-5 text-lg leading-relaxed text-muted">{text}</p> : null}
          {children ? <div className="mt-8 flex flex-wrap gap-3">{children}</div> : null}
        </div>
      </Container>
    </section>
  );
}
