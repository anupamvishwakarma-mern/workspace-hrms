'use client';
import { ChevronDown, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { CtaLink } from '@/components/ui/cta-link';
import { mainNav, type NavGroup } from '@/config/navigation';
import { site } from '@/config/site';
import { cn } from '@/lib/utils';

function Dropdown({ group }: { group: NavGroup }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const wide = (group.items?.length ?? 0) > 7;
  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-muted transition hover:text-foreground"
      >
        {group.label}
        <ChevronDown aria-hidden className={cn('h-4 w-4 transition', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className={cn('absolute left-0 top-full z-50 pt-2', wide ? 'w-[34rem]' : 'w-80')}>
          <ul
            className={cn(
              'grid gap-1 rounded-xl border border-border bg-background p-2 shadow-pop',
              wide && 'grid-cols-2',
            )}
          >
            {group.items!.map((i) => (
              <li key={i.href}>
                <Link
                  href={i.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg p-3 transition hover:bg-surface-2"
                >
                  <span className="block text-sm font-semibold">{i.label}</span>
                  {i.description ? (
                    <span className="mt-0.5 block text-xs leading-snug text-muted">
                      {i.description}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
            {group.href ? (
              <li className={cn(wide && 'col-span-2')}>
                <Link
                  href={group.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg p-3 text-sm font-semibold text-link hover:bg-surface-2"
                >
                  View all {group.label.toLowerCase()} →
                </Link>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function Navbar() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    document.body.style.overflow = mobile ? 'hidden' : '';
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobile(false);
    };
    document.addEventListener('keydown', esc);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', esc);
    };
  }, [mobile]);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Logo />
        <nav aria-label="Main" className="hidden items-center gap-0.5 xl:flex">
          {mainNav.map((g) =>
            g.items ? (
              <Dropdown key={g.label} group={g} />
            ) : (
              <Link
                key={g.label}
                href={g.href!}
                className="rounded-lg px-3 py-2 text-sm font-medium text-muted transition hover:text-foreground"
              >
                {g.label}
              </Link>
            ),
          )}
        </nav>
        <div className="hidden items-center gap-2 xl:flex">
          <ThemeToggle />
          <a
            href={site.loginUrl()}
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted transition hover:text-foreground"
          >
            Login
          </a>
          <CtaLink href={site.demoUrl} variant="outline" size="sm">
            Book a Demo
          </CtaLink>
          <CtaLink href={site.trialUrl} size="sm">
            Start Free Trial
          </CtaLink>
        </div>
        <div className="flex items-center gap-2 xl:hidden">
          <ThemeToggle />
          <button
            type="button"
            aria-label={mobile ? 'Close menu' : 'Open menu'}
            aria-expanded={mobile}
            aria-controls="mobile-menu"
            onClick={() => setMobile((m) => !m)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border"
          >
            {mobile ? (
              <X aria-hidden className="h-5 w-5" />
            ) : (
              <Menu aria-hidden className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>
      {mobile ? <MobileMenu onNavigate={() => setMobile(false)} /> : null}
    </header>
  );
}

function MobileMenu({ onNavigate }: { onNavigate: () => void }) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  return (
    <div
      id="mobile-menu"
      className="fixed inset-x-0 top-16 bottom-0 overflow-y-auto border-t border-border bg-background px-4 pb-10 pt-4 xl:hidden"
    >
      <nav aria-label="Mobile">
        <ul className="space-y-1">
          {mainNav.map((g) => (
            <li key={g.label}>
              {g.items ? (
                <>
                  <button
                    type="button"
                    aria-expanded={openGroup === g.label}
                    onClick={() => setOpenGroup(openGroup === g.label ? null : g.label)}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-3 text-base font-semibold hover:bg-surface-2"
                  >
                    {g.label}
                    <ChevronDown
                      aria-hidden
                      className={cn('h-5 w-5 transition', openGroup === g.label && 'rotate-180')}
                    />
                  </button>
                  {openGroup === g.label ? (
                    <ul className="mb-2 ml-3 space-y-0.5 border-l border-border pl-3">
                      {g.href ? (
                        <li>
                          <Link
                            href={g.href}
                            onClick={onNavigate}
                            className="block rounded-lg px-3 py-2 text-sm font-semibold text-link"
                          >
                            All {g.label.toLowerCase()}
                          </Link>
                        </li>
                      ) : null}
                      {g.items.map((i) => (
                        <li key={i.href}>
                          <Link
                            href={i.href}
                            onClick={onNavigate}
                            className="block rounded-lg px-3 py-2 text-sm text-muted hover:text-foreground"
                          >
                            {i.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              ) : (
                <Link
                  href={g.href!}
                  onClick={onNavigate}
                  className="block rounded-lg px-3 py-3 text-base font-semibold hover:bg-surface-2"
                >
                  {g.label}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-6 grid gap-3">
        <CtaLink href={site.trialUrl} size="lg" onClick={onNavigate}>
          Start Free Trial
        </CtaLink>
        <CtaLink href={site.demoUrl} size="lg" variant="outline" onClick={onNavigate}>
          Book a Demo
        </CtaLink>
        <a
          href={site.loginUrl()}
          className="rounded-lg px-3 py-3 text-center font-semibold hover:bg-surface-2"
        >
          Login
        </a>
      </div>
    </div>
  );
}
