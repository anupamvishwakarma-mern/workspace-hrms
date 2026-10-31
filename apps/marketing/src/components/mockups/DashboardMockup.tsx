import {
  Bell,
  CalendarDays,
  FileText,
  Fingerprint,
  LayoutDashboard,
  Users,
  Wallet,
} from 'lucide-react';
import { Avatar, Pill, Stat, WindowFrame } from './Frame';
import { brand } from '@/config/brand';

const bars = [62, 70, 66, 78, 74, 40, 22, 68, 72, 75, 70, 58];
const activity = [
  { n: 'Asha Rao', t: 'checked in at HQ', w: '09:02', k: 'ok' as const },
  { n: 'Dev Patel', t: 'requested 2 days leave', w: '08:47', k: 'warn' as const },
  { n: 'Meera Iyer', t: 'correction approved', w: '08:31', k: 'primary' as const },
  { n: 'Karan Shah', t: 'checked in (outside geofence)', w: '08:15', k: 'danger' as const },
];

/** The hero dashboard. Numbers are sample data for illustration. */
export function DashboardMockup() {
  const nav = [LayoutDashboard, Users, Fingerprint, CalendarDays, Wallet, FileText];
  return (
    <WindowFrame title="HR dashboard">
      <div className="grid grid-cols-[2.5rem_1fr] gap-3 sm:grid-cols-[3rem_1fr] sm:gap-4">
        <div className="flex flex-col items-center gap-3 rounded-xl bg-surface py-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
            {brand.logoMark}
          </span>
          {nav.map((I, i) => (
            <I key={i} className={i === 0 ? 'h-4 w-4 text-link' : 'h-4 w-4 text-muted'} />
          ))}
        </div>
        <div className="min-w-0 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Good morning</p>
              <p className="text-[11px] text-muted">Company overview, today</p>
            </div>
            <Bell className="h-4 w-4 text-muted" />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Total employees" value="248" />
            <Stat label="Present today" value="219" tone="ok" sub="88% of workforce" />
            <Stat label="Absent" value="14" tone="danger" />
            <Stat label="Pending leave" value="9" tone="warn" />
          </div>
          <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
            <div className="rounded-xl border border-border p-3">
              <p className="text-xs font-semibold">Attendance overview</p>
              <div className="mt-3 flex h-24 items-end gap-1.5">
                {bars.map((h, i) => (
                  <span
                    key={i}
                    className="flex-1 rounded-t bg-primary/80"
                    style={{ height: `${h}%`, opacity: i === 7 ? 1 : 0.55 }}
                  />
                ))}
              </div>
              <div className="mt-1.5 flex justify-between text-[9px] text-muted">
                <span>Mon</span>
                <span>Fri</span>
                <span>Mon</span>
                <span>Fri</span>
              </div>
            </div>
            <div className="rounded-xl border border-border p-3">
              <p className="text-xs font-semibold">Recent activity</p>
              <ul className="mt-2 space-y-2">
                {activity.map((a) => (
                  <li key={a.n} className="flex items-center gap-2">
                    <Avatar name={a.n} />
                    <p className="min-w-0 flex-1 truncate text-[11px]">
                      <span className="font-medium">{a.n}</span>{' '}
                      <span className="text-muted">{a.t}</span>
                    </p>
                    <Pill tone={a.k}>{a.w}</Pill>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </WindowFrame>
  );
}
