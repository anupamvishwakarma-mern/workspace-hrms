import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Badge, Card, Section, SectionHeader } from '@/components/ui/primitives';
import { posts } from '@/content/blog/posts';

export function PostCard({ post }: { post: (typeof posts)[number] }) {
  return (
    <Card className="group relative flex h-full flex-col hover:shadow-pop">
      <div className="flex items-center gap-2 text-xs text-muted">
        <Badge tone="accent">{post.category}</Badge>
        <span>{post.readingMinutes} min read</span>
      </div>
      <h3 className="mt-3 text-lg font-semibold leading-snug">
        <Link href={`/blog/${post.slug}`} className="after:absolute after:inset-0">
          {post.title}
        </Link>
      </h3>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{post.excerpt}</p>
      <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-link">
        Read article <ArrowRight aria-hidden className="h-4 w-4" />
      </span>
    </Card>
  );
}

export function ResourcesPreview() {
  const featured = posts.filter((p) => p.featured).slice(0, 3);
  return (
    <Section tone="surface" id="resources">
      <SectionHeader eyebrow="Resources" title="Learn from our guides and articles" />
      <ul className="mt-10 grid gap-5 md:grid-cols-3">
        {featured.map((p) => (
          <li key={p.slug}>
            <PostCard post={p} />
          </li>
        ))}
      </ul>
      <p className="mt-8 text-center">
        <Link href="/blog" className="font-semibold text-link">
          Browse all articles →
        </Link>
      </p>
    </Section>
  );
}
