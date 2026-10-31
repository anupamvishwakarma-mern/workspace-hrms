import { InfoPage } from '@/components/ui/info-page';
import { site } from '@/config/site';
import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'Documentation',
  description: 'Product and API documentation.',
  path: '/documentation',
});

export default function Page() {
  return (
    <InfoPage title="Documentation" intro="Product and API documentation.">
      {site.docsUrl ? (
        <p>
          Documentation is hosted at <a href={site.docsUrl}>{site.docsUrl}</a>.
        </p>
      ) : (
        <>
          <p>
            A public documentation site is not published yet. Customers receive setup guidance
            during onboarding.
          </p>
          <p>
            In the meantime, see our <a href="/guides">guides</a> and <a href="/faq">FAQ</a>, or{' '}
            <a href="/contact">contact us</a>.
          </p>
        </>
      )}
    </InfoPage>
  );
}
