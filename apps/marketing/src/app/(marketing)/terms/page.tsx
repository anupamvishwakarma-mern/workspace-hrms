import { InfoPage } from '@/components/ui/info-page';
import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'Terms of Service',
  description: 'The terms that govern use of the service.',
  path: '/terms',
});

export default function Page() {
  return (
    <InfoPage title="Terms of Service" intro="The terms that govern use of the service." draft>
      <h2>Using the service</h2>
      <p>
        Terms covering accounts, acceptable use, subscriptions, billing, data ownership,
        availability, liability and termination will be inserted here after legal review.
      </p>
      <h2>Subscriptions and billing</h2>
      <p>Prices, billing periods, GST and payment terms are confirmed in your order form.</p>
    </InfoPage>
  );
}
