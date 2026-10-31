import { TrialForm } from '@/components/forms/TrialForm';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { PageHero } from '@/components/ui/page-hero';
import { Section } from '@/components/ui/primitives';
import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'Start Your Free Trial',
  description:
    'Create your company workspace in minutes. Choose a managed database or connect your own MongoDB.',
  path: '/free-trial',
});

export default function FreeTrialPage() {
  return (
    <>
      <Breadcrumbs items={[{ label: 'Free Trial' }]} />
      <PageHero
        eyebrow="Free trial"
        title="Create your company workspace"
        text="This registers a real company in the HRMS. You will set your password from an activation link, then sign in to the application."
      />
      <Section>
        <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-surface p-6 sm:p-8">
          <TrialForm />
        </div>
      </Section>
    </>
  );
}
