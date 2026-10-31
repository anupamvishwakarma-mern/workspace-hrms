import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import Link from 'next/link';
import { PostCard } from '@/components/resources/ResourcesPreview';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { PageHero } from '@/components/ui/page-hero';
import { Section } from '@/components/ui/primitives';
import { allTags, categories, posts } from '@/content/blog/posts';
import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'HR Blog',
  description:
    'Articles about HRMS software, attendance, leave, small-business HR and database hosting.',
  path: '/blog',
});
const PAGE_SIZE = 6;

type SP = { q?: string; category?: string; tag?: string; page?: string };
const href = (p: SP) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) u.set(k, v);
  const s = u.toString();
  return s ? `/blog?${s}` : '/blog';
};

export default async function BlogPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().toLowerCase().slice(0, 80);
  const filtered = posts.filter(
    (p) =>
      (!sp.category || p.category === sp.category) &&
      (!sp.tag || p.tags.includes(sp.tag)) &&
      (!q || `${p.title} ${p.excerpt} ${p.tags.join(' ')}`.toLowerCase().includes(q)),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number(sp.page) || 1));
  const shown = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const keep = { q: sp.q, category: sp.category, tag: sp.tag };
  return (
    <>
      <Breadcrumbs items={[{ label: 'Blog' }]} />
      <PageHero
        eyebrow="Blog"
        title="HR insights and product thinking"
        text="Sample editorial content until our editorial process is in place."
      >
        <form action="/blog" role="search" className="flex w-full max-w-md gap-2">
          <label htmlFor="blog-q" className="sr-only">
            Search articles
          </label>
          <input
            id="blog-q"
            name="q"
            defaultValue={sp.q ?? ''}
            placeholder="Search articles"
            className="flex-1 rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm"
          />
          <button
            type="submit"
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
          >
            <Search aria-hidden className="h-4 w-4" />
            Search
          </button>
        </form>
      </PageHero>
      <Section>
        <div className="grid gap-10 lg:grid-cols-[1fr_16rem]">
          <div>
            {shown.length ? (
              <ul className="grid gap-5 md:grid-cols-2">
                {shown.map((p) => (
                  <li key={p.slug}>
                    <PostCard post={p} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-2xl border border-border p-8 text-center text-muted">
                No articles match your search.{' '}
                <Link className="text-link underline" href="/blog">
                  Clear filters
                </Link>
              </p>
            )}
            {pages > 1 ? (
              <nav
                aria-label="Pagination"
                className="mt-10 flex items-center justify-between text-sm"
              >
                {page > 1 ? (
                  <Link
                    href={href({ ...keep, page: String(page - 1) })}
                    rel="prev"
                    className="inline-flex items-center gap-1 font-semibold text-link"
                  >
                    <ChevronLeft aria-hidden className="h-4 w-4" />
                    Previous
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-muted">
                  Page {page} of {pages}
                </span>
                {page < pages ? (
                  <Link
                    href={href({ ...keep, page: String(page + 1) })}
                    rel="next"
                    className="inline-flex items-center gap-1 font-semibold text-link"
                  >
                    Next
                    <ChevronRight aria-hidden className="h-4 w-4" />
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            ) : null}
          </div>
          <aside aria-label="Filters" className="space-y-8 text-sm">
            <div>
              <h2 className="font-semibold">Categories</h2>
              <ul className="mt-3 space-y-1.5">
                {categories.map((c) => (
                  <li key={c}>
                    <Link
                      className={
                        sp.category === c
                          ? 'font-semibold text-link'
                          : 'text-muted hover:text-foreground'
                      }
                      href={href({ category: c })}
                    >
                      {c}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="font-semibold">Tags</h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {allTags.map((t) => (
                  <li key={t}>
                    <Link
                      href={href({ tag: t })}
                      className={`rounded-full border px-2.5 py-1 text-xs ${sp.tag === t ? 'border-primary text-link' : 'border-border text-muted hover:text-foreground'}`}
                    >
                      {t}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </Section>
    </>
  );
}
