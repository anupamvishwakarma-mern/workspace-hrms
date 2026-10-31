import { Badge, Card, Section, SectionHeader } from '@/components/ui/primitives';
import { CtaLink } from '@/components/ui/cta-link';
import { plans, pricingConfig } from '@/config/pricing';
import { inr } from '@/lib/pricing';

export function PricingPreview() {
  return (
    <Section id="pricing-preview">
      <SectionHeader
        eyebrow="Pricing"
        title="Simple plans that scale with headcount"
        text="Per-employee pricing with a custom Enterprise tier."
      />
      {pricingConfig.illustrative ? (
        <p className="mx-auto mt-4 max-w-xl text-center text-sm text-muted">
          Prices shown are illustrative until confirmed.
        </p>
      ) : null}
      <ul className="mt-10 grid gap-6 lg:grid-cols-3">
        {plans.map((p) => (
          <li key={p.id}>
            <Card className={`h-full ${p.highlighted ? 'border-primary ring-1 ring-primary' : ''}`}>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">{p.name}</h3>
                {p.highlighted ? <Badge tone="primary">Most popular</Badge> : null}
              </div>
              <p className="mt-3 text-3xl font-bold">
                {p.pricePerEmployeeMonth == null ? 'Custom' : inr(p.pricePerEmployeeMonth)}
                {p.pricePerEmployeeMonth != null ? (
                  <span className="text-sm font-normal text-muted"> /employee/month</span>
                ) : null}
              </p>
              <p className="mt-2 text-sm text-muted">{p.tagline}</p>
            </Card>
          </li>
        ))}
      </ul>
      <div className="mt-8 flex justify-center">
        <CtaLink href="/pricing" size="lg" variant="outline">
          View All Plans
        </CtaLink>
      </div>
    </Section>
  );
}
