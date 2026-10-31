import { features } from './features';
import { solutions } from './solutions';

export interface NavItem {
  label: string;
  href: string;
  description?: string;
}
export interface NavGroup {
  label: string;
  href?: string;
  items?: NavItem[];
}

export const mainNav: NavGroup[] = [
  {
    label: 'Product',
    href: '/features',
    items: [
      ...features
        .filter((f) => !f.upcoming)
        .map((f) => ({ label: f.title, href: `/features/${f.slug}`, description: f.short })),
      {
        label: 'Database Hosting',
        href: '/database-hosting',
        description: 'Managed MongoDB or bring your own.',
      },
    ],
  },
  {
    label: 'Solutions',
    href: '/solutions',
    items: solutions.map((s) => ({
      label: s.title,
      href: `/solutions/${s.slug}`,
      description: s.short,
    })),
  },
  { label: 'Services', href: '/services' },
  { label: 'Pricing', href: '/pricing' },
  {
    label: 'Resources',
    href: '/resources',
    items: [
      {
        label: 'Blog',
        href: '/blog',
        description: 'Articles on HR, attendance and infrastructure.',
      },
      { label: 'Guides', href: '/guides', description: 'Practical, step-by-step guides.' },
      {
        label: 'HR Templates',
        href: '/resources/hr-templates',
        description: 'Downloadable policy and checklist templates.',
      },
      {
        label: 'ROI Calculator',
        href: '/tools/hrms-roi-calculator',
        description: 'Estimate time and cost savings.',
      },
      {
        label: 'Employee Cost Calculator',
        href: '/tools/employee-cost-calculator',
        description: 'Estimate subscription spend.',
      },
      { label: 'FAQ', href: '/faq', description: 'Common questions answered.' },
    ],
  },
  { label: 'About Us', href: '/about' },
];

export const footerNav: { title: string; links: NavItem[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'Features', href: '/features' },
      { label: 'Mobile App', href: '/features/mobile-hrms' },
      { label: 'Integrations', href: '/integrations' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'Database Hosting', href: '/database-hosting' },
    ],
  },
  {
    title: 'Solutions',
    links: [
      { label: 'Startups', href: '/solutions/startups' },
      { label: 'Small Businesses', href: '/solutions/small-business' },
      { label: 'Enterprises', href: '/solutions/enterprise' },
      { label: 'Industry Solutions', href: '/solutions' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'Blog', href: '/blog' },
      { label: 'Guides', href: '/guides' },
      { label: 'FAQs', href: '/faq' },
      { label: 'Documentation', href: '/documentation' },
      { label: 'Help Center', href: '/help-center' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About Us', href: '/about' },
      { label: 'Contact', href: '/contact' },
      { label: 'Careers', href: '/careers' },
      { label: 'Partners', href: '/partners' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy Policy', href: '/privacy-policy' },
      { label: 'Terms of Service', href: '/terms' },
      { label: 'Cookie Policy', href: '/cookie-policy' },
      { label: 'Data Processing Agreement', href: '/data-processing-agreement' },
    ],
  },
];
