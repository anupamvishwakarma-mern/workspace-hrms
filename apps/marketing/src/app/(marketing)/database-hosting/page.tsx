import { Check } from 'lucide-react';
import { FinalCTA } from '@/components/home/FinalCTA';
import { customerPoints, managedPoints } from '@/components/home/DatabaseHosting';
import { CustomerDiagram, ManagedDiagram } from '@/components/features/HostingDiagrams';
import { HostingComparison } from '@/components/features/HostingComparison';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { JsonLd } from '@/components/seo/JsonLd';
import { ViewTracker } from '@/components/analytics/ViewTracker';
import { CtaLink } from '@/components/ui/cta-link';
import { PageHero } from '@/components/ui/page-hero';
import { Card, FaqList, Section, SectionHeader } from '@/components/ui/primitives';
import { site } from '@/config/site';
import { buildMetadata, faqJsonLd } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'Database Hosting: Managed MongoDB or Customer-Owned MongoDB',
  description:
    'Choose HRMS-managed MongoDB or connect your own. Compare ownership, backups, availability, pricing responsibility and support.',
  path: '/database-hosting',
});

const faqs = [
  {
    q: 'Can I use my existing MongoDB database?',
    a: 'You can connect your own MongoDB that meets the requirements. It must be a supported version running as a replica set, reachable from our servers, with a database user that can create collections and indexes and write data. The target database must be empty or already belong to your company, so we do not mix your HR data into a database used for something else.',
  },
  {
    q: 'Who manages database backups?',
    a: 'With the managed database, backups follow the backup policy of your plan. With a customer-owned database, backup and recovery are your responsibility unless you contract otherwise. Managed backups are not automatically included with a customer-owned database.',
  },
  {
    q: 'Can I switch hosting options later?',
    a: 'Switching is a controlled migration, not an instant configuration toggle. It involves planning, copying and verifying data, and a cut-over. Contact us before you decide so we can plan it with you.',
  },
  {
    q: 'Is my company data isolated?',
    a: 'Each company has its own database, and every request is scoped to the signed-in company membership. With a customer-owned database your data is also in separate infrastructure that you control.',
  },
  {
    q: 'Who pays for database infrastructure?',
    a: 'For the managed database, hosting is covered as described in your plan. For a customer-owned database you pay your own database provider directly. The application subscription is separate from your database infrastructure costs.',
  },
  {
    q: 'Can enterprise customers request dedicated infrastructure?',
    a: 'Yes. Dedicated infrastructure options can be discussed for Enterprise customers, with scope and pricing agreed per engagement.',
  },
];

const requirements = [
  'A supported MongoDB version (minimum version is published at signup), run as a replica set or sharded cluster',
  'A dedicated database user with rights to create collections and indexes and to read and write data in one database',
  'Network access that allows our servers to connect (IP allow-list or equivalent)',
  'A TLS-protected connection string (mongodb+srv:// or mongodb:// with TLS)',
  'An empty target database (or one that already belongs to your company)',
];

export default function DatabaseHostingPage() {
  return (
    <>
      <ViewTracker event="database_hosting_view" />
      <Breadcrumbs items={[{ label: 'Database Hosting' }]} />
      <JsonLd data={faqJsonLd(faqs)} />
      <PageHero
        eyebrow="Database hosting"
        title="Your Data. Your Infrastructure. Your Choice."
        text="Two ways to run the same application. Pick the database model that fits your organisation, and understand exactly who is responsible for what."
      >
        <CtaLink href={site.trialUrl} size="lg">
          Start Free Trial
        </CtaLink>
        <CtaLink href="/contact?type=Sales%20enquiry" size="lg" variant="outline">
          Talk to us about hosting
        </CtaLink>
      </PageHero>

      <Section>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <p className="text-xs font-semibold uppercase tracking-wider text-link">Option 1</p>
            <h2 className="mt-2 text-2xl font-bold">Managed MongoDB</h2>
            <p className="mt-2 text-muted">
              We provision a private database for each company on infrastructure we operate. You
              never touch a connection string.
            </p>
            <ul className="mt-5 space-y-2.5 text-sm">
              {[
                ...managedPoints,
                'Automatic tenant database provisioning at signup',
                'Infrastructure scaled by us as you grow',
                'Support covers the application and its database',
              ].map((p) => (
                <li key={p} className="flex gap-2.5">
                  <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
                  {p}
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <p className="text-xs font-semibold uppercase tracking-wider text-link">Option 2</p>
            <h2 className="mt-2 text-2xl font-bold">Customer-Owned MongoDB</h2>
            <p className="mt-2 text-muted">
              You supply your own MongoDB. We verify it, set up the schema and keep the connection
              healthy.
            </p>
            <ul className="mt-5 space-y-2.5 text-sm">
              {[
                ...customerPoints,
                'Secure connection validation before anything is saved',
                'Your connection string is encrypted and never shown again',
              ].map((p) => (
                <li key={p} className="flex gap-2.5">
                  <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
                  {p}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </Section>

      <Section tone="surface">
        <SectionHeader
          eyebrow="Architecture"
          title="How the two models work at a high level"
          text="Simplified diagrams. We do not publish internal network or infrastructure details."
        />
        <div className="mt-10 space-y-5">
          <ManagedDiagram />
          <CustomerDiagram />
        </div>
      </Section>

      <Section>
        <SectionHeader eyebrow="Comparison" title="Who is responsible for what" />
        <div className="mt-10">
          <HostingComparison />
        </div>
        <p className="mt-4 text-center text-sm text-muted">
          Backups, availability and recovery for a customer-owned database are yours unless
          contracted otherwise.
        </p>
      </Section>

      <Section tone="surface">
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <SectionHeader
              align="left"
              eyebrow="Customer-owned requirements"
              title="What your MongoDB needs"
            />
            <ul className="mt-6 space-y-3 text-sm">
              {requirements.map((r) => (
                <li key={r} className="flex gap-2.5">
                  <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
                  {r}
                </li>
              ))}
            </ul>
            <p className="mt-5 text-sm text-muted">
              Supported versions, networking requirements and permissions apply. The platform tests
              all of this before it saves your connection, and reports a clear reason if something
              fails.
            </p>
          </div>
          <div>
            <SectionHeader
              align="left"
              eyebrow="Security"
              title="How your connection details are protected"
            />
            <ul className="mt-6 space-y-3 text-sm text-muted">
              <li>
                Connection strings are sent over HTTPS to our server, encrypted at rest, and never
                returned or displayed again.
              </li>
              <li>
                Only the company owner can replace them, and replacing them requires re-entering a
                password.
              </li>
              <li>Credentials are redacted from logs and error messages.</li>
              <li>Hosts are validated to prevent connections to internal networks.</li>
              <li>
                We make no certification claims on this website. Ask us for current security
                documentation during a review.
              </li>
            </ul>
            <h3 className="mt-8 font-semibold">Switching later</h3>
            <p className="mt-2 text-sm text-muted">
              Moving between managed and customer-owned hosting is a controlled migration, not a
              setting you can flip. Plan it with us.
            </p>
          </div>
        </div>
      </Section>

      <Section>
        <SectionHeader eyebrow="FAQ" title="Database hosting questions" />
        <div className="mx-auto mt-10 max-w-3xl">
          <FaqList items={faqs} />
        </div>
      </Section>
      <FinalCTA
        title="Choose the hosting model that fits"
        text="Start with the managed database, or talk to us about running on your own MongoDB."
      />
    </>
  );
}
