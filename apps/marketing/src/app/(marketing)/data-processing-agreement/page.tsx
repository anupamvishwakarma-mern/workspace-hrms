import { InfoPage } from '@/components/ui/info-page';
import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'Data Processing Agreement',
  description: 'How customer data is processed on your behalf.',
  path: '/data-processing-agreement',
});

export default function Page() {
  return (
    <InfoPage
      title="Data Processing Agreement"
      intro="How customer data is processed on your behalf."
      draft
    >
      <h2>Status</h2>
      <p>
        A data processing agreement is available on request for customers who need one. The document
        is being prepared and has not been legally reviewed. Contact us to discuss your
        requirements.
      </p>
    </InfoPage>
  );
}
