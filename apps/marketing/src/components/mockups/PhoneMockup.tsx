import { CalendarDays, Clock, MapPin, Wallet } from 'lucide-react';
import { Avatar, Pill } from './Frame';
import { cn } from '@/lib/utils';

export type PhoneScreen = 'today' | 'history' | 'leave';

/** A phone frame with sample screens that mirror what the mobile app really offers. */
export function PhoneMockup({ screen, className }: { screen: PhoneScreen; className?: string }) {
  return (
    <figure className={cn('w-[15.5rem]', className)}>
      <div
        role="img"
        aria-label={`Illustrative mobile ${screen} screen`}
        className="rounded-[2.2rem] border-[7px] border-inverse bg-background p-3 shadow-hero"
      >
        <div
          aria-hidden
          className="mx-auto mb-3 h-1.5 w-16 rounded-full bg-inverse"
        />
        <div aria-hidden className="min-h-[24rem] space-y-3 text-[11px]">
          {screen === 'today' ? <Today /> : screen === 'history' ? <History /> : <Leave />}
        </div>
      </div>
      <figcaption className="mt-2 text-center text-xs text-muted">
        Illustrative screen with sample data
      </figcaption>
    </figure>
  );
}

function Today() {
  return (
    <>
      <div className="flex items-center gap-2">
        <Avatar name="Asha Rao" />
        <div>
          <p className="font-semibold">Hi, Asha</p>
          <p className="text-muted">Bengaluru HQ</p>
        </div>
      </div>
      <div className="rounded-2xl bg-primary p-4 text-primary-foreground">
        <p className="opacity-80">Today</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">09:02</p>
        <p className="mt-1 flex items-center gap-1 opacity-90">
          <MapPin className="h-3 w-3" />
          Inside office geofence
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-primary px-3 py-2.5 text-center font-semibold text-primary-foreground">
          Check in
        </div>
        <div className="rounded-xl border border-border px-3 py-2.5 text-center font-semibold">
          Check out
        </div>
      </div>
      <ul className="space-y-1.5">
        <li className="flex justify-between rounded-lg bg-surface p-2.5">
          <span className="flex items-center gap-1.5">
            <Clock className="h-3 w-3" />
            Worked
          </span>
          <span className="font-medium">6h 12m</span>
        </li>
        <li className="flex justify-between rounded-lg bg-surface p-2.5">
          <span className="flex items-center gap-1.5">
            <CalendarDays className="h-3 w-3" />
            Leave balance
          </span>
          <span className="font-medium">8 days</span>
        </li>
      </ul>
    </>
  );
}
function History() {
  const rows = [
    ['Mon 10', '09:02 - 18:10', 'ok', 'Present'],
    ['Tue 11', '09:41 - 18:30', 'warn', 'Late'],
    ['Wed 12', '—', 'danger', 'Absent'],
    ['Thu 13', '08:55 - 17:58', 'ok', 'Present'],
    ['Fri 14', '09:10 - 18:02', 'ok', 'Present'],
  ] as const;
  return (
    <>
      <p className="text-sm font-semibold">Attendance history</p>
      <ul className="space-y-1.5">
        {rows.map(([d, t, k, s]) => (
          <li key={d} className="flex items-center justify-between rounded-lg bg-surface p-2.5">
            <div>
              <p className="font-medium">{d}</p>
              <p className="text-muted">{t}</p>
            </div>
            <Pill tone={k}>{s}</Pill>
          </li>
        ))}
      </ul>
      <p className="rounded-lg border border-dashed border-border p-2.5 text-center text-muted">
        Request a correction
      </p>
    </>
  );
}
function Leave() {
  return (
    <>
      <p className="text-sm font-semibold">Apply for leave</p>
      <div className="space-y-2">
        <div className="rounded-lg border border-border p-2.5">
          <p className="text-muted">Type</p>
          <p className="font-medium">Casual leave</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-border p-2.5">
            <p className="text-muted">From</p>
            <p className="font-medium">12 Mar</p>
          </div>
          <div className="rounded-lg border border-border p-2.5">
            <p className="text-muted">To</p>
            <p className="font-medium">13 Mar</p>
          </div>
        </div>
      </div>
      <div className="rounded-xl bg-primary px-3 py-2.5 text-center font-semibold text-primary-foreground">
        Submit request
      </div>
      <div className="flex items-center gap-2 rounded-lg bg-surface p-2.5">
        <Wallet className="h-3.5 w-3.5 text-link" />
        <span>Payslips are in More</span>
      </div>
    </>
  );
}
