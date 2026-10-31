import { Check } from 'lucide-react';
import { ServiceEnquiryForm } from '@/components/forms/LeadForms';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { PageHero } from '@/components/ui/page-hero';
import { Card, Section, SectionHeader } from '@/components/ui/primitives';
import { services } from '@/config/services';
import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'Professional Services: Implementation, Migration and Integrations',
  description:
    'Implementation, data migration, workflow customization, custom reports, MongoDB configuration, integrations, training and support, offered separately from the subscription.',
  path: '/services',
});

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string }>;
}) {
  const { service } = await searchParams;
  return (
    <>
      <Breadcrumbs items={[{ label: 'Services' }]} />
      <PageHero
        eyebrow="Services"
        title="Expert help, separate from your subscription"
        text="Professional services are scoped and priced per engagement. The SaaS subscription never depends on them."
      />
      <Section>
        <ul className="grid gap-5 md:grid-cols-2">
          {services.map((s) => (
            <li key={s.id} id={s.id}>
              <Card className="h-full">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-link">
                    <s.icon aria-hidden className="h-5 w-5" />
                  </span>
                  <h2 className="text-lg font-semibold">{s.name}</h2>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-muted">{s.description}</p>
                <h3 className="mt-4 text-sm font-semibold">Benefits</h3>
                <ul className="mt-2 space-y-1.5 text-sm text-muted">
                  {s.benefits.map((b) => (
                    <li key={b} className="flex gap-2">
                      <Check aria-hidden className="mt-0.5 h-4 w-4 text-ok" />
                      {b}
                    </li>
                  ))}
                </ul>
                <h3 className="mt-4 text-sm font-semibold">Typical use cases</h3>
                <p className="mt-1 text-sm text-muted">{s.useCases.join(' · ')}</p>
                <a
                  href={`/services?service=${s.id}#enquiry`}
                  className="mt-5 inline-block text-sm font-semibold text-link"
                >
                  Enquire about this service →
                </a>
              </Card>
            </li>
          ))}
        </ul>
      </Section>
      <Section tone="surface">
        <SectionHeader
          eyebrow="Enquiry"
          title="Tell us what you need"
          text="Choose a service and share a few company details. We reply with next steps."
        />
        <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-border bg-background p-6 sm:p-8">
          <ServiceEnquiryForm key={service ?? 'none'} initialService={service} />
        </div>
      </Section>
    </>
  );
}
