import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { PageHero } from '@/components/ui/page-hero';
import { Section } from '@/components/ui/primitives';
import { guides } from '@/content/guides';
import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'HRMS Guides',
  description:
    'Step-by-step guides for setting up attendance, leave policy, imports, a customer-owned MongoDB, the mobile app and payroll.',
  path: '/guides',
});

export default function GuidesPage() {
  return (
    <>
      <Breadcrumbs items={[{ label: 'Guides' }]} />
      <PageHero
        eyebrow="Guides"
        title="Practical, step-by-step guides"
        text="Sample guidance written to be generally useful. Expand a guide to see its steps."
      />
      <Section>
        <ul className="mx-auto max-w-3xl space-y-4">
          {guides.map((g) => (
            <li key={g.slug} id={g.slug}>
              <details className="group rounded-2xl border border-border bg-surface p-5">
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  <h2 className="inline text-lg font-semibold">{g.title}</h2>
                  <p className="mt-1 text-sm text-muted">{g.summary}</p>
                </summary>
                <ol className="mt-4 space-y-3">
                  {g.steps.map((s, i) => (
                    <li key={s.title} className="flex gap-3">
                      <span
                        aria-hidden
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-link"
                      >
                        {i + 1}
                      </span>
                      <div>
                        <p className="font-medium">{s.title}</p>
                        <p className="text-sm text-muted">{s.text}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </details>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
