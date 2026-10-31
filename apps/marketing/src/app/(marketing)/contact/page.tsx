import { ContactForm } from '@/components/forms/LeadForms';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { PageHero } from '@/components/ui/page-hero';
import { Section } from '@/components/ui/primitives';
import { brand } from '@/config/brand';
import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'Contact Us',
  description: 'General, sales, technical support and partnership enquiries.',
  path: '/contact',
});

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;
  const c = brand.contact;
  return (
    <>
      <Breadcrumbs items={[{ label: 'Contact' }]} />
      <PageHero
        eyebrow="Contact"
        title="How can we help?"
        text="Choose the kind of enquiry and send us a message."
      />
      <Section>
        <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[2fr_1fr]">
          <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8">
            <ContactForm key={type ?? 'none'} initialType={type} />
          </div>
          <aside className="space-y-4 text-sm text-muted" aria-label="Other ways to reach us">
            <h2 className="text-lg font-semibold text-foreground">Other ways to reach us</h2>
            {c.salesEmail ? (
              <p>
                Sales:{' '}
                <a className="text-link underline" href={`mailto:${c.salesEmail}`}>
                  {c.salesEmail}
                </a>
              </p>
            ) : null}
            {c.supportEmail ? (
              <p>
                Support:{' '}
                <a className="text-link underline" href={`mailto:${c.supportEmail}`}>
                  {c.supportEmail}
                </a>
              </p>
            ) : null}
            {c.phone ? <p>Phone: {c.phone}</p> : null}
            {c.address ? <p>{c.address}</p> : null}
            {!c.salesEmail && !c.supportEmail && !c.phone && !c.address ? (
              <p>Contact details will be published here once configured. Please use the form.</p>
            ) : null}
          </aside>
        </div>
      </Section>
    </>
  );
}
