import { InfoPage } from '@/components/ui/info-page';
import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'Privacy Policy',
  description: 'How this website handles personal data.',
  path: '/privacy-policy',
});

export default function Page() {
  return (
    <InfoPage title="Privacy Policy" intro="How this website handles personal data." draft>
      <h2>What we collect</h2>
      <p>
        Information you submit through forms (name, email, phone, company details and your message),
        basic technical data needed to serve and secure the site, and, only if you accept analytics,
        anonymous usage events.
      </p>
      <h2>How we use it</h2>
      <p>
        To respond to your request, set up a trial, send the newsletter you opted into, and keep the
        site secure. We avoid collecting more than needed and never send personal details to
        analytics.
      </p>
      <h2>Database connection details</h2>
      <p>
        If you register with a customer-owned MongoDB, the connection string is sent over HTTPS,
        verified, encrypted and stored. It is not stored in your browser and is never displayed
        again.
      </p>
      <h2>Your choices</h2>
      <p>
        You can ask us to access, correct or delete your data and unsubscribe from the newsletter at
        any time using the unsubscribe page or the contact form.
      </p>
      <h2>Contact</h2>
      <p>
        Use the contact form to reach us. The registered company name, address and data-protection
        contact will be added here before launch.
      </p>
    </InfoPage>
  );
}
