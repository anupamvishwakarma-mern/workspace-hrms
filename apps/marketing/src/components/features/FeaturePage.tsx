import { Check, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { FinalCTA } from '@/components/home/FinalCTA';
import { PreviewFor } from '@/components/mockups/Previews';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { JsonLd } from '@/components/seo/JsonLd';
import { CtaLink } from '@/components/ui/cta-link';
import { PageHero } from '@/components/ui/page-hero';
import { Badge, Card, FaqList, Section, SectionHeader } from '@/components/ui/primitives';
import { featureBySlug, type Feature } from '@/config/features';
import { site } from '@/config/site';
import { faqJsonLd } from '@/lib/seo/metadata';

export function FeaturePage({ feature: f }: { feature: Feature }) {
  const related = f.related.map(featureBySlug).filter(Boolean) as Feature[];
  return (
    <>
      <Breadcrumbs items={[{ label: 'Features', href: '/features' }, { label: f.title }]} />
      <JsonLd data={faqJsonLd(f.faqs)} />
      <PageHero
        eyebrow={f.upcoming ? 'Coming soon' : f.keyword}
        title={f.heroTitle}
        text={f.heroText}
      >
        <CtaLink href={site.trialUrl} size="lg">
          Start Free Trial
        </CtaLink>
        <CtaLink href={site.demoUrl} size="lg" variant="outline">
          Book a Demo
        </CtaLink>
      </PageHero>

      <Section>
        <div className="grid items-start gap-10 lg:grid-cols-2">
          <div>
            <SectionHeader as="h2" align="left" title="Overview" />
            <p className="mt-4 text-lg leading-relaxed text-muted">{f.overview}</p>
            {f.upcoming ? (
              <div className="mt-6">
                <Badge tone="warn">Not available yet</Badge>
              </div>
            ) : null}
          </div>
          <PreviewFor kind={f.preview} />
        </div>
      </Section>

      {f.capabilities.length ? (
        <Section tone="surface">
          <SectionHeader
            eyebrow="Key capabilities"
            title={`What you can do with ${f.title.toLowerCase()}`}
          />
          <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {f.capabilities.map((c) => (
              <li key={c.title}>
                <Card className="h-full bg-background">
                  <Check aria-hidden className="h-5 w-5 text-ok" />
                  <h3 className="mt-3 font-semibold">{c.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{c.text}</p>
                </Card>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section>
        <SectionHeader
          eyebrow={f.upcoming ? 'Planned' : 'Business benefits'}
          title={f.upcoming ? 'What we plan to offer' : 'Why it matters for your business'}
        />
        <ul className="mt-10 grid gap-5 md:grid-cols-3">
          {f.benefits.map((b) => (
            <li key={b.title}>
              <Card className="h-full">
                <h3 className="font-semibold">{b.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{b.text}</p>
              </Card>
            </li>
          ))}
        </ul>
        {f.comingSoon?.length ? (
          <div className="mx-auto mt-10 max-w-3xl rounded-2xl border border-dashed border-border p-6">
            <p className="flex items-center gap-2 font-semibold">
              <Sparkles aria-hidden className="h-4 w-4 text-warn" />
              On the roadmap <Badge tone="warn">Coming soon</Badge>
            </p>
            <ul className="mt-3 grid gap-2 text-sm text-muted sm:grid-cols-2">
              {f.comingSoon.map((c) => (
                <li key={c}>• {c}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">
              These are plans, not current functionality, and timing is not committed.
            </p>
          </div>
        ) : null}
      </Section>

      <Section tone="surface">
        <SectionHeader eyebrow="Related features" title="Works together with" />
        <ul className="mt-8 grid gap-4 md:grid-cols-3">
          {related.map((r) => (
            <li key={r.slug}>
              <Card className="relative h-full hover:shadow-pop">
                <r.icon aria-hidden className="h-6 w-6 text-link" />
                <h3 className="mt-3 font-semibold">
                  <Link href={`/features/${r.slug}`} className="after:absolute after:inset-0">
                    {r.title}
                  </Link>
                </h3>
                <p className="mt-1 text-sm text-muted">{r.short}</p>
              </Card>
            </li>
          ))}
        </ul>
      </Section>

      <Section>
        <SectionHeader eyebrow="FAQ" title="Frequently asked questions" />
        <div className="mx-auto mt-10 max-w-3xl">
          <FaqList items={f.faqs} />
        </div>
      </Section>
      <FinalCTA />
    </>
  );
}
