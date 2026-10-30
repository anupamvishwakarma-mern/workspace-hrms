'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Alert, Badge, Skeleton, statusTone } from '@/components/ui/display';
import { useOne } from '@/hooks/api';
import { userMessage } from '@/lib/errors';
import type { DayRow } from '@/lib/types';
import { formatDate, formatTime, label } from '@/lib/utils';

interface Detail extends DayRow {
  events: {
    id: string;
    eventType: string;
    occurredAt: string;
    source?: string;
    verification?: {
      status?: string;
      distanceMeters?: number;
      riskSignals?: { mockLocationDetected?: boolean };
    };
    locationAccuracyMeters?: number;
    hasPhoto?: boolean;
    location?: { coordinates?: number[] };
  }[];
  corrections: {
    id: string;
    status: string;
    reason: string;
    requestedChanges?: { checkIn?: string; checkOut?: string };
  }[];
  exceptions: {
    id: string;
    status: string;
    eventType: string;
    employeeReason?: string;
    failure?: string;
  }[];
}

export function DayDetail({ id, tz, onClose }: { id: string; tz: string; onClose: () => void }) {
  const q = useOne<Detail>('day', `/attendance/days/${id}`);
  const d = q.data?.data;
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={
        d?.employee
          ? `${d.employee.firstName} ${d.employee.lastName} · ${formatDate(d.workDate)}`
          : 'Attendance details'
      }
      description="Punches are never edited. Location is shown as the server's verification result, not as proof of presence."
    >
      {q.isPending ? (
        <Skeleton className="h-32" />
      ) : q.isError ? (
        <Alert tone="danger">{userMessage(q.error)}</Alert>
      ) : d ? (
        <div className="space-y-4 text-sm">
          <section>
            <h3 className="mb-1 font-semibold">Punches</h3>
            {d.events.length === 0 ? (
              <p className="text-muted">No punches.</p>
            ) : (
              <ul className="space-y-1">
                {d.events.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-2">
                    <span className="w-14 tabular-nums">{formatTime(e.occurredAt, tz)}</span>
                    <span>{label(e.eventType)}</span>
                    <Badge
                      tone={e.verification?.status === 'EXCEPTION_APPROVED' ? 'warn' : 'success'}
                    >
                      {label(e.verification?.status ?? 'unknown')}
                    </Badge>
                    {e.verification?.distanceMeters !== undefined ? (
                      <span className="text-xs text-muted">
                        {Math.round(e.verification.distanceMeters)} m from site, ±
                        {Math.round(e.locationAccuracyMeters ?? 0)} m
                      </span>
                    ) : null}
                    {e.verification?.riskSignals?.mockLocationDetected ? (
                      <Badge tone="danger">Mock location reported</Badge>
                    ) : null}
                    <PunchProof event={e} />
                  </li>
                ))}
              </ul>
            )}
          </section>
          {d.corrections.length ? (
            <section>
              <h3 className="mb-1 font-semibold">Corrections</h3>
              <ul className="space-y-1">
                {d.corrections.map((c) => (
                  <li key={c.id}>
                    <Badge tone={statusTone(c.status)}>{label(c.status)}</Badge> In{' '}
                    {formatTime(c.requestedChanges?.checkIn, tz)} · Out{' '}
                    {formatTime(c.requestedChanges?.checkOut, tz)} — {c.reason}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {d.exceptions.length ? (
            <section>
              <h3 className="mb-1 font-semibold">Location approvals</h3>
              <ul className="space-y-1">
                {d.exceptions.map((x) => (
                  <li key={x.id}>
                    <Badge tone={statusTone(x.status)}>{label(x.status)}</Badge>{' '}
                    {label(x.eventType)} — {x.employeeReason}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

/** Where a punch was recorded (opens a map in a new tab on click) and its proof photo, loaded on demand. */
function PunchProof({ event }: { event: Detail['events'][number] }) {
  const [photo, setPhoto] = useState<{ url?: string; error?: string; loading?: boolean }>();
  const c = event.location?.coordinates;
  const [lng, lat] = c && c.length === 2 ? c : [];
  async function load() {
    setPhoto({ loading: true });
    try {
      const r = await api.get<{ url: string }>(`/attendance/events/${event.id}/photo`);
      setPhoto({ url: r.data.url });
    } catch (e) {
      setPhoto({ error: userMessage(e) });
    }
  }
  if (lat === undefined && !event.hasPhoto) return null;
  return (
    <div className="basis-full space-y-2 pl-14 text-xs text-muted">
      {lat !== undefined && lng !== undefined ? (
        <p>
          {lat.toFixed(5)}, {lng.toFixed(5)} ·{' '}
          <a
            className="font-medium text-primary underline"
            href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View on map
          </a>
        </p>
      ) : null}
      {event.hasPhoto ? (
        photo?.url ? (
          <img
            src={photo.url}
            alt="Proof photo for this punch"
            className="h-48 w-48 rounded-xl border border-border object-cover"
          />
        ) : (
          <div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void load()}
              disabled={photo?.loading}
            >
              {photo?.loading ? 'Loading…' : 'View photo'}
            </Button>
            {photo?.error ? <span className="ml-2 text-danger">{photo.error}</span> : null}
          </div>
        )
      ) : null}
    </div>
  );
}
