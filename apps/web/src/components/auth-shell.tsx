import { Clock, MapPin, ShieldCheck, Users } from 'lucide-react';
import type { ReactNode } from 'react';

const points = [
  {
    icon: Clock,
    title: 'Trustworthy attendance',
    text: 'Server-side timestamps, shifts and corrections with a full audit trail.',
  },
  {
    icon: MapPin,
    title: 'Location-aware check-ins',
    text: 'Geofences and exception reviews, with coordinates purged on a schedule.',
  },
  {
    icon: ShieldCheck,
    title: 'Built for multi-company',
    text: 'Strict tenant isolation and role-based access on every request.',
  },
];

/** Split-screen layout shared by sign-in, activation and password reset. */
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <section
        aria-hidden
        className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-teal-700 via-teal-800 to-slate-900 p-12 text-white lg:flex"
      >
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-teal-400/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-emerald-300/10 blur-3xl" />
        <div className="relative flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
            <Users className="h-5 w-5" />
          </span>
          <span className="text-xl font-bold tracking-tight">Workforce</span>
        </div>
        <div className="relative max-w-md space-y-8">
          <h2 className="text-4xl font-bold leading-tight tracking-tight">
            Attendance and HR, run with confidence.
          </h2>
          <ul className="space-y-5">
            {points.map((p) => (
              <li key={p.title} className="flex gap-3.5">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/20">
                  <p.icon className="h-4 w-4" />
                </span>
                <span>
                  <span className="block font-semibold">{p.title}</span>
                  <span className="block text-sm text-teal-50/80">{p.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-teal-50/60">© Workforce HRMS</p>
      </section>

      <section className="flex items-center justify-center bg-background p-6">
        <div className="animate-rise w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Users className="h-5 w-5" />
            </span>
            <span className="text-lg font-bold tracking-tight">Workforce</span>
          </div>
          <div className="rounded-2xl border border-border bg-card p-7 shadow-pop">
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
            <div className="mt-6 space-y-4">{children}</div>
          </div>
        </div>
      </section>
    </main>
  );
}
