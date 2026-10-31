import Link from 'next/link';
import { JsonLd } from './JsonLd';
import { Container } from '@/components/ui/primitives';
import { site } from '@/config/site';

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const all: Crumb[] = [{ label: 'Home', href: '/' }, ...items];
  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: all.map((c, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: c.label,
            ...(c.href ? { item: `${site.baseUrl}${c.href}` } : {}),
          })),
        }}
      />
      <nav aria-label="Breadcrumb" className="border-b border-border bg-surface">
        <Container>
          <ol className="flex flex-wrap items-center gap-1.5 py-3 text-sm text-muted">
            {all.map((c, i) => (
              <li key={c.label} className="flex items-center gap-1.5">
                {i > 0 ? <span aria-hidden>/</span> : null}
                {c.href && i < all.length - 1 ? (
                  <Link href={c.href} className="hover:text-foreground">
                    {c.label}
                  </Link>
                ) : (
                  <span aria-current="page" className="text-foreground">
                    {c.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </Container>
      </nav>
    </>
  );
}
