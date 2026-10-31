import { RoiCalculator } from '@/components/pricing/Tools';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { PageHero } from '@/components/ui/page-hero';
import { Section } from '@/components/ui/primitives';
import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'HRMS ROI Calculator',
  description:
    'Estimate the potential time and cost savings of moving HR administration to an HRMS. Estimates only, not guaranteed savings.',
  path: '/tools/hrms-roi-calculator',
});

export default function Page() {
  return (
    <>
      <Breadcrumbs items={[{ label: 'Tools' }, { label: 'ROI Calculator' }]} />
      <PageHero
        eyebrow="Tool"
        title="HRMS ROI calculator"
        text="Enter your numbers and assumptions. Results are estimates, not promises."
      />
      <Section>
        <RoiCalculator />
      </Section>
    </>
  );
}
