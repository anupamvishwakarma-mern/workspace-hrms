'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/components/auth';
import { Pager } from '@/components/pager';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import {
  Alert,
  Badge,
  Card,
  Empty,
  PageHeader,
  Skeleton,
  Table,
  Td,
  Th,
  statusTone,
} from '@/components/ui/display';
import { Field, Input, Select } from '@/components/ui/form';
import { useList, useOne } from '@/hooks/api';
import { useDepartments, useTenant } from '@/hooks/lookups';
import { userMessage } from '@/lib/errors';
import type { DayRow } from '@/lib/types';
import { addDaysIso, formatDate, formatMinutes, formatTime, label, todayIso } from '@/lib/utils';

const STATUSES = [
  'PRESENT',
  'HALF_DAY',
  'ABSENT',
  'ON_LEAVE',
  'HOLIDAY',
  'WEEKLY_OFF',
  'INCOMPLETE',
];
const LIMIT = 25;

export default function AttendancePage() {
  const { can } = useAuth();
  const tenant = useTenant();
  const tz = tenant.data?.data.timezone ?? 'UTC';
  const [from, setFrom] = useState<string>();
  const [to, setTo] = useState<string>();
  const [departmentId, setDepartmentId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string>();
  const depts = useDepartments();

  const end = to ?? (tenant.data ? todayIso(tz) : undefined);
  const start = from ?? (end ? addDaysIso(end, -6) : undefined);
  const q = useList<DayRow>(
    'days',
    '/attendance/days',
    { from: start, to: end, departmentId, status, page, limit: LIMIT },
    !!start && !!end,
  );

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Daily attendance for the people you can see. Times are shown in the company timezone."
      />
      <Card className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="From">
          {(id) => (
            <Input
              id={id}
              type="date"
              value={start ?? ''}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
          )}
        </Field>
        <Field label="To">
          {(id) => (
            <Input
              id={id}
              type="date"
              value={end ?? ''}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
          )}
        </Field>
        <Field label="Department">
          {(id) => (
            <Select
              id={id}
              value={departmentId}
              onChange={(e) => {
                setDepartmentId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              {depts.items.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Status">
          {(id) => (
            <Select
              id={id}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Any</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </Card>

      {q.isError ? <Alert tone="danger">{userMessage(q.error)}</Alert> : null}
      {q.isPending ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <Table aria-label="Attendance days">
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Employee</Th>
                <Th>Status</Th>
                <Th>In</Th>
                <Th>Out</Th>
                <Th>Worked</Th>
                <Th>Late</Th>
                <Th>Overtime</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {q.data?.data.map((d) => (
                <tr key={d.id}>
                  <Td>{formatDate(d.workDate)}</Td>
                  <Td>
                    {d.employee ? `${d.employee.firstName} ${d.employee.lastName}` : '—'}
                    <span className="ml-1 text-xs text-muted">{d.employee?.employeeCode}</span>
                  </Td>
                  <Td>
                    <Badge tone={statusTone(d.status)}>{label(d.status)}</Badge>
                    {d.correctionStatus === 'PENDING' ? (
                      <span className="ml-1">
                        <Badge tone="warn">Correction pending</Badge>
                      </span>
                    ) : null}
                  </Td>
                  <Td>{formatTime(d.firstCheckIn, tz)}</Td>
                  <Td>{d.isOpen ? 'working' : formatTime(d.lastCheckOut, tz)}</Td>
                  <Td>{formatMinutes(d.workedMinutes)}</Td>
                  <Td>{d.lateMinutes ? formatMinutes(d.lateMinutes) : '—'}</Td>
                  <Td>{d.overtimeMinutes ? formatMinutes(d.overtimeMinutes) : '—'}</Td>
                  <Td>
                    {can('attendance:events:read') ? (
                      <Button size="sm" variant="secondary" onClick={() => setOpenId(d.id)}>
                        Details
                      </Button>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {q.data?.data.length === 0 ? <Empty>No attendance in this range.</Empty> : null}
          <Pager page={page} limit={LIMIT} total={q.data?.meta?.total ?? 0} onPage={setPage} />
        </>
      )}
      {openId ? <DayDetail id={openId} tz={tz} onClose={() => setOpenId(undefined)} /> : null}
    </>
  );
}

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

function DayDetail({ id, tz, onClose }: { id: string; tz: string; onClose: () => void }) {
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
