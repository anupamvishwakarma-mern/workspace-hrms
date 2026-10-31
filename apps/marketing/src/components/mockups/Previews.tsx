import { Check, Clock, FileText, Lock, Search, Target, X } from 'lucide-react';
import { Avatar, Pill, Stat, WindowFrame } from './Frame';
import type { PreviewKind } from '@/config/features';
import { DashboardMockup } from './DashboardMockup';
import { PhoneMockup } from './PhoneMockup';

const people = [
  ['Asha Rao', 'Engineering', 'Senior Engineer', 'Active'],
  ['Dev Patel', 'Design', 'Product Designer', 'Active'],
  ['Meera Iyer', 'People Ops', 'HR Manager', 'Active'],
  ['Karan Shah', 'Sales', 'Account Executive', 'On notice'],
  ['Lina Dsouza', 'Finance', 'Analyst', 'Invited'],
] as const;

export function DirectoryPreview() {
  return (
    <WindowFrame title="Employee directory">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs text-muted">
            <Search className="h-3.5 w-3.5" />
            Search employees
          </div>
          <Pill tone="primary">Add employee</Pill>
        </div>
        <ul className="divide-y divide-border rounded-xl border border-border">
          {people.map(([n, d, r, s]) => (
            <li key={n} className="flex items-center gap-3 px-3 py-2.5">
              <Avatar name={n} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{n}</p>
                <p className="truncate text-[11px] text-muted">{r}</p>
              </div>
              <span className="hidden text-[11px] text-muted sm:block">{d}</span>
              <Pill tone={s === 'Active' ? 'ok' : s === 'Invited' ? 'primary' : 'warn'}>{s}</Pill>
            </li>
          ))}
        </ul>
      </div>
    </WindowFrame>
  );
}

const att = [
  ['Asha Rao', '09:02', '18:10', '9h 08m', 'Present'],
  ['Dev Patel', '09:41', '18:30', '8h 49m', 'Late'],
  ['Meera Iyer', '08:55', '17:58', '9h 03m', 'Present'],
  ['Karan Shah', '—', '—', '—', 'Absent'],
  ['Lina Dsouza', '09:10', '13:05', '3h 55m', 'Half day'],
] as const;
export function AttendancePreview() {
  return (
    <WindowFrame title="Attendance records">
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Present" value="219" tone="ok" />
          <Stat label="Late" value="17" tone="warn" />
          <Stat label="Outside geofence" value="3" tone="danger" />
        </div>
        <div className="overflow-hidden rounded-xl border border-border text-[11px]">
          <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr] bg-surface px-3 py-2 font-medium text-muted">
            <span>Employee</span>
            <span>In</span>
            <span>Out</span>
            <span>Hours</span>
            <span>Status</span>
          </div>
          {att.map(([n, i, o, h, s]) => (
            <div
              key={n}
              className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr] items-center border-t border-border px-3 py-2"
            >
              <span className="truncate font-medium">{n}</span>
              <span>{i}</span>
              <span>{o}</span>
              <span>{h}</span>
              <span>
                <Pill tone={s === 'Present' ? 'ok' : s === 'Absent' ? 'danger' : 'warn'}>{s}</Pill>
              </span>
            </div>
          ))}
        </div>
      </div>
    </WindowFrame>
  );
}

const leave = [
  ['Dev Patel', 'Casual leave', '12-13 Mar', '2 days'],
  ['Lina Dsouza', 'Sick leave', '14 Mar', '1 day'],
  ['Karan Shah', 'Casual leave', '18-20 Mar', '3 days'],
] as const;
export function LeavePreview() {
  return (
    <WindowFrame title="Leave approvals">
      <div className="space-y-2.5">
        <p className="text-xs font-semibold">
          Pending requests <Pill tone="warn">3</Pill>
        </p>
        {leave.map(([n, t, d, l]) => (
          <div key={n} className="flex items-center gap-3 rounded-xl border border-border p-3">
            <Avatar name={n} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium">{n}</p>
              <p className="text-[11px] text-muted">
                {t} · {d} · {l}
              </p>
            </div>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              <Check className="h-4 w-4" />
            </span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
              <X className="h-4 w-4" />
            </span>
          </div>
        ))}
      </div>
    </WindowFrame>
  );
}

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const roster = [
  ['Asha Rao', 'G', 'G', 'G', 'G', 'G', 'O'],
  ['Dev Patel', 'M', 'M', 'M', 'M', 'M', 'O'],
  ['Meera Iyer', 'G', 'G', 'E', 'E', 'G', 'O'],
  ['Lina Dsouza', 'E', 'E', 'E', 'G', 'G', 'O'],
] as const;
export function ShiftPreview() {
  const style: Record<string, string> = {
    G: 'bg-primary-soft text-link',
    M: 'bg-accent-soft text-accent-text',
    E: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    O: 'bg-surface-2 text-muted',
  };
  return (
    <WindowFrame title="Shift calendar">
      <div className="space-y-3 text-[11px]">
        <div className="grid grid-cols-[1.4fr_repeat(6,1fr)] gap-1.5 text-center font-medium text-muted">
          <span />{' '}
          {days.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        {roster.map(([n, ...cells]) => (
          <div
            key={n}
            className="grid grid-cols-[1.4fr_repeat(6,1fr)] items-center gap-1.5 text-center"
          >
            <span className="truncate text-left font-medium">{n}</span>
            {cells.map((c, i) => (
              <span key={i} className={`rounded-md py-1.5 font-semibold ${style[c]}`}>
                {c === 'O' ? 'Off' : c}
              </span>
            ))}
          </div>
        ))}
        <p className="text-muted">G General · M Morning · E Evening (sample shifts)</p>
      </div>
    </WindowFrame>
  );
}

export function AnalyticsPreview() {
  const pts = [48, 55, 52, 63, 60, 71, 68, 76];
  const path = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * 100) / (pts.length - 1)},${100 - p}`)
    .join(' ');
  return (
    <WindowFrame title="Analytics dashboard">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border p-3">
          <p className="text-xs font-semibold">On-time arrival trend</p>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="mt-2 h-28 w-full">
            <path
              d={path}
              fill="none"
              stroke="var(--primary)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
            <path d={`${path} L100,100 L0,100 Z`} fill="var(--primary)" opacity="0.1" />
          </svg>
        </div>
        <div className="rounded-xl border border-border p-3">
          <p className="text-xs font-semibold">Leave by type</p>
          <ul className="mt-3 space-y-2.5 text-[11px]">
            {[
              ['Casual', 46],
              ['Sick', 28],
              ['Earned', 18],
              ['Other', 8],
            ].map(([k, v]) => (
              <li key={k as string}>
                <div className="flex justify-between">
                  <span>{k}</span>
                  <span className="text-muted">{v}%</span>
                </div>
                <div className="mt-1 h-1.5 rounded bg-surface-2">
                  <div className="h-full rounded bg-accent" style={{ width: `${v}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </WindowFrame>
  );
}

