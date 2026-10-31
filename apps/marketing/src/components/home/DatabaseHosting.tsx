import { Check } from 'lucide-react';
import { CtaLink } from '@/components/ui/cta-link';
import { Card, Section, SectionHeader } from '@/components/ui/primitives';

export const managedPoints = [
  'We host the MongoDB infrastructure',
  'We manage database provisioning',
  'We manage infrastructure monitoring',
  'Backups according to the selected plan',
  'No database administration for you',
  'Focus on your business and HR operations',
];
export const customerPoints = [
  'You provide your MongoDB connection details',
  'Your tenant uses your configured MongoDB database',
  'You pay your own database provider',
  'You control your database infrastructure',
  'Backup, availability and recovery responsibilities are clearly documented',
  'Supported MongoDB versions, networking and permissions apply',
];

function Option({
  title,
  tag,
  text,
  points,
}: {
  title: string;
  tag: string;
  text: string;
  points: string[];
}) {
  return (
    <Card className="h-full">
      <p className="text-xs font-semibold uppercase tracking-wider text-link">{tag}</p>
      <h3 className="mt-2 text-xl font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-muted">{text}</p>
      <ul className="mt-5 space-y-2.5">
        {points.map((p) => (
          <li key={p} className="flex gap-2.5 text-sm">
            <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
            {p}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function DatabaseHostingSection() {
  return (
    <Section tone="surface" id="database-hosting">
      <SectionHeader
        eyebrow="Our differentiator"
        title="Your Data. Your Infrastructure. Your Choice."
        text="Choose the database model that fits your organisation. Both run the same application."
      />
      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        <Option
          tag="Option 1"
          title="HRMS Managed Database"
          text="For businesses that want a simple, hassle-free experience."
          points={managedPoints}
        />
        <Option
          tag="Option 2"
          title="Customer-Owned Database"
          text="For businesses that want control over their database infrastructure."
          points={customerPoints}
        />
      </div>
      <p className="mx-auto mt-8 max-w-3xl text-center text-sm text-muted">
        Your application subscription and your database infrastructure are separate things: with a
        customer-owned database, backups and availability are your responsibility unless contracted
        otherwise.
      </p>
      <div className="mt-8 flex justify-center">
        <CtaLink href="/database-hosting" size="lg" variant="dark">
          Explore Database Hosting Options
        </CtaLink>
      </div>
    </Section>
  );
}
