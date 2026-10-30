'use client';
import {
  BookOpen,
  Briefcase,
  Building2,
  CalendarClock,
  CalendarDays,
  CheckSquare,
  FileText,
  Wallet,
  UsersRound,
  ChevronsUpDown,
  ClipboardList,
  FileBarChart,
  History,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Plane,
  Settings,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/components/auth';
import { Button } from '@/components/ui/button';
import { Avatar, Skeleton } from '@/components/ui/display';
import { LANGUAGES, useI18n, type Key } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: Key;
  /** Group name key. */
  groupKey: Key;
  icon: LucideIcon;
  perms: string[];
  group: string;
}
export const NAV: NavItem[] = [
  {
    href: '/dashboard',
    label: 'nav.dashboard',
    icon: LayoutDashboard,
    perms: ['attendance:read:all', 'attendance:read:team'],
    group: 'Overview',
    groupKey: 'group.overview',
  },
  {
    href: '/attendance',
    label: 'nav.attendance',
    icon: ClipboardList,
    perms: ['attendance:read:all', 'attendance:read:team'],
    group: 'Workforce',
    groupKey: 'group.workforce',
  },
  {
    href: '/approvals',
    label: 'nav.approvals',
    icon: CheckSquare,
    perms: ['attendance:review:all', 'attendance:review:team'],
    group: 'Workforce',
    groupKey: 'group.workforce',
  },
  {
    href: '/requests',
    label: 'nav.requests',
    icon: CheckSquare,
    perms: ['approval:use'],
    group: 'Workforce',
    groupKey: 'group.workforce',
  },
  {
    href: '/leave',
    label: 'nav.leave',
    icon: Plane,
    perms: ['leave:review:all', 'leave:review:team', 'leave:manage'],
    group: 'Workforce',
    groupKey: 'group.workforce',
  },
  {
    href: '/employees',
    label: 'nav.employees',
    icon: Users,
    perms: ['employee:read:all', 'employee:read:team', 'employee:read:basic'],
    group: 'Workforce',
    groupKey: 'group.workforce',
  },
  {
    href: '/team',
    label: 'nav.team',
    groupKey: 'group.workforce',
    icon: UsersRound,
    perms: ['attendance:read:all', 'attendance:read:team'],
    group: 'Workforce',
  },
  {
    href: '/departments',
    label: 'nav.departments',
    icon: Building2,
    perms: ['department:manage'],
    group: 'Company setup',
    groupKey: 'group.setup',
  },
  {
    href: '/designations',
    label: 'nav.designations',
    icon: Briefcase,
    perms: ['designation:manage'],
    group: 'Company setup',
    groupKey: 'group.setup',
  },
  {
    href: '/workflows',
    label: 'nav.workflows',
    icon: Briefcase,
    perms: ['approval:manage'],
    group: 'Company setup',
    groupKey: 'group.setup',
  },
  {
    href: '/shifts',
    label: 'nav.shifts',
    icon: CalendarClock,
    perms: ['shift:manage'],
    group: 'Company setup',
    groupKey: 'group.setup',
  },
  {
    href: '/locations',
    label: 'nav.locations',
    icon: MapPin,
    perms: ['location:manage'],
    group: 'Company setup',
    groupKey: 'group.setup',
  },
  {
    href: '/holidays',
    label: 'nav.holidays',
    icon: CalendarDays,
    perms: ['holiday:manage'],
    group: 'Company setup',
    groupKey: 'group.setup',
  },
  {
    href: '/payroll',
    label: 'nav.payroll',
    groupKey: 'group.hr',
    icon: Wallet,
    perms: ['payroll:manage'],
    group: 'HR & pay',
  },
  {
    href: '/letters',
    label: 'nav.letters',
    groupKey: 'group.hr',
    icon: FileText,
    perms: ['letter:manage'],
    group: 'HR & pay',
  },
  {
    href: '/handbook',
    label: 'nav.handbook',
    groupKey: 'group.hr',
    icon: BookOpen,
    perms: ['handbook:manage', 'attendance:read:team'],
    group: 'HR & pay',
  },
  {
    href: '/reports',
    label: 'nav.reports',
    icon: FileBarChart,
    perms: ['attendance:read:all', 'attendance:read:team'],
    group: 'Insights',
    groupKey: 'group.insights',
  },
  {
    href: '/audit',
    label: 'nav.audit',
    icon: History,
    perms: ['audit:read'],
    group: 'Insights',
    groupKey: 'group.insights',
  },
  {
    href: '/settings',
    label: 'nav.settings',
    icon: Settings,
    perms: ['tenant:update'],
    group: 'Admin',
    groupKey: 'group.admin',
  },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const { status, active, can, memberships, selectCompany, signOut, email, retry } = useAuth();
  const { t, lang, setLang } = useI18n();
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (status === 'signedOut' || status === 'needsCompany') router.replace('/login');
  }, [status, router]);
  useEffect(() => setOpen(false), [path]);

  if (status === 'offline')
    return (
      <Center>
        <h1 className="text-xl font-bold">Cannot reach the server</h1>
        <p className="text-sm text-muted">
          You are still signed in. Check your connection and try again.
        </p>
        <Button onClick={retry}>Try again</Button>
      </Center>
    );
  if (status === 'noAccess')
    return (
      <Center>
        <h1 className="text-xl font-bold">No company access</h1>
        <p className="text-sm text-muted">
          Your account is not an active member of any company. Contact your administrator.
        </p>
        <Button variant="secondary" onClick={() => void signOut()}>
          Sign out
        </Button>
      </Center>
    );
  if (status !== 'ready' || !active)
    return (
      <div className="space-y-4 p-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32" />
      </div>
    );

  const items = NAV.filter((n) => can(...n.perms));
  // Cosmetic: a typed-in URL for a page the role has no menu entry for. The API enforces access regardless.
  const current = NAV.find((n) => path === n.href || path.startsWith(`${n.href}/`));
  const blocked = !!current && !can(...current.perms);
  // Web is for people who administer or manage. Plain employees use the mobile app.
  const isStaff = can('attendance:read:all', 'attendance:read:team');
  const groups = [...new Set(items.map((n) => n.group))];
  const role = active.roles.map((r) => r.replace('_', ' ').toLowerCase()).join(', ');

  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-5">
      {groups.map((g) => (
        <div key={g}>
          <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted/80">
            {t(items.find((n) => n.group === g)!.groupKey)}
          </p>
          <div className="flex flex-col gap-0.5">
            {items
              .filter((n) => n.group === g)
              .map((n) => {
                const on = path === n.href || path.startsWith(`${n.href}/`);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    aria-current={on ? 'page' : undefined}
                    className={cn(
                      'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                      on
                        ? 'bg-accent text-primary'
                        : 'text-foreground/75 hover:bg-subtle hover:text-foreground',
                    )}
                  >
                    {on ? (
                      <span
                        aria-hidden
                        className="absolute -left-4 top-1.5 h-6 w-1 rounded-r-full bg-primary"
                      />
                    ) : null}
                    <n.icon
                      className={cn('h-[18px] w-[18px]', on ? 'text-primary' : 'text-muted')}
                      aria-hidden
                    />
                    {t(n.label)}
                  </Link>
                );
              })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen md:grid md:grid-cols-[16.5rem_1fr]">
      {open ? (
        <button
          aria-label="Close menu"
          className="animate-fade-in fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-sm md:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[16.5rem] flex-col border-r border-border bg-sidebar px-4 py-5 transition-transform duration-200 md:sticky md:top-0 md:h-screen md:translate-x-0',
          open ? 'translate-x-0 shadow-modal' : '-translate-x-full',
        )}
      >
        <div className="mb-6 flex items-center gap-2.5 px-1">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Users className="h-5 w-5" aria-hidden />
          </span>
          <span className="text-lg font-bold tracking-tight">Workforce</span>
          <button
            className="ml-auto rounded-lg p-1.5 text-muted hover:bg-subtle md:hidden"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-5 rounded-xl border border-border bg-subtle/60 p-2.5">
          {memberships.length > 1 ? (
            <div className="relative">
              <label htmlFor="company" className="mb-1 block text-[11px] font-medium text-muted">
                Company
              </label>
              <select
                id="company"
                value={active.tenantId}
                onChange={(e) => selectCompany(e.target.value)}
                className="w-full appearance-none rounded-lg border border-border bg-card py-1.5 pl-2.5 pr-8 text-sm font-semibold"
              >
                {memberships.map((m) => (
                  <option key={m.tenantId} value={m.tenantId}>
                    {m.tenantName ?? m.tenantSlug}
                  </option>
                ))}
              </select>
              <ChevronsUpDown
                aria-hidden
                className="pointer-events-none absolute bottom-2 right-2.5 h-4 w-4 text-muted"
              />
            </div>
          ) : (
            <div className="flex items-center gap-2.5">
              <Avatar name={active.tenantName ?? 'Company'} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{active.tenantName}</p>
                <p className="text-[11px] text-muted">Company</p>
              </div>
            </div>
          )}
        </div>

        <div className="mb-3">
          <label htmlFor="lang" className="mb-1 block text-[11px] font-medium text-muted">
            {t('common.language')}
          </label>
          <select
            id="lang"
            value={lang}
            onChange={(e) => setLang(e.target.value as typeof lang)}
            className="w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm font-medium"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.native}
              </option>
            ))}
          </select>
        </div>

        <div className="-ml-4 -mr-2 min-h-0 flex-1 overflow-y-auto pl-4 pr-2">{nav}</div>

        <div className="mt-4 flex items-center gap-2.5 border-t border-border pt-4">
          <Avatar name={email ?? role ?? 'User'} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{email ?? 'Signed in'}</p>
            <p className="truncate text-xs capitalize text-muted">{role}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Sign out"
            title="Sign out"
            onClick={() => void signOut()}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-card/80 px-4 backdrop-blur md:hidden">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle menu"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <span className="font-bold text-primary">Workforce</span>
          <span className="ml-auto truncate text-sm font-medium text-muted">
            {current ? t(current.label) : ''}
          </span>
        </header>
        <main className="mx-auto max-w-[78rem] px-4 py-6 md:px-8 md:py-8">
          {!isStaff && items.length === 0 ? (
            <div className="mx-auto mt-16 max-w-md space-y-2 text-center">
              <h1 className="text-xl font-bold">Use the mobile app</h1>
              <p className="text-sm text-muted">
                This dashboard is for managers and administrators. You can check in and see your
                attendance in the Workforce mobile app.
              </p>
            </div>
          ) : blocked ? (
            <div className="mx-auto mt-16 max-w-md space-y-2 text-center">
              <h1 className="text-xl font-bold">You don’t have access to this page</h1>
              <p className="text-sm text-muted">Ask a company administrator if you need it.</p>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}

const Center = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
    {children}
  </div>
);
