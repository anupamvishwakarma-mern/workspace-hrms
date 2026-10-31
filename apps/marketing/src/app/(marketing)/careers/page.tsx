import { InfoPage } from '@/components/ui/info-page';
import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'Careers',
  description: 'Work with us.',
  path: '/careers',
});

export default function Page() {
  return (
    <InfoPage title="Careers" intro="Work with us.">
      <p>
        There are no open positions listed on this website right now. If you would like to be
        considered for future roles, contact us through the <a href="/contact">contact form</a>.
      </p>
    </InfoPage>
  );
}
