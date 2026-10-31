import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { JsonLd } from '@/components/seo/JsonLd';
import { PageHero } from '@/components/ui/page-hero';
import { FaqList, Section } from '@/components/ui/primitives';
import { faqs } from '@/config/faqs';
import { buildMetadata, faqJsonLd } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'Frequently Asked Questions',
  description: 'Answers about features, pricing, database hosting, security and the mobile app.',
  path: '/faq',
});

export default function FaqPage() {
  const cats = [...new Set(faqs.map((f) => f.category))];
  return (
    <>
      <Breadcrumbs items={[{ label: 'FAQ' }]} />
      <JsonLd data={faqJsonLd(faqs)} />
      <PageHero eyebrow="FAQ" title="Frequently asked questions" />
      <Section>
        <div className="mx-auto max-w-3xl space-y-10">
          {cats.map((c) => (
            <div key={c}>
              <h2 className="mb-4 text-xl font-semibold">{c}</h2>
              <FaqList items={faqs.filter((f) => f.category === c)} />
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
