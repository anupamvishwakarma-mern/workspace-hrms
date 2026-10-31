import { InfoPage } from '@/components/ui/info-page';
import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'Cookie Policy',
  description: 'How this website uses cookies and similar storage.',
  path: '/cookie-policy',
});

export default function Page() {
  return (
    <InfoPage
      title="Cookie Policy"
      intro="How this website uses cookies and similar storage."
      draft
    >
      <h2>Essential storage</h2>
      <p>
        The site stores your theme preference and your analytics consent choice in your browser.
        These are not used to identify you.
      </p>
      <h2>Analytics</h2>
      <p>
        Analytics are off by default. If a provider is configured and you click Accept, anonymous
        usage events load. You can decline, and the site works the same either way.
      </p>
    </InfoPage>
  );
}
