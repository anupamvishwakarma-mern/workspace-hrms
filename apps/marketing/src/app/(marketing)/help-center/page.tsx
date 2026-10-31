import { InfoPage } from '@/components/ui/info-page';
import { site } from '@/config/site';
import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'Help Center',
  description: 'Get help using the platform.',
  path: '/help-center',
});

export default function Page() {
  return (
    <InfoPage title="Help Center" intro="Get help using the platform.">
      {site.helpUrl ? (
        <p>
          Our help center is at <a href={site.helpUrl}>{site.helpUrl}</a>.
        </p>
      ) : (
        <>
          <p>
            A dedicated help center is not published yet. Start with the{' '}
            <a href="/guides">guides</a> and <a href="/faq">FAQ</a>, or send a technical support
            enquiry through the <a href="/contact?type=Technical%20support">contact form</a>.
          </p>
        </>
      )}
    </InfoPage>
  );
}
