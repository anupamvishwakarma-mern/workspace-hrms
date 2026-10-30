'use client';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import {
  Alert,
  Badge,
  Card,
  CardTitle,
  Empty,
  Skeleton,
  Table,
  Td,
  Th,
} from '@/components/ui/display';
import { Field, Input, Select } from '@/components/ui/form';
import { useAuth } from '@/components/auth';
import { useList, useSave } from '@/hooks/api';
import { useDepartments } from '@/hooks/lookups';
import { api } from '@/lib/api';
import type { Holiday, Shift, ShiftAssignment, WorkLocation } from '@/lib/types';
import { formatDate } from '@/lib/utils';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const num = (v: string) => (v === '' ? undefined : Number(v));

/** All of the caller's company assignments, fetched page by page (the API caps a page at 100). */
function useAllAssignments() {
  const tenant = useAuth().active?.tenantId ?? 'none';
  return useQuery({
    queryKey: ['assignments-all', tenant],
    enabled: tenant !== 'none',
    queryFn: async () => {
      const all: ShiftAssignment[] = [];
      for (let page = 1; page <= 10; page++) {
        const r = await api.get<ShiftAssignment[]>('/shift-assignments', { page, limit: 100 });
        all.push(...r.data);
        if (all.length >= (r.meta?.total ?? 0)) break;
      }
      return all;
    },
  });
}

/* ------------------------------ shift master ------------------------------ */

