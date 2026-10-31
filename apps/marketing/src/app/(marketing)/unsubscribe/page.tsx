import { UnsubscribeForm } from '@/components/forms/NewsletterForm';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { PageHero } from '@/components/ui/page-hero';
import { Section } from '@/components/ui/primitives';
import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'Unsubscribe',
  description: 'Remove your email address from our newsletter.',
  path: '/unsubscribe',
  noindex: true,
});

export default function UnsubscribePage() {
  return (
    <>
      <Breadcrumbs items={[{ label: 'Unsubscribe' }]} />
      <PageHero
        title="Unsubscribe from the newsletter"
        text="Enter the email address you subscribed with."
      />
      <Section>
        <UnsubscribeForm />
      </Section>
    </>
  );
}
