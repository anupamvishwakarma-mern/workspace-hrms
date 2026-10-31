import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { FeaturePage } from '@/components/features/FeaturePage';
import { featureBySlug, features } from '@/config/features';
import { buildMetadata } from '@/lib/seo/metadata';

export const dynamicParams = false;
export const generateStaticParams = () => features.map((f) => ({ slug: f.slug }));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const f = featureBySlug((await params).slug);
  if (!f) return {};
  return buildMetadata({
    title: `${f.title}: ${f.keyword}`,
    description: f.heroText,
    path: `/features/${f.slug}`,
  });
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const f = featureBySlug((await params).slug);
  if (!f) notFound();
  return <FeaturePage feature={f} />;
}
