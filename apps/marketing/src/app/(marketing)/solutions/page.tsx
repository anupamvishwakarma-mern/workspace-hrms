import { FinalCTA } from '@/components/home/FinalCTA';
import { SolutionCards } from '@/components/home/SolutionsGrid';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { PageHero } from '@/components/ui/page-hero';
import { Section, SectionHeader } from '@/components/ui/primitives';
import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'HRMS Solutions by Company Size and Industry',
  description:
    'See how the platform fits startups, small and medium businesses, enterprises and industries such as IT, manufacturing, retail, healthcare, education and remote teams.',
  path: '/solutions',
});

export default function SolutionsPage() {
  return (
    <>
      <Breadcrumbs items={[{ label: 'Solutions' }]} />
      <PageHero
        eyebrow="Solutions"
        title="HR software that fits your kind of business"
        text="We describe business problems and workflows, not invented case studies or statistics."
      />
      <Section>
        <SectionHeader align="left" title="By company size" />
        <div className="mt-8">
          <SolutionCards group="size" />
        </div>
      </Section>
      <Section tone="surface">
        <SectionHeader align="left" title="By industry" />
        <div className="mt-8">
          <SolutionCards group="industry" />
        </div>
      </Section>
      <FinalCTA />
    </>
  );
}
