import { BookOpen, Calculator, FileDown, HelpCircle, Newspaper } from 'lucide-react';
import Link from 'next/link';
import { NewsletterForm } from '@/components/forms/NewsletterForm';
import { PostCard } from '@/components/resources/ResourcesPreview';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { PageHero } from '@/components/ui/page-hero';
import { Card, Section, SectionHeader } from '@/components/ui/primitives';
import { posts } from '@/content/blog/posts';
import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'HR Resources: Articles, Guides, Templates and Calculators',
  description:
    'Articles, guides, downloadable HR templates, calculators and answers to common questions.',
  path: '/resources',
});

const hubs = [
  {
    href: '/blog',
    icon: Newspaper,
    t: 'Blog',
    d: 'Articles on HR, attendance and infrastructure.',
  },
  { href: '/guides', icon: BookOpen, t: 'Guides', d: 'Step-by-step practical guides.' },
  {
    href: '/resources/hr-templates',
    icon: FileDown,
    t: 'HR templates',
    d: 'Policy and checklist templates.',
  },
  {
    href: '/tools/hrms-roi-calculator',
    icon: Calculator,
    t: 'ROI calculator',
    d: 'Estimate time and cost savings.',
  },
  {
    href: '/tools/employee-cost-calculator',
    icon: Calculator,
    t: 'Employee cost calculator',
    d: 'Estimate subscription spend.',
  },
  { href: '/faq', icon: HelpCircle, t: 'FAQ', d: 'Common questions answered.' },
];

export default function ResourcesPage() {
  return (
    <>
      <Breadcrumbs items={[{ label: 'Resources' }]} />
      <PageHero
        eyebrow="Resources"
        title="Learn, plan and download"
        text="Practical material for HR teams. Articles are sample editorial content until our editorial process is in place."
      />
      <Section>
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {hubs.map((h) => (
            <li key={h.href}>
              <Card className="relative h-full hover:shadow-pop">
                <h.icon aria-hidden className="h-6 w-6 text-link" />
                <h2 className="mt-3 font-semibold">
                  <Link href={h.href} className="after:absolute after:inset-0">
                    {h.t}
                  </Link>
                </h2>
                <p className="mt-1 text-sm text-muted">{h.d}</p>
              </Card>
            </li>
          ))}
        </ul>
      </Section>
      <Section tone="surface">
        <SectionHeader title="Latest articles" />
        <ul className="mt-8 grid gap-5 md:grid-cols-3">
          {posts.slice(0, 3).map((p) => (
            <li key={p.slug}>
              <PostCard post={p} />
            </li>
          ))}
        </ul>
      </Section>
      <Section>
        <div className="mx-auto max-w-xl">
          <NewsletterForm />
        </div>
      </Section>
    </>
  );
}
