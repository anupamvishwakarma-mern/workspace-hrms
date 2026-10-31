import { FinalCTA } from '@/components/home/FinalCTA';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { PageHero } from '@/components/ui/page-hero';
import { Card, Section, SectionHeader } from '@/components/ui/primitives';
import { brand } from '@/config/brand';
import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'About Us',
  description: `Learn what ${brand.name} is building: a modern, honest HR platform with flexible database hosting.`,
  path: '/about',
});

/** EDITABLE PLACEHOLDER COPY. Replace with the real company story, founding details and values when supplied. Nothing here is a factual claim about history, size, customers or awards. */
const values = [
  { t: 'Honesty about the product', d: 'We describe what works today and label what is planned.' },
  {
    t: 'Respect for employee data',
    d: 'Least-privilege access, private storage and careful handling of credentials.',
  },
  { t: 'Simplicity first', d: 'Fewer clicks for employees, managers and HR.' },
  { t: 'Customer choice', d: 'Including the choice of where your data lives.' },
];

export default function AboutPage() {
  return (
    <>
      <Breadcrumbs items={[{ label: 'About Us' }]} />
      <PageHero eyebrow="About us" title={`About ${brand.name}`} text={brand.description} />
      <Section>
        <div className="mx-auto max-w-3xl space-y-12">
          <article>
            <h2 className="text-2xl font-bold">Our story</h2>
            <p className="mt-3 leading-relaxed text-muted">
              Placeholder: the company story will be added here. Until then, this page describes
              only what we are building and how we approach it, and makes no claims about our
              history, team size or customers.
            </p>
          </article>
          <article>
            <h2 className="text-2xl font-bold">Our mission</h2>
            <p className="mt-3 leading-relaxed text-muted">
              To make everyday HR work simpler for the people who do it and fairer for the people it
              serves.
            </p>
          </article>
          <article>
            <h2 className="text-2xl font-bold">Our vision</h2>
            <p className="mt-3 leading-relaxed text-muted">
              An HR platform that fits organisations of every size and respects their decisions
              about their own data.
            </p>
          </article>
          <article>
            <h2 className="text-2xl font-bold">What we are building</h2>
            <p className="mt-3 leading-relaxed text-muted">
              A multi-tenant HRMS with employee management, GPS attendance, leave, shifts, payroll
              runs, documents, reports, a mobile app, and a choice between a managed database and a
              customer-owned MongoDB.
            </p>
          </article>
          <article>
            <h2 className="text-2xl font-bold">Our approach to HR technology</h2>
            <p className="mt-3 leading-relaxed text-muted">
              The server is the source of truth: attendance times are assigned by the server,
              balances are updated transactionally, and access follows roles and company membership.
              We prefer fewer, well-built features over long checklists.
            </p>
          </article>
        </div>
      </Section>
      <Section tone="surface">
        <SectionHeader eyebrow="Core values" title="What we care about" />
        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {values.map((v) => (
            <li key={v.t}>
              <Card className="h-full bg-background">
                <h3 className="font-semibold">{v.t}</h3>
                <p className="mt-2 text-sm text-muted">{v.d}</p>
              </Card>
            </li>
          ))}
        </ul>
      </Section>
      <Section>
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl font-bold">Why businesses need a modern HRMS</h2>
          <p className="mt-3 leading-relaxed text-muted">
            Growing teams outgrow spreadsheets quickly. Attendance disputes, leave confusion,
            scattered documents and month-end manual work all cost time and trust. A modern HRMS
            gives everyone one source of truth and gives HR time back for work that needs judgement.
          </p>
        </div>
      </Section>
      <FinalCTA
        title="Let’s talk about your HR operations"
        text="Tell us about your team and we will show you how the platform fits."
      />
    </>
  );
}
