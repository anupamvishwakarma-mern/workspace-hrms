import Link from 'next/link';
import { FinalCTA } from '@/components/home/FinalCTA';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { CtaLink } from '@/components/ui/cta-link';
import { PageHero } from '@/components/ui/page-hero';
import { Card, Section, SectionHeader } from '@/components/ui/primitives';
import { featureBySlug } from '@/config/features';
import type { Solution } from '@/config/solutions';
import { site } from '@/config/site';

export function SolutionPage({ s }: { s: Solution }) {
  const feats = s.features.map(featureBySlug).filter((x): x is NonNullable<typeof x> => !!x);
  return (
    <>
      <Breadcrumbs items={[{ label: 'Solutions', href: '/solutions' }, { label: s.title }]} />
      <PageHero eyebrow={s.title} title={s.heroTitle} text={s.heroText}>
        <CtaLink href={site.trialUrl} size="lg">
          Start Free Trial
        </CtaLink>
        <CtaLink href={site.demoUrl} size="lg" variant="outline">
          Book a Demo
        </CtaLink>
      </PageHero>
      <Section>
        <SectionHeader align="left" eyebrow="The challenge" title="Problems we help with" />
        <ul className="mt-8 grid gap-4 md:grid-cols-3">
          {s.problems.map((p) => (
            <li key={p}>
              <Card className="h-full text-sm leading-relaxed">{p}</Card>
            </li>
          ))}
        </ul>
      </Section>
      <Section tone="surface">
        <SectionHeader eyebrow="Workflows" title="How the platform fits" />
        <ul className="mt-10 grid gap-5 md:grid-cols-3">
          {s.workflows.map((w) => (
            <li key={w.title}>
              <Card className="h-full bg-background">
                <h3 className="font-semibold">{w.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{w.text}</p>
              </Card>
            </li>
          ))}
        </ul>
      </Section>
      <Section>
        <SectionHeader
          eyebrow="Operational benefits"
          title="What teams typically look to improve"
          text="These are the outcomes to measure in your own pilot. We do not publish invented statistics."
        />
        <ul className="mx-auto mt-8 grid max-w-3xl gap-3">
          {s.outcomes.map((o) => (
            <li
              key={o}
              className="rounded-xl border border-border bg-surface p-4 text-sm font-medium"
            >
              {o}
            </li>
          ))}
        </ul>
        {s.note ? (
          <p className="mx-auto mt-6 max-w-3xl text-center text-sm text-muted">{s.note}</p>
        ) : null}
      </Section>
      <Section tone="surface">
        <SectionHeader eyebrow="Relevant modules" title="Features most used in this scenario" />
        <ul className="mt-8 grid gap-4 md:grid-cols-3">
          {feats.map((f) => (
            <li key={f.slug}>
              <Card className="relative h-full bg-background hover:shadow-pop">
                <f.icon aria-hidden className="h-6 w-6 text-link" />
                <h3 className="mt-3 font-semibold">
                  <Link href={`/features/${f.slug}`} className="after:absolute after:inset-0">
                    {f.title}
                  </Link>
                </h3>
                <p className="mt-1 text-sm text-muted">{f.short}</p>
              </Card>
            </li>
          ))}
        </ul>
      </Section>
      <FinalCTA />
    </>
  );
}
