import { Check } from 'lucide-react';
import { DemoForm } from '@/components/forms/LeadForms';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { PageHero } from '@/components/ui/page-hero';
import { Section } from '@/components/ui/primitives';
import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'Book a Free Demo',
  description:
    'See the HRMS in action. Tell us about your team and preferred time and we will arrange a walkthrough.',
  path: '/book-demo',
});

export default function BookDemoPage() {
  return (
    <>
      <Breadcrumbs items={[{ label: 'Book a Demo' }]} />
      <PageHero
        eyebrow="Book a demo"
        title="See the platform with your own scenarios"
        text="Tell us about your team and your preferred time. We will confirm by email."
      />
      <Section>
        <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[1fr_1.6fr]">
          <div className="space-y-4 text-sm">
            <h2 className="text-lg font-semibold">What to expect</h2>
            {[
              'A walkthrough of the modules that matter to you',
              'Answers on database hosting options',
              'Honest guidance on what is available today and what is planned',
              'No obligation',
            ].map((t) => (
              <p key={t} className="flex gap-2.5 text-muted">
                <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
                {t}
              </p>
            ))}
          </div>
          <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8">
            <DemoForm />
          </div>
        </div>
      </Section>
    </>
  );
}
