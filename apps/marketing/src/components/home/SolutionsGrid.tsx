import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Card, Section, SectionHeader } from '@/components/ui/primitives';
import { solutions } from '@/config/solutions';

export function SolutionCards({ group }: { group?: 'size' | 'industry' }) {
  const list = solutions.filter((s) => !group || s.group === group);
  return (
    <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {list.map((s) => (
        <li key={s.slug}>
          <Card className="group relative h-full hover:shadow-pop">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
              <s.icon aria-hidden className="h-5 w-5" />
            </span>
            <h3 className="mt-4 font-semibold">
              <Link href={`/solutions/${s.slug}`} className="after:absolute after:inset-0">
                {s.title}
              </Link>
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{s.short}</p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-link">
              Explore <ArrowRight aria-hidden className="h-4 w-4" />
            </span>
          </Card>
        </li>
      ))}
    </ul>
  );
}

export function SolutionsSection() {
  return (
    <Section id="solutions">
      <SectionHeader
        eyebrow="Solutions"
        title="Built for how different teams work"
        text="From a first hire to a multi-location workforce."
      />
      <div className="mt-12">
        <SolutionCards group="industry" />
      </div>
    </Section>
  );
}
