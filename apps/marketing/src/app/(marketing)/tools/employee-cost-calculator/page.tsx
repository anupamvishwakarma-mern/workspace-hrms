import { EmployeeCostCalculator } from '@/components/pricing/Tools';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { PageHero } from '@/components/ui/page-hero';
import { Section } from '@/components/ui/primitives';
import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'Employee Cost Calculator',
  description: 'Estimate your HRMS subscription spend by employee count, plan and billing period.',
  path: '/tools/employee-cost-calculator',
});

export default function Page() {
  return (
    <>
      <Breadcrumbs items={[{ label: 'Tools' }, { label: 'Employee Cost Calculator' }]} />
      <PageHero
        eyebrow="Tool"
        title="Employee cost calculator"
        text="Estimate subscription spend from headcount and plan. Prices come from our pricing configuration."
      />
      <Section>
        <EmployeeCostCalculator />
      </Section>
    </>
  );
}
