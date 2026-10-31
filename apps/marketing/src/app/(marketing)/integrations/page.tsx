import { InfoPage } from '@/components/ui/info-page';
import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'Integrations',
  description: 'Connecting the platform to your other systems.',
  path: '/integrations',
});

export default function Page() {
  return (
    <InfoPage title="Integrations" intro="Connecting the platform to your other systems.">
      <h2>Today</h2>
      <p>
        The platform exposes an API used by its own web and mobile apps. We do not list pre-built
        third-party integrations because none are published yet.
      </p>
      <h2>Custom integrations</h2>
      <p>
        We can scope integrations to your systems as a professional service. See{' '}
        <a href="/services#integrations">Custom Integrations</a> or{' '}
        <a href="/contact">contact us</a>.
      </p>
    </InfoPage>
  );
}
