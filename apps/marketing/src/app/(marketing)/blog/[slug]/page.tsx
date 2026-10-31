import { Clock } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FinalCTA } from '@/components/home/FinalCTA';
import { PostCard } from '@/components/resources/ResourcesPreview';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { JsonLd } from '@/components/seo/JsonLd';
import { Badge, Container, Section } from '@/components/ui/primitives';
import { postBySlug, posts } from '@/content/blog/posts';
import { brand } from '@/config/brand';
import { site } from '@/config/site';
import { buildMetadata } from '@/lib/seo/metadata';

export const dynamicParams = false;
export const generateStaticParams = () => posts.map((p) => ({ slug: p.slug }));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const p = postBySlug((await params).slug);
  if (!p) return {};
  return buildMetadata({
    title: p.title,
    description: p.excerpt,
    path: `/blog/${p.slug}`,
    type: 'article',
    publishedTime: p.date,
    keywords: p.tags,
  });
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const post = postBySlug((await params).slug);
  if (!post) notFound();
  const url = `${site.baseUrl}/blog/${post.slug}`;
  const related = posts
    .filter(
      (p) =>
        p.slug !== post.slug &&
        (p.category === post.category || p.tags.some((t) => post.tags.includes(t))),
    )
    .slice(0, 3);
  const share = [
    {
      label: 'LinkedIn',
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
    },
    {
      label: 'X',
      href: `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(post.title)}`,
    },
    {
      label: 'Email',
      href: `mailto:?subject=${encodeURIComponent(post.title)}&body=${encodeURIComponent(url)}`,
    },
  ];
  return (
    <>
      <Breadcrumbs items={[{ label: 'Blog', href: '/blog' }, { label: post.title }]} />
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: post.title,
          description: post.excerpt,
          datePublished: post.date,
          author: { '@type': 'Organization', name: post.author.name },
          publisher: { '@type': 'Organization', name: brand.name },
          mainEntityOfPage: url,
        }}
      />
      <article>
        <header className="border-b border-border">
          <Container className="max-w-3xl py-12">
            <div className="flex items-center gap-3 text-sm text-muted">
              <Badge tone="accent">{post.category}</Badge>
              <span className="inline-flex items-center gap-1">
                <Clock aria-hidden className="h-3.5 w-3.5" />
                {post.readingMinutes} min read
              </span>
              <time dateTime={post.date}>
                {new Date(post.date).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
              </time>
            </div>
            <h1 className="mt-4 text-4xl font-bold tracking-tight">{post.title}</h1>
            <p className="mt-4 text-lg text-muted">{post.excerpt}</p>
            <p className="mt-6 text-sm text-muted">
              By <strong className="text-foreground">{post.author.name}</strong> ({post.author.role}
              ). This is sample content, not expert advice.
            </p>
          </Container>
        </header>
        <Container className="max-w-3xl py-10">
          <div className="prose-content">
            {post.body.map((b, i) =>
              b.t === 'ul' ? (
                <ul key={i}>
                  {b.items.map((it) => (
                    <li key={it}>{it}</li>
                  ))}
                </ul>
              ) : b.t === 'h2' ? (
                <h2 key={i}>{b.text}</h2>
              ) : b.t === 'h3' ? (
                <h3 key={i}>{b.text}</h3>
              ) : (
                <p key={i}>{b.text}</p>
              ),
            )}
          </div>
          <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-border pt-6 text-sm">
            <span className="font-semibold">Share:</span>
            {share.map((s) => (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-border px-3 py-1.5 text-muted hover:text-foreground"
              >
                {s.label}
              </a>
            ))}
          </div>
          <ul className="mt-6 flex flex-wrap gap-2">
            {post.tags.map((t) => (
              <li key={t}>
                <Link
                  href={`/blog?tag=${encodeURIComponent(t)}`}
                  className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-muted"
                >
                  #{t}
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      </article>
      {related.length ? (
        <Section tone="surface">
          <h2 className="text-2xl font-bold">Related articles</h2>
          <ul className="mt-6 grid gap-5 md:grid-cols-3">
            {related.map((p) => (
              <li key={p.slug}>
                <PostCard post={p} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <FinalCTA />
    </>
  );
}
