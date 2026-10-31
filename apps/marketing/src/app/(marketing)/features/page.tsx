import { FeatureCards } from '@/components/features/FeatureCards';
import { FinalCTA } from '@/components/home/FinalCTA';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { PageHero } from '@/components/ui/page-hero';
import { Section } from '@/components/ui/primitives';
import { CtaLink } from '@/components/ui/cta-link';
import { site } from '@/config/site';
import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'HRMS Features: Attendance, Leave, Shifts, Payroll and More',
  description:
    'Explore employee management, GPS attendance, leave, shifts, payroll runs, documents, reports, mobile access and role-based permissions.',
  path: '/features',
});

export default function FeaturesPage() {
  return (
    <>
      <Breadcrumbs items={[{ label: 'Features' }]} />
      <PageHero
        eyebrow="Product"
        title="Everything you need to run HR in one platform"
        text="Each module is described honestly: what works today, and what is still on the roadmap."
      >
        <CtaLink href={site.trialUrl} size="lg">
          Start Free Trial
        </CtaLink>
        <CtaLink href="/features/mobile-hrms" size="lg" variant="outline">
          See the mobile app
        </CtaLink>
      </PageHero>
      <Section>
        <FeatureCards />
      </Section>
      <FinalCTA />
    </>
  );
}
