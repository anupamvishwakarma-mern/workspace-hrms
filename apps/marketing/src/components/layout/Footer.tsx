import Link from 'next/link';
import { Logo } from './Logo';
import { NewsletterForm } from '@/components/forms/NewsletterForm';
import { Container } from '@/components/ui/primitives';
import { brand } from '@/config/brand';
import { footerNav } from '@/config/navigation';

const socials = [
  { key: 'linkedin', label: 'LinkedIn', short: 'in' },
  { key: 'x', label: 'X', short: 'X' },
  { key: 'youtube', label: 'YouTube', short: 'YT' },
  { key: 'github', label: 'GitHub', short: 'GH' },
] as const;

export function Footer() {
  const links = socials.filter((s) => brand.social[s.key]);
  const c = brand.contact;
  return (
    <footer className="border-t border-border bg-surface">
      <Container className="py-14">
        <div className="grid gap-10 lg:grid-cols-[1.3fr_2.7fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted">
              {brand.description}. {brand.tagline}
            </p>
            <div className="mt-6 max-w-sm">
              <NewsletterForm compact />
            </div>
            <address className="mt-6 space-y-1 text-sm not-italic text-muted">
              {c.salesEmail ? (
                <p>
                  Sales:{' '}
                  <a className="hover:text-foreground" href={`mailto:${c.salesEmail}`}>
                    {c.salesEmail}
                  </a>
                </p>
              ) : null}
              {c.supportEmail ? (
                <p>
                  Support:{' '}
                  <a className="hover:text-foreground" href={`mailto:${c.supportEmail}`}>
                    {c.supportEmail}
                  </a>
                </p>
              ) : null}
              {c.phone ? <p>Phone: {c.phone}</p> : null}
              {c.address ? <p>{c.address}</p> : null}
              {!c.salesEmail && !c.supportEmail && !c.phone ? (
                <p>
                  Reach us through the{' '}
                  <Link className="text-link underline" href="/contact">
                    contact form
                  </Link>
                  .
                </p>
              ) : null}
            </address>
            {links.length ? (
              <ul className="mt-5 flex gap-2">
                {links.map(({ key, label, short }) => (
                  <li key={key}>
                    <a
                      href={brand.social[key]}
                      rel="noopener noreferrer"
                      target="_blank"
                      aria-label={label}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted hover:text-foreground"
                    >
                      <span aria-hidden className="text-xs font-bold">
                        {short}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-5">
            {footerNav.map((col) => (
              <div key={col.title}>
                <h2 className="text-sm font-semibold">{col.title}</h2>
                <ul className="mt-4 space-y-2.5 text-sm">
                  {col.links.map((l) => (
                    <li key={l.href + l.label}>
                      <Link href={l.href} className="text-muted transition hover:text-foreground">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="mt-12 border-t border-border pt-6 text-sm text-muted">
          <p>
            © {new Date().getFullYear()} {brand.name}. All rights reserved.
          </p>
        </div>
      </Container>
    </footer>
  );
}
