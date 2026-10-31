import { BarChart3, Database, Fingerprint, Server, Smartphone, Users } from 'lucide-react';
import { Reveal } from '@/components/ui/reveal';
import { Card, Section, SectionHeader } from '@/components/ui/primitives';

const items = [
  {
    icon: Users,
    title: 'Complete HR management',
    text: 'Employee records, leave, shifts, payroll runs, documents and roles in one system.',
  },
  {
    icon: Fingerprint,
    title: 'Smart attendance tracking',
    text: 'GPS check-in verified against your office geofence, with corrections and exceptions.',
  },
  {
    icon: Smartphone,
    title: 'Mobile workforce management',
    text: 'An employee app for attendance, leave and payslips.',
  },
  {
    icon: Database,
    title: 'Flexible database hosting',
    text: 'Let us host your MongoDB, or run on your own.',
  },
  {
    icon: BarChart3,
    title: 'Centralized reporting',
    text: 'Attendance and leave reports with CSV and Excel export.',
  },
  {
    icon: Server,
    title: 'Scalable infrastructure',
    text: 'Per-company databases and background jobs built for multi-tenant growth.',
  },
];

export function ValueProps() {
  return (
    <Section>
      <SectionHeader
        eyebrow="Why teams choose us"
        title="Everything HR needs, without the sprawl"
        text="One platform that covers the daily work of HR, managers and employees."
      />
      <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((i, n) => (
          <li key={i.title}>
            <Reveal delay={n * 0.04}>
              <Card className="h-full hover:shadow-pop">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-link">
                  <i.icon aria-hidden className="h-5 w-5" />
                </span>
                <h3 className="mt-4 font-semibold">{i.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{i.text}</p>
              </Card>
            </Reveal>
          </li>
        ))}
      </ul>
    </Section>
  );
}
