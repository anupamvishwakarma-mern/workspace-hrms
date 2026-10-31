import { DashboardMockup } from '@/components/mockups/DashboardMockup';
import { CtaLink } from '@/components/ui/cta-link';
import { Container } from '@/components/ui/primitives';
import { Reveal } from '@/components/ui/reveal';
import { brand } from '@/config/brand';
import { site } from '@/config/site';

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] bg-gradient-to-b from-primary-soft/60 to-transparent"
      />
      <Container className="relative pb-16 pt-14 sm:pt-20 lg:pb-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mx-auto mb-5 inline-flex rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted">
            {brand.description}
          </p>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Manage Your Entire Workforce. <span className="text-link">All in One Place.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted">
            From employee management and attendance to leave, shifts, payroll, and workforce
            analytics — simplify your HR operations with one intelligent HRMS platform.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <CtaLink href={site.trialUrl} size="lg" event="hero_trial_click">
              Start Free Trial
            </CtaLink>
            <CtaLink href={site.demoUrl} size="lg" variant="outline" event="hero_demo_click">
              Book a Free Demo
            </CtaLink>
          </div>
          <p className="mt-4 text-xs text-muted">
            Web and mobile · Managed or customer-owned MongoDB
          </p>
        </div>
        <Reveal className="mx-auto mt-14 max-w-5xl">
          <DashboardMockup />
        </Reveal>
      </Container>
    </section>
  );
}
