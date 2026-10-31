import { DashboardTabs } from '@/components/home/DashboardTabs';
import { DatabaseHostingSection } from '@/components/home/DatabaseHosting';
import { FinalCTA } from '@/components/home/FinalCTA';
import { Hero } from '@/components/home/Hero';
import { MobileShowcase } from '@/components/home/MobileShowcase';
import { SolutionsSection } from '@/components/home/SolutionsGrid';
import { ValueProps } from '@/components/home/ValueProps';
import { WhyChoose } from '@/components/home/WhyChoose';
import { FeatureCards } from '@/components/features/FeatureCards';
import { PricingPreview } from '@/components/pricing/PricingPreview';
import { ResourcesPreview } from '@/components/resources/ResourcesPreview';
import { JsonLd } from '@/components/seo/JsonLd';
import { Section, SectionHeader } from '@/components/ui/primitives';
import { seo } from '@/config/seo';
import { buildMetadata, faqJsonLd, softwareJsonLd } from '@/lib/seo/metadata';
import { faqs } from '@/config/faqs';

export const metadata = buildMetadata({
  title: 'HRMS Software for Attendance, Leave, Shifts and Payroll',
  description: seo.defaultDescription,
  path: '/',
});

export default function HomePage() {
  return (
    <>
      <JsonLd data={[softwareJsonLd(), faqJsonLd(faqs.slice(0, 6))]} />
      <Hero />
      <ValueProps />
      <Section tone="surface" id="product">
        <SectionHeader
          eyebrow="Product"
          title="Ten modules, one platform"
          text="Everything your HR team, managers and employees need. Modules marked coming soon are on the roadmap and are not available yet."
        />
        <div className="mt-12">
          <FeatureCards />
        </div>
      </Section>
      <DashboardTabs />
      <MobileShowcase />
      <DatabaseHostingSection />
      <SolutionsSection />
      <WhyChoose />
      <PricingPreview />
      <ResourcesPreview />
      <FinalCTA />
    </>
  );
}
