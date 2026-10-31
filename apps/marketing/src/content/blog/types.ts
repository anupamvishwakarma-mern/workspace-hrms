export type Block = { t: 'h2' | 'h3' | 'p'; text: string } | { t: 'ul'; items: string[] };
export interface Post {
  slug: string;
  title: string;
  excerpt: string;
  category: 'HR basics' | 'Attendance' | 'Leave' | 'Infrastructure' | 'Security' | 'Small business';
  tags: string[];
  author: { name: string; role: string };
  /** ISO date. Sample content: replace when the real editorial calendar starts. */
  date: string;
  readingMinutes: number;
  featured?: boolean;
  body: Block[];
}
