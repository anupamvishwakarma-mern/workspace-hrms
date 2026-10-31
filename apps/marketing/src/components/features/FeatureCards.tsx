import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Badge, Card } from '@/components/ui/primitives';
import { Reveal } from '@/components/ui/reveal';
import { features } from '@/config/features';

/** Module cards used on the home page and the features index. */
export function FeatureCards({ only }: { only?: string[] }) {
  const list = features.filter((f) => f.slug !== 'mobile-hrms' && (!only || only.includes(f.slug)));
  return (
    <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {list.map((f, i) => (
        <li key={f.slug}>
          <Reveal delay={(i % 3) * 0.05} className="h-full">
            <Card className="group flex h-full flex-col hover:shadow-pop">
              <div className="flex items-start justify-between">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-link">
                  <f.icon aria-hidden className="h-5 w-5" />
                </span>
                {f.upcoming ? <Badge tone="warn">Coming soon</Badge> : null}
              </div>
              <h3 className="mt-4 text-lg font-semibold">
                <Link href={`/features/${f.slug}`} className="after:absolute after:inset-0">
                  {f.title}
                </Link>
              </h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{f.short}</p>
              <MiniVisual slug={f.slug} />
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-link">
                Learn more{' '}
                <ArrowRight
                  aria-hidden
                  className="h-4 w-4 transition group-hover:translate-x-0.5"
                />
              </span>
            </Card>
          </Reveal>
        </li>
      ))}
    </ul>
  );
}

/** Tiny decorative visual per module (purely illustrative, hidden from assistive tech). */
function MiniVisual({ slug }: { slug: string }) {
  const bars = (vals: number[]) => (
    <div aria-hidden className="mt-4 flex h-8 items-end gap-1">
      {vals.map((v, i) => (
        <span key={i} className="flex-1 rounded-sm bg-primary/60" style={{ height: `${v}%` }} />
      ))}
    </div>
  );
  const chips = (n: string[]) => (
    <div aria-hidden className="mt-4 flex flex-wrap gap-1.5">
      {n.map((x) => (
        <span key={x} className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-muted">
          {x}
        </span>
      ))}
    </div>
  );
  switch (slug) {
    case 'attendance-management':
      return bars([40, 70, 60, 85, 75, 90, 65]);
    case 'reports-analytics':
      return bars([30, 45, 40, 60, 55, 80, 70]);
    case 'leave-management':
      return chips(['Casual', 'Sick', 'Earned']);
    case 'shift-management':
      return chips(['General', 'Morning', 'Evening']);
    case 'roles-permissions':
      return chips(['Owner', 'HR', 'Manager', 'Employee']);
    case 'document-management':
      return chips(['Letters', 'Handbook', 'Files']);
    case 'payroll-management':
      return chips(['Structures', 'Runs', 'Payslips']);
    case 'employee-management':
      return chips(['Directory', 'Import', 'History']);
    default:
      return chips(['Planned']);
  }
}
