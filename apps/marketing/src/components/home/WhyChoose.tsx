import { Check } from 'lucide-react';
import { Section, SectionHeader } from '@/components/ui/primitives';

const items = [
  'Complete workforce management',
  'Flexible database hosting',
  'Web and mobile access',
  'Configurable HR workflows',
  'Role-based access control',
  'Real-time attendance visibility',
  'Scalable architecture',
  'Centralized reporting',
];

export function WhyChoose() {
  return (
    <Section tone="surface">
      <SectionHeader eyebrow="Why choose us" title="A platform you can grow into" />
      <ul className="mx-auto mt-10 grid max-w-4xl gap-4 sm:grid-cols-2">
        {items.map((i) => (
          <li
            key={i}
            className="flex items-center gap-3 rounded-xl border border-border bg-background p-4 text-sm font-medium"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-soft text-accent-text">
              <Check aria-hidden className="h-3.5 w-3.5" />
            </span>
            {i}
          </li>
        ))}
      </ul>
    </Section>
  );
}
