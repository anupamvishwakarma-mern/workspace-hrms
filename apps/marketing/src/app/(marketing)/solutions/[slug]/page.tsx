import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SolutionPage } from '@/components/features/SolutionPage';
import { solutionBySlug, solutions } from '@/config/solutions';
import { buildMetadata } from '@/lib/seo/metadata';

export const dynamicParams = false;
export const generateStaticParams = () => solutions.map((s) => ({ slug: s.slug }));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const s = solutionBySlug((await params).slug);
  if (!s) return {};
  return buildMetadata({
    title: s.heroTitle,
    description: s.heroText,
    path: `/solutions/${s.slug}`,
  });
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const s = solutionBySlug((await params).slug);
  if (!s) notFound();
  return <SolutionPage s={s} />;
}