export function PayrollPreview() {
  return (
    <WindowFrame title="Payroll run">
      <div className="space-y-3 text-[11px]">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold">
            Monthly run <Pill tone="warn">Draft</Pill>
          </p>
          <Pill tone="primary">Publish</Pill>
        </div>
        <div className="overflow-hidden rounded-xl border border-border">
          {[
            ['Gross earnings', 'Sample'],
            ['Loss of pay (from attendance)', 'Sample'],
            ['Net pay', 'Sample'],
          ].map(([k, v]) => (
            <div
              key={k}
              className="flex justify-between border-b border-border px-3 py-2 last:border-0"
            >
              <span>{k}</span>
              <span className="text-muted">{v}</span>
            </div>
          ))}
        </div>
        <p className="text-muted">Amounts are omitted: this preview shows structure only.</p>
      </div>
    </WindowFrame>
  );
}

export function DocumentsPreview() {
  return (
    <WindowFrame title="Documents">
      <ul className="divide-y divide-border rounded-xl border border-border text-[11px]">
        {['Offer letter', 'ID proof', 'Employment agreement', 'HR handbook'].map((d, i) => (
          <li key={d} className="flex items-center gap-3 px-3 py-2.5">
            <FileText className="h-4 w-4 text-link" />
            <span className="flex-1 font-medium">{d}</span>
            <Pill tone={i === 3 ? 'primary' : 'neutral'}>{i === 3 ? 'Published' : 'Private'}</Pill>
          </li>
        ))}
      </ul>
    </WindowFrame>
  );
}

export function RolesPreview() {
  const rows = [
    ['Employee', 'Own data'],
    ['Manager', 'Team data'],
    ['HR admin', 'Company data'],
    ['Payroll admin', 'Payroll'],
    ['Company owner', 'Everything + settings'],
  ];
  return (
    <WindowFrame title="Roles and access">
      <ul className="divide-y divide-border rounded-xl border border-border text-[11px]">
        {rows.map(([r, s]) => (
          <li key={r} className="flex items-center gap-3 px-3 py-2.5">
            <Lock className="h-4 w-4 text-muted" />
            <span className="flex-1 font-medium">{r}</span>
            <Pill tone="primary">{s}</Pill>
          </li>
        ))}
      </ul>
    </WindowFrame>
  );
}

export function PerformancePreview() {
  return (
    <WindowFrame title="Performance (planned)">
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <Target className="h-8 w-8 text-muted" />
        <p className="text-sm font-semibold">Coming soon</p>
        <p className="max-w-xs text-xs text-muted">
          Goals and review cycles are planned. No interface exists yet.
        </p>
        <Clock className="sr-only" />
      </div>
    </WindowFrame>
  );
}

export function PreviewFor({ kind }: { kind: PreviewKind }) {
  switch (kind) {
    case 'directory':
      return <DirectoryPreview />;
    case 'attendance':
      return <AttendancePreview />;
    case 'leave':
      return <LeavePreview />;
    case 'shifts':
      return <ShiftPreview />;
    case 'analytics':
      return <AnalyticsPreview />;
    case 'payroll':
      return <PayrollPreview />;
    case 'documents':
      return <DocumentsPreview />;
    case 'roles':
      return <RolesPreview />;
    case 'performance':
      return <PerformancePreview />;
    case 'mobile':
      return (
        <div className="flex justify-center">
          <PhoneMockup screen="today" />
        </div>
      );
  }
}
export { DashboardMockup };
