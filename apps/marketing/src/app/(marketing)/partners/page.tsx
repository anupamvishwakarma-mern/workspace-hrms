import { Handshake, Megaphone, Wrench } from 'lucide-react';
import { PartnerForm } from '@/components/forms/LeadForms';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { PageHero } from '@/components/ui/page-hero';
import { Card, Section, SectionHeader } from '@/components/ui/primitives';
import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'Partner Program',
  description: 'Referral, implementation and reseller partnerships. Apply to talk with us.',
  path: '/partners',
});

const kinds = [
  {
    icon: Megaphone,
    t: 'Referral program',
    d: 'Introduce companies that could benefit from the platform.',
  },
  { icon: Wrench, t: 'Implementation partners', d: 'Help customers configure, migrate and train.' },
  { icon: Handshake, t: 'Reseller enquiries', d: 'Offer the platform to your own customers.' },
];

export default function PartnersPage() {
  return (
    <>
      <Breadcrumbs items={[{ label: 'Partners' }]} />
      <PageHero
        eyebrow="Partners"
        title="Grow with us"
        text="We are shaping the partner program. Commercial terms, including any commission, will be shared once the model is finalised. Nothing is promised until then."
      />
      <Section>
        <ul className="grid gap-5 md:grid-cols-3">
          {kinds.map((k) => (
            <li key={k.t}>
              <Card className="h-full">
                <k.icon aria-hidden className="h-6 w-6 text-link" />
                <h2 className="mt-3 font-semibold">{k.t}</h2>
                <p className="mt-2 text-sm text-muted">{k.d}</p>
              </Card>
            </li>
          ))}
        </ul>
      </Section>
      <Section tone="surface">
        <SectionHeader eyebrow="Apply" title="Partner application" />
        <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-border bg-background p-6 sm:p-8">
          <PartnerForm />
        </div>
      </Section>
    </>
  );
}
