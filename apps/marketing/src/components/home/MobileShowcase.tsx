import {
  Bell,
  CalendarDays,
  Clock,
  MapPin,
  ShieldCheck,
  UserRound,
  Fingerprint,
  History,
} from 'lucide-react';
import Link from 'next/link';
import { PhoneMockup } from '@/components/mockups/PhoneMockup';
import { Badge, Section, SectionHeader } from '@/components/ui/primitives';
import { Reveal } from '@/components/ui/reveal';

const list = [
  { icon: UserRound, t: 'Employee mobile access', s: 'Everyday HR for every employee.' },
  { icon: MapPin, t: 'GPS-based attendance', s: 'Location checked at the moment of the punch.' },
  {
    icon: ShieldCheck,
    t: 'Office geofencing',
    s: 'Punches verified against your configured locations.',
  },
  { icon: Clock, t: 'Check-in and check-out', s: 'With break tracking and daily summary.' },
  { icon: CalendarDays, t: 'Leave applications', s: 'Apply and see balances on the go.' },
  { icon: History, t: 'Attendance history', s: 'Plus correction requests.' },
  { icon: Bell, t: 'Notifications', s: 'Email today. Push notifications are coming soon.' },
  {
    icon: Fingerprint,
    t: 'Employee profile access',
    s: 'Payslips, letters, handbook and holidays.',
  },
];

export function MobileShowcase() {
  return (
    <Section id="mobile">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div>
          <SectionHeader
            align="left"
            eyebrow="Mobile HRMS"
            title="Attendance and HR in every employee’s pocket"
            text="A React Native app for Android and iOS, built for employees first."
          />
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {list.map((i) => (
              <li key={i.t} className="flex gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-link">
                  <i.icon aria-hidden className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold">{i.t}</p>
                  <p className="text-sm text-muted">{i.s}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-6 flex flex-wrap items-center gap-2 text-sm text-muted">
            <Badge tone="warn">Not available yet</Badge> Offline attendance and biometric check-in.
          </p>
          <Link href="/features/mobile-hrms" className="mt-6 inline-block font-semibold text-link">
            Explore the mobile app →
          </Link>
        </div>
        <Reveal className="flex justify-center gap-4">
          <PhoneMockup screen="today" />
          <PhoneMockup screen="history" className="mt-10 hidden sm:block" />
        </Reveal>
      </div>
    </Section>
  );
}
