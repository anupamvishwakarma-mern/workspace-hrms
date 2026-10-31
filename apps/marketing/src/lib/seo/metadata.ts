import type { Metadata } from 'next';
import { brand } from '@/config/brand';
import { seo } from '@/config/seo';
import { site } from '@/config/site';

export interface PageSeo {
  title: string;
  description: string;
  /** Path starting with "/". Used for the canonical URL and Open Graph URL. */
  path: string;
  type?: 'website' | 'article';
  keywords?: string[];
  noindex?: boolean;
  publishedTime?: string;
}

/** Builds complete page metadata (title, description, canonical, Open Graph, Twitter) from one call. */
export function buildMetadata(p: PageSeo): Metadata {
  const url = `${site.baseUrl}${p.path}`;
  const fullTitle = `${p.title} | ${brand.name}`;
  return {
    title: p.title,
    description: p.description,
    keywords: p.keywords ?? [...seo.keywords],
    alternates: { canonical: p.path },
    robots: p.noindex ? { index: false, follow: false } : undefined,
    openGraph: {
      title: fullTitle,
      description: p.description,
      url,
      siteName: brand.name,
      type: p.type ?? 'website',
      ...(p.publishedTime ? { publishedTime: p.publishedTime } : {}),
    },
    twitter: { card: 'summary_large_image', title: fullTitle, description: p.description },
  };
}

export const organizationJsonLd = () => ({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: brand.name,
  url: site.baseUrl,
  description: brand.description,
  ...(Object.values(brand.social).filter(Boolean).length
    ? { sameAs: Object.values(brand.social).filter(Boolean) }
    : {}),
});

export const softwareJsonLd = () => ({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: brand.name,
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web, Android, iOS',
  description: brand.description,
  url: site.baseUrl,
});

export const faqJsonLd = (items: { q: string; a: string }[]) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: items.map((i) => ({
    '@type': 'Question',
    name: i.q,
    acceptedAnswer: { '@type': 'Answer', text: i.a },
  })),
});