export function ShiftMaster({ today }: { today: string }) {
  const shifts = useList<Shift>('shifts', '/shifts', { limit: 100 });
  const assigns = useAllAssignments();
  const [creating, setCreating] = useState(false);
  const active = (assigns.data ?? []).filter(
    (a) => a.effectiveFrom <= today && (!a.effectiveTo || a.effectiveTo >= today),
  );
  const count = (id: string) => active.filter((a) => a.shiftId === id).length;
  return (
    <Card>
      <CardTitle className="text-base text-foreground">Shift master</CardTitle>
      <p className="mb-3 text-xs text-muted">
        {active.length} employees currently assigned across {shifts.data?.data.length ?? 0} shifts
      </p>
      {shifts.isPending ? (
        <Skeleton className="h-32" />
      ) : (
        <Table aria-label="Shifts">
          <thead>
            <tr>
              <Th>Shift</Th>
              <Th>Timing</Th>
              <Th>Grace</Th>
              <Th>Assigned</Th>
            </tr>
          </thead>
          <tbody>
            {(shifts.data?.data ?? []).map((s) => (
              <tr key={s.id}>
                <Td className="font-medium">
                  {s.name}
                  {s.status !== 'ACTIVE' ? (
                    <span className="ml-2">
                      <Badge>Inactive</Badge>
                    </span>
                  ) : null}
                </Td>
                <Td className="whitespace-nowrap tabular-nums">
                  {s.startTime} – {s.endTime}
                </Td>
                <Td>{s.graceMinutes ? `${s.graceMinutes} min` : 'None'}</Td>
                <Td>{count(s.id)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <div className="mt-3">
        <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
          Create new shift
        </Button>
      </div>
      {creating ? <CreateShift today={today} onClose={() => setCreating(false)} /> : null}
    </Card>
  );
}

function CreateShift({ today, onClose }: { today: string; onClose: () => void }) {
  const [f, setF] = useState({
    name: '',
    startTime: '09:30',
    endTime: '18:30',
    grace: '15',
    early: '0',
    full: '8',
    half: '4',
    off: [0] as number[],
  });
  const save = useSave(
    () =>
      api.post('/shifts', {
        name: f.name.trim(),
        startTime: f.startTime,
        endTime: f.endTime,
        graceMinutes: Number(f.grace),
        earlyDepartureGraceMinutes: Number(f.early),
        minFullDayMinutes: Math.round(Number(f.full) * 60),
        minHalfDayMinutes: Math.round(Number(f.half) * 60),
        weeklyOffDays: f.off,
        effectiveFrom: today,
      }),
    ['shifts', 'assignments-all'],
    onClose,
  );
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Create shift"
      description="Use an end time earlier than the start for an overnight shift."
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <Field label="Name">
          {(id) => (
            <Input
              id={id}
              required
              maxLength={120}
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts">
            {(id) => (
              <Input
                id={id}
                type="time"
                required
                value={f.startTime}
                onChange={(e) => setF({ ...f, startTime: e.target.value })}
              />
            )}
          </Field>
          <Field label="Ends">
            {(id) => (
              <Input
                id={id}
                type="time"
                required
                value={f.endTime}
                onChange={(e) => setF({ ...f, endTime: e.target.value })}
              />
            )}
          </Field>
          <Field label="Grace (min)">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0}
                max={240}
                value={f.grace}
                onChange={(e) => setF({ ...f, grace: e.target.value })}
              />
            )}
          </Field>
          <Field label="Early-exit grace (min)">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0}
                max={240}
                value={f.early}
                onChange={(e) => setF({ ...f, early: e.target.value })}
              />
            )}
          </Field>
          <Field label="Full day (net hours)">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                max={24}
                step="0.25"
                value={f.full}
                onChange={(e) => setF({ ...f, full: e.target.value })}
              />
            )}
          </Field>
          <Field label="Half day (net hours)">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0.25}
                max={24}
                step="0.25"
                value={f.half}
                onChange={(e) => setF({ ...f, half: e.target.value })}
              />
            )}
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">Weekly off</legend>
          <div className="flex flex-wrap gap-3 text-sm">
            {DAYS.map((d, i) => (
              <label key={d} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={f.off.includes(i)}
                  onChange={(e) =>
                    setF({
                      ...f,
                      off: e.target.checked ? [...f.off, i] : f.off.filter((x) => x !== i),
                    })
                  }
                />
                {d.slice(0, 3)}
              </label>
            ))}
          </div>
        </fieldset>
        {save.error ? <Alert tone="danger">{save.error}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Create shift
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ----------------------------- bulk assignment ----------------------------- */

export function BulkAssign({ today }: { today: string }) {
  const depts = useDepartments();
  const shifts = useList<Shift>('shifts', '/shifts', { limit: 100, status: 'ACTIVE' });
  const [departmentId, setDepartmentId] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [from, setFrom] = useState(today);
  const [done, setDone] = useState(false);
  const save = useSave(
    () => api.post('/shift-assignments', { shiftId, departmentId, effectiveFrom: from }),
    ['assignments-all', 'my-assignments'],
    () => setDone(true),
  );
  return (
    <Card>
      <CardTitle className="text-base text-foreground">Bulk shift assignment</CardTitle>
      <p className="mb-3 text-xs text-muted">Assign a shift to every employee in a department.</p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setDone(false);
          save.mutate(undefined);
        }}
      >
        <Field label="Department">
          {(id) => (
            <Select
              id={id}
              required
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              <option value="">Select…</option>
              {depts.items.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Shift">
            {(id) => (
              <Select id={id} required value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
                <option value="">Select…</option>
                {(shifts.data?.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Effective from">
            {(id) => (
              <Input
                id={id}
                type="date"
                required
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            )}
          </Field>
        </div>
        {save.error ? <Alert tone="danger">{save.error}</Alert> : null}
        {done ? <Alert tone="success">Shift assigned.</Alert> : null}
        <Button type="submit" className="w-full" loading={save.isPending}>
          Assign shift
        </Button>
      </form>
    </Card>
  );
}

/* ----------------------------- policy settings ----------------------------- */

export function PolicySettings() {
  const shifts = useList<Shift>('shifts', '/shifts', { limit: 100 });
  const [id, setId] = useState('');
  const s = shifts.data?.data.find((x) => x.id === (id || shifts.data?.data[0]?.id));
  const blank = { grace: '', early: '', full: '', half: '', brk: '', ot: '', off: [] as number[] };
  const [f, setF] = useState(blank);
  const [saved, setSaved] = useState(false);
  const load = (x: Shift | undefined) =>
    setF(
      x
        ? {
            grace: String(x.graceMinutes ?? ''),
            early: String(x.earlyDepartureGraceMinutes ?? ''),
            full: x.minFullDayMinutes ? String(x.minFullDayMinutes / 60) : '',
            half: x.minHalfDayMinutes ? String(x.minHalfDayMinutes / 60) : '',
            brk: String(x.breakPolicy?.autoDeductMinutes ?? ''),
            ot: String(x.overtimePolicy?.thresholdMinutes ?? ''),
            off: x.weeklyOffDays,
          }
        : blank,
    );
  useEffect(() => load(s), [s?.id, shifts.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useSave(
    () =>
      api.patch(`/shifts/${s!.id}`, {
        ...(num(f.grace) !== undefined ? { graceMinutes: num(f.grace) } : {}),
        ...(num(f.early) !== undefined ? { earlyDepartureGraceMinutes: num(f.early) } : {}),
        ...(num(f.full) !== undefined
          ? { minFullDayMinutes: Math.round(Number(f.full) * 60) }
          : {}),
        ...(num(f.half) !== undefined
          ? { minHalfDayMinutes: Math.round(Number(f.half) * 60) }
          : {}),
        ...(num(f.brk) !== undefined
          ? { breakPolicy: { type: 'AUTO_DEDUCT', autoDeductMinutes: num(f.brk) } }
          : {}),
        ...(num(f.ot) !== undefined
          ? { overtimePolicy: { enabled: Number(f.ot) > 0, thresholdMinutes: num(f.ot) } }
          : {}),
        weeklyOffDays: f.off,
      }),
    ['shifts'],
    () => setSaved(true),
  );
  return (
    <Card>
      <CardTitle className="text-base text-foreground">Attendance policy settings</CardTitle>
      <p className="mb-3 text-xs text-muted">
        Rules live on each shift. Saving changes the shift for everyone assigned to it.
      </p>
      {shifts.isPending ? (
        <Skeleton className="h-40" />
      ) : !s ? (
        <Empty>Create a shift first.</Empty>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setSaved(false);
            save.mutate(undefined);
          }}
        >
          <Field label="Shift">
            {(fid) => (
              <Select
                id={fid}
                value={s.id}
                onChange={(e) => {
                  setId(e.target.value);
                  setSaved(false);
                }}
              >
                {(shifts.data?.data ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Grace period (min)">
              {(i) => (
                <Input
                  id={i}
                  type="number"
                  min={0}
                  max={240}
                  value={f.grace}
                  onChange={(e) => setF({ ...f, grace: e.target.value })}
                />
              )}
            </Field>
            <Field label="Early-exit grace (min)">
              {(i) => (
                <Input
                  id={i}
                  type="number"
                  min={0}
                  max={240}
                  value={f.early}
                  onChange={(e) => setF({ ...f, early: e.target.value })}
                />
              )}
            </Field>
            <Field label="Break deduction (min)">
              {(i) => (
                <Input
                  id={i}
                  type="number"
                  min={0}
                  max={480}
                  value={f.brk}
                  onChange={(e) => setF({ ...f, brk: e.target.value })}
                />
              )}
            </Field>
            <Field label="Full day, net hours">
              {(i) => (
                <Input
                  id={i}
                  type="number"
                  min={1}
                  max={24}
                  step="0.25"
                  value={f.full}
                  onChange={(e) => setF({ ...f, full: e.target.value })}
                />
              )}
            </Field>
            <Field label="Half day, net hours">
              {(i) => (
                <Input
                  id={i}
                  type="number"
                  min={0.25}
                  max={24}
                  step="0.25"
                  value={f.half}
                  onChange={(e) => setF({ ...f, half: e.target.value })}
                />
              )}
            </Field>
            <Field label="Overtime after (min)" hint="0 turns overtime off">
              {(i) => (
                <Input
                  id={i}
                  type="number"
                  min={0}
                  max={600}
                  value={f.ot}
                  onChange={(e) => setF({ ...f, ot: e.target.value })}
                />
              )}
            </Field>
          </div>
          <fieldset>
            <legend className="mb-1 text-sm font-medium">Weekly off</legend>
            <div className="flex flex-wrap gap-3 text-sm">
              {DAYS.map((d, i) => (
                <label key={d} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={f.off.includes(i)}
                    onChange={(e) =>
                      setF({
                        ...f,
                        off: e.target.checked ? [...f.off, i] : f.off.filter((x) => x !== i),
                      })
                    }
                  />
                  {d.slice(0, 3)}
                </label>
              ))}
            </div>
          </fieldset>
          {save.error ? <Alert tone="danger">{save.error}</Alert> : null}
          {saved ? <Alert tone="success">Policy saved.</Alert> : null}
          <div className="flex gap-2">
            <Button type="submit" loading={save.isPending}>
              Save policy
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                load(s);
                setSaved(false);
                save.clearError();
              }}
            >
              Discard changes
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

/* ----------------------------- sites + holidays ----------------------------- */

export function SitesCard() {
  const locs = useList<WorkLocation>('work-locations', '/work-locations', { limit: 50 });
  return (
    <Card>
      <CardTitle className="mb-2 text-base text-foreground">Work locations</CardTitle>
      <p className="mb-2 text-xs text-muted">
        Where employees can punch. Geo-fence radius is set per location.
      </p>
      {locs.isPending ? (
        <Skeleton className="h-24" />
      ) : (locs.data?.data.length ?? 0) === 0 ? (
        <Empty>No work locations yet.</Empty>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {locs.data?.data.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 py-2.5">
              <span>
                <span className="font-medium">{l.name}</span>
                <span className="block text-xs text-muted">
                  {l.radiusMeters} m radius{l.address ? ` · ${l.address}` : ''}
                </span>
              </span>
              <Badge tone={l.status === 'ACTIVE' ? 'success' : 'neutral'}>
                {l.status === 'ACTIVE' ? 'Active' : 'Inactive'}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function HolidayCalendar({ today }: { today: string }) {
  const { can } = useAuth();
  const q = useList<Holiday>('holidays-upcoming', '/holidays', { from: today, limit: 12 });
  const [adding, setAdding] = useState(false);
  return (
    <Card>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base text-foreground">Holiday calendar</CardTitle>
          <p className="text-xs text-muted">Applies to all locations unless marked</p>
        </div>
        {can('holiday:manage') ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            Add holiday
          </Button>
        ) : null}
      </div>
      {q.isPending ? (
        <Skeleton className="h-24" />
      ) : (q.data?.data.length ?? 0) === 0 ? (
        <Empty>No upcoming holidays.</Empty>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {q.data?.data.map((h) => (
            <li key={h.id} className="flex justify-between gap-3 py-2">
              <span className="font-medium">{h.name}</span>
              <span className="text-muted">{formatDate(h.date)}</span>
            </li>
          ))}
        </ul>
      )}
      {adding ? <AddHoliday onClose={() => setAdding(false)} /> : null}
    </Card>
  );
}

function AddHoliday({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ name: '', date: '', holidayType: 'PUBLIC' });
  const save = useSave(
    () => api.post('/holidays', f),
    ['holidays-upcoming', 'holidays-roster'],
    onClose,
  );
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Add holiday">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <Field label="Name">
          {(id) => (
            <Input
              id={id}
              required
              maxLength={120}
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          )}
        </Field>
        <Field label="Date">
          {(id) => (
            <Input
              id={id}
              type="date"
              required
              value={f.date}
              onChange={(e) => setF({ ...f, date: e.target.value })}
            />
          )}
        </Field>
        <Field label="Type">
          {(id) => (
            <Select
              id={id}
              value={f.holidayType}
              onChange={(e) => setF({ ...f, holidayType: e.target.value })}
            >
              <option value="PUBLIC">Public</option>
              <option value="COMPANY">Company</option>
              <option value="OPTIONAL">Optional</option>
            </Select>
          )}
        </Field>
        {save.error ? <Alert tone="danger">{save.error}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Add
          </Button>
        </div>
      </form>
    </Modal>
  );
}
