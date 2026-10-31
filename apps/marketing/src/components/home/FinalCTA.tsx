import { CtaLink } from '@/components/ui/cta-link';
import { Container } from '@/components/ui/primitives';
import { site } from '@/config/site';

export function FinalCTA({
  title = 'Ready to Simplify Your HR Operations?',
  text = 'Discover a smarter way to manage your people, attendance, and workforce operations.',
}: {
  title?: string;
  text?: string;
}) {
  return (
    <section className="py-16 sm:py-24">
      <Container>
        <div className="rounded-3xl bg-[#0f172a] px-6 py-14 text-center text-white sm:px-12 dark:border dark:border-border dark:bg-surface">
          <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
            {title}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-slate-300">{text}</p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <CtaLink href={site.trialUrl} size="lg">
              Start Free Trial
            </CtaLink>
            <CtaLink
              href={site.demoUrl}
              size="lg"
              variant="outline"
              className="border-slate-600 bg-transparent text-white hover:bg-white/10"
            >
              Book a Demo
            </CtaLink>
          </div>
        </div>
      </Container>
    </section>
  );
}
