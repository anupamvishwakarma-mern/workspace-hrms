import type { MetadataRoute } from 'next';
import { posts } from '@/content/blog/posts';
import { features } from '@/config/features';
import { solutions } from '@/config/solutions';
import { site } from '@/config/site';

const staticPaths = [
  '/',
  '/features',
  '/solutions',
  '/services',
  '/pricing',
  '/database-hosting',
  '/about',
  '/contact',
  '/book-demo',
  '/free-trial',
  '/resources',
  '/resources/hr-templates',
  '/blog',
  '/guides',
  '/faq',
  '/partners',
  '/tools/hrms-roi-calculator',
  '/tools/employee-cost-calculator',
  '/integrations',
  '/careers',
  '/documentation',
  '/help-center',
  '/privacy-policy',
  '/terms',
  '/cookie-policy',
  '/data-processing-agreement',
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    ...staticPaths.map((p) => ({
      url: `${site.baseUrl}${p}`,
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: p === '/' ? 1 : 0.7,
    })),
    ...features.map((f) => ({
      url: `${site.baseUrl}/features/${f.slug}`,
      lastModified: now,
      priority: 0.8,
    })),
    ...solutions.map((s) => ({
      url: `${site.baseUrl}/solutions/${s.slug}`,
      lastModified: now,
      priority: 0.7,
    })),
    ...posts.map((p) => ({
      url: `${site.baseUrl}/blog/${p.slug}`,
      lastModified: new Date(p.date),
      priority: 0.6,
    })),
  ];
}
