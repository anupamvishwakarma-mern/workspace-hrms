import type { ReactNode } from 'react';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { PageHero } from '@/components/ui/page-hero';
import { Container } from '@/components/ui/primitives';

/** Simple prose page for legal and placeholder content. */
export function InfoPage({
  title,
  intro,
  crumb,
  children,
  draft,
}: {
  title: string;
  intro?: string;
  crumb?: string;
  children: ReactNode;
  draft?: boolean;
}) {
  return (
    <>
      <Breadcrumbs items={[{ label: crumb ?? title }]} />
      <PageHero title={title} text={intro} />
      <Container className="max-w-3xl py-12">
        {draft ? (
          <p
            role="note"
            className="mb-8 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          >
            <strong>Draft for legal review.</strong> This is a structural placeholder, not a legally
            reviewed document. Replace it with text approved by your legal adviser before launch.
          </p>
        ) : null}
        <div className="prose-content">{children}</div>
      </Container>
    </>
  );
}
