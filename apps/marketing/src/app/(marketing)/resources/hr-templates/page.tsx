import { Download } from 'lucide-react';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { PageHero } from '@/components/ui/page-hero';
import { Badge, Card, Section } from '@/components/ui/primitives';
import { templates } from '@/content/templates';
import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'Free HR Templates',
  description:
    'Attendance policy, leave policy, onboarding checklist, employee information sheet and shift schedule templates you can download and edit.',
  path: '/resources/hr-templates',
});

export default function TemplatesPage() {
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Resources', href: '/resources' }, { label: 'HR Templates' }]}
      />
      <PageHero
        eyebrow="Templates"
        title="Free HR templates"
        text="Starting points to adapt to your company. They are general templates, not legal advice: have your own adviser review policies before use."
      />
      <Section>
        <ul className="grid gap-5 md:grid-cols-2">
          {templates.map((t) => (
            <li key={t.file}>
              <Card className="flex h-full flex-col">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">{t.title}</h2>
                  <Badge>{t.format}</Badge>
                </div>
                <p className="mt-2 flex-1 text-sm text-muted">{t.description}</p>
                <a
                  href={t.file}
                  download
                  className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-link"
                >
                  <Download aria-hidden className="h-4 w-4" />
                  Download
                </a>
              </Card>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
