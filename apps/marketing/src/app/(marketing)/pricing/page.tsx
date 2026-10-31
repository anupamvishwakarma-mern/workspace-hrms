import { FinalCTA } from '@/components/home/FinalCTA';
import { PricingView } from '@/components/pricing/PricingView';
import { JsonLd } from '@/components/seo/JsonLd';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { CtaLink } from '@/components/ui/cta-link';
import { PageHero } from '@/components/ui/page-hero';
import { Card, FaqList, Section, SectionHeader } from '@/components/ui/primitives';
import { faqs } from '@/config/faqs';
import { billingTerms, pricingConfig } from '@/config/pricing';
import { buildMetadata, faqJsonLd } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'HRMS Pricing: Plans for Every Team Size',
  description:
    'Starter, Growth and Enterprise plans priced per employee, with a live estimator, plan comparison, add-ons and clear rules for database hosting.',
  path: '/pricing',
});

const pricingFaqs = faqs
  .filter((f) => f.category === 'Pricing' || f.category === 'Database hosting')
  .slice(0, 8);

export default function PricingPage() {
  return (
    <>
      <Breadcrumbs items={[{ label: 'Pricing' }]} />
      <JsonLd data={faqJsonLd(pricingFaqs)} />
      <PageHero
        eyebrow="Pricing"
        title="Plans that scale with your headcount"
        text="Choose a plan, set your employee count and see an estimate that updates as you type."
      >
        <CtaLink href="/contact?type=Sales%20enquiry" variant="outline" size="lg">
          Contact Sales
        </CtaLink>
      </PageHero>
      <Section>
        <PricingView />
      </Section>
      <Section tone="surface">
        <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-2">
          <Card className="bg-background">
            <h2 className="text-lg font-semibold">Database hosting and pricing</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              <strong className="text-foreground">Managed:</strong>{' '}
              {pricingConfig.databaseHosting.managedNote}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              <strong className="text-foreground">Customer-owned:</strong>{' '}
              {pricingConfig.databaseHosting.customerOwnedNote}
            </p>
            <a
              href="/database-hosting"
              className="mt-4 inline-block text-sm font-semibold text-link"
            >
              Compare hosting options →
            </a>
          </Card>
          <Card className="bg-background">
            <h2 className="text-lg font-semibold">GST and billing terms</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted">
              {billingTerms.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </Card>
        </div>
      </Section>
      <Section>
        <SectionHeader eyebrow="FAQ" title="Pricing questions" />
        <div className="mx-auto mt-10 max-w-3xl">
          <FaqList items={pricingFaqs} />
        </div>
      </Section>
      <FinalCTA
        title="Not sure which plan fits?"
        text="Talk to us about your team size, hosting preference and rollout."
      />
    </>
  );
}
