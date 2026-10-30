'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { PageTop } from '@/components/page-top';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Alert, Badge, Empty, Skeleton, Table, Td, Th, statusTone } from '@/components/ui/display';
import { Field, Input, Select } from '@/components/ui/form';
import { useList, useSave } from '@/hooks/api';
import { useDepartments } from '@/hooks/lookups';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import type { Employee, Shift } from '@/lib/types';
import { WEEKDAYS, label } from '@/lib/utils';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');
const n = (max: number) =>
  z.coerce
    .number({ message: 'Enter a number' })
    .int('Whole number')
    .min(0, 'Min 0')
    .max(max, `Max ${max}`);
const schema = z
  .object({
    name: z.string().trim().min(1, 'Required').max(120),
    shiftType: z.enum(['FIXED', 'FLEXIBLE']),
    startTime: hhmm,
    endTime: hhmm,
    graceMinutes: n(240),
    earlyDepartureGraceMinutes: n(240),
    minFullDayMinutes: z.coerce
      .number({ message: 'Enter a number' })
      .int()
      .min(1, 'Min 1')
      .max(1440),
    minHalfDayMinutes: z.coerce
      .number({ message: 'Enter a number' })
      .int()
      .min(1, 'Min 1')
      .max(1440),
    breakType: z.enum(['RECORDED', 'AUTO_DEDUCT']),
    paidAllowanceMinutes: n(480),
    autoDeductMinutes: n(480),
    weeklyOffDays: z.array(z.number()),
    status: z.enum(['ACTIVE', 'INACTIVE']),
  })
  .refine((v) => v.startTime !== v.endTime, {
    path: ['endTime'],
    message: 'Must differ from start (earlier end = overnight shift)',
  })
  .refine((v) => v.minHalfDayMinutes <= v.minFullDayMinutes, {
    path: ['minHalfDayMinutes'],
    message: 'Cannot exceed full-day minutes',
  });
type In = z.input<typeof schema>;
type Out = z.output<typeof schema>;

export default function ShiftsPage() {
  const [editing, setEditing] = useState<Shift | 'new'>();
  const [assigning, setAssigning] = useState<Shift>();
  const q = useList<Shift>('shifts', '/shifts', { limit: 100 });
  return (
    <>
      <PageTop
        scope="shift rules"
        stats={[
          { label: 'Shifts', value: q.data?.data.length ?? '…' },
          {
            label: 'Overnight',
            value: q.data ? q.data.data.filter((s) => s.overnight).length : '…',
          },
          {
            label: 'Average grace',
            value:
              q.data && q.data.data.length
                ? `${Math.round(q.data.data.reduce((n, s) => n + s.graceMinutes, 0) / q.data.data.length)} min`
                : '…',
            sub: 'Before a punch counts as late',
          },
        ]}
        guide={[
          'A shift sets the working hours, the grace period and when a day counts as full, half or short.',
          'Assign shifts to people from a shift. Late, half-day and overtime are worked out from the shift.',
          'Changing a shift only affects days calculated after the change.',
        ]}
        title="Shifts"
        description="Shift rules drive late, half-day and overtime calculations. Changing a shift affects days calculated after the change."
        actions={<Button onClick={() => setEditing('new')}>Add shift</Button>}
      />
      {q.isError ? <Alert tone="danger">{userMessage(q.error)}</Alert> : null}
      {!q.data ? (
        q.isError ? null : (
          <Skeleton className="h-40" />
        )
      ) : (
        <>
          <Table aria-label="Shifts">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Hours</Th>
                <Th>Grace</Th>
                <Th>Full / half day</Th>
                <Th>Weekly off</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {q.data.data.map((s) => (
                <tr key={s.id}>
                  <Td className="font-medium">
                    {s.name}
                    {s.shiftType === 'FLEXIBLE' ? (
                      <span className="ml-2 text-xs font-normal text-muted">Flexible</span>
                    ) : null}
                  </Td>
                  <Td>
                    {s.startTime}–{s.endTime}
                    {s.overnight ? ' (overnight)' : ''}
                  </Td>
                  <Td>
                    {s.shiftType === 'FLEXIBLE'
                      ? 'No late marks'
                      : `${s.graceMinutes}m late · ${s.earlyDepartureGraceMinutes}m early`}
                  </Td>
                  <Td>
                    {s.minFullDayMinutes ?? '—'} / {s.minHalfDayMinutes ?? '—'} min
                  </Td>
                  <Td>{s.weeklyOffDays.map((d) => WEEKDAYS[d]).join(', ') || 'None'}</Td>
                  <Td>
                    <Badge tone={statusTone(s.status)}>{label(s.status)}</Badge>
                  </Td>
                  <Td>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setEditing(s)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setAssigning(s)}>
                        Assign
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {q.data.data.length === 0 ? (
            <Empty>No shifts yet. Employees without a shift are reported as “unscheduled”.</Empty>
          ) : null}
        </>
      )}
      {editing ? (
        <ShiftForm
          shift={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
      {assigning ? <AssignForm shift={assigning} onClose={() => setAssigning(undefined)} /> : null}
    </>
  );
}

function ShiftForm({ shift, onClose }: { shift?: Shift; onClose: () => void }) {
  const f = useForm<In, unknown, Out>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: shift?.name ?? '',
      shiftType: shift?.shiftType ?? 'FIXED',
      startTime: shift?.startTime ?? '09:00',
      endTime: shift?.endTime ?? '18:00',
      graceMinutes: shift?.graceMinutes ?? 10,
      earlyDepartureGraceMinutes: shift?.earlyDepartureGraceMinutes ?? 0,
      minFullDayMinutes: shift?.minFullDayMinutes ?? 480,
      minHalfDayMinutes: shift?.minHalfDayMinutes ?? 240,
      breakType: (shift?.breakPolicy.type as Out['breakType']) ?? 'RECORDED',
      paidAllowanceMinutes: shift?.breakPolicy.paidAllowanceMinutes ?? 0,
      autoDeductMinutes: shift?.breakPolicy.autoDeductMinutes ?? 0,
      weeklyOffDays: shift?.weeklyOffDays ?? [0],
      status: (shift?.status as Out['status']) ?? 'ACTIVE',
    },
  });
  const save = useSave(
    (v: Out) => {
      const body = {
        name: v.name,
        shiftType: v.shiftType,
        startTime: v.startTime,
        endTime: v.endTime,
        graceMinutes: v.graceMinutes,
        earlyDepartureGraceMinutes: v.earlyDepartureGraceMinutes,
        minFullDayMinutes: v.minFullDayMinutes,
        minHalfDayMinutes: v.minHalfDayMinutes,
        breakPolicy: {
          type: v.breakType,
          paidAllowanceMinutes: v.paidAllowanceMinutes,
          autoDeductMinutes: v.autoDeductMinutes,
        },
        weeklyOffDays: [...v.weeklyOffDays].sort(),
      };
      return shift
        ? api.patch(`/shifts/${shift.id}`, { ...body, status: v.status })
        : api.post('/shifts', body);
    },
    ['shifts', 'dashboard'],
    onClose,
  );
  const off = f.watch('weeklyOffDays') ?? [];
  const e = f.formState.errors;
  const num = (
    name:
      | 'graceMinutes'
      | 'earlyDepartureGraceMinutes'
      | 'minFullDayMinutes'
      | 'minHalfDayMinutes'
      | 'paidAllowanceMinutes'
      | 'autoDeductMinutes',
    text: string,
  ) => (
    <Field label={text} error={e[name]?.message}>
      {(id, inv) => <Input id={id} inputMode="numeric" invalid={inv} {...f.register(name)} />}
    </Field>
  );
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={shift ? 'Edit shift' : 'Add shift'}>
      <form onSubmit={f.handleSubmit((v) => save.mutate(v))} className="space-y-3" noValidate>
        {save.error ? <Alert tone="danger">{save.error}</Alert> : null}
        <Field label="Name" error={e.name?.message}>
          {(id, inv) => <Input id={id} invalid={inv} {...f.register('name')} />}
        </Field>
        <Field
          label="Shift type"
          hint="Fixed: arriving after the start time is marked late. Flexible: nobody is marked late or early; the day counts by hours worked, so set the full-day minutes below."
        >
          {(id) => (
            <Select id={id} {...f.register('shiftType')}>
              <option value="FIXED">Fixed hours</option>
              <option value="FLEXIBLE">Flexible hours</option>
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start (HH:mm)" error={e.startTime?.message}>
            {(id, inv) => <Input id={id} type="time" invalid={inv} {...f.register('startTime')} />}
          </Field>
          <Field label="End (HH:mm)" error={e.endTime?.message}>
            {(id, inv) => <Input id={id} type="time" invalid={inv} {...f.register('endTime')} />}
          </Field>
          {num('graceMinutes', 'Late grace (min)')}
          {num('earlyDepartureGraceMinutes', 'Early-leave grace (min)')}
          {num('minFullDayMinutes', 'Full day (min)')}
          {num('minHalfDayMinutes', 'Half day (min)')}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Breaks">
            {(id) => (
              <Select id={id} {...f.register('breakType')}>
                <option value="RECORDED">Recorded</option>
                <option value="AUTO_DEDUCT">Auto-deduct</option>
              </Select>
            )}
          </Field>
          {num('paidAllowanceMinutes', 'Paid break (min)')}
          {num('autoDeductMinutes', 'Auto-deduct (min)')}
        </div>
        <fieldset>
          <legend className="text-sm font-medium">Weekly off</legend>
          <div className="mt-1 flex flex-wrap gap-3">
            {WEEKDAYS.map((d, i) => (
              <label key={d} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={off.includes(i)}
                  onChange={(ev) =>
                    f.setValue(
                      'weeklyOffDays',
                      ev.target.checked ? [...off, i] : off.filter((x) => x !== i),
                      { shouldDirty: true },
                    )
                  }
                />
                {d}
              </label>
            ))}
          </div>
        </fieldset>
        {shift ? (
          <Field label="Status">
            {(id) => (
              <Select id={id} {...f.register('status')}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </Select>
            )}
          </Field>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

const assignSchema = z
  .object({
    target: z.enum(['department', 'employee']),
    departmentId: z.string(),
    employeeId: z.string(),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
    effectiveTo: z.string(),
  })
  .refine((v) => v.target !== 'department' || !!v.departmentId, {
    path: ['departmentId'],
    message: 'Choose a department',
  })
  .refine((v) => v.target !== 'employee' || !!v.employeeId, {
    path: ['employeeId'],
    message: 'Choose an employee',
  })
  .refine((v) => !v.effectiveTo || v.effectiveTo >= v.effectiveFrom, {
    path: ['effectiveTo'],
    message: 'Before start date',
  });
type AForm = z.infer<typeof assignSchema>;

function AssignForm({ shift, onClose }: { shift: Shift; onClose: () => void }) {
  const depts = useDepartments();
  const people = useList<Employee>('employees-lookup', '/employees', {
    limit: 100,
    status: 'ACTIVE',
  });
  const f = useForm<AForm>({
    resolver: zodResolver(assignSchema),
    defaultValues: {
      target: 'department',
      departmentId: '',
      employeeId: '',
      effectiveFrom: new Date().toISOString().slice(0, 10),
      effectiveTo: '',
    },
  });
  const save = useSave(
    (v: AForm) =>
      api.post('/shift-assignments', {
        shiftId: shift.id,
        effectiveFrom: v.effectiveFrom,
        ...(v.effectiveTo ? { effectiveTo: v.effectiveTo } : {}),
        ...(v.target === 'department'
          ? { departmentId: v.departmentId }
          : { employeeIds: [v.employeeId] }),
      }),
    ['shifts', 'dashboard', 'days'],
    onClose,
  );
  const target = f.watch('target');
  const e = f.formState.errors;
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Assign “${shift.name}”`}
      description="Overlapping assignments for the same employee are rejected by the server."
    >
      <form onSubmit={f.handleSubmit((v) => save.mutate(v))} className="space-y-3" noValidate>
        {save.error ? <Alert tone="danger">{save.error}</Alert> : null}
        <Field label="Assign to">
          {(id) => (
            <Select id={id} {...f.register('target')}>
              <option value="department">A department</option>
              <option value="employee">One employee</option>
            </Select>
          )}
        </Field>
        {target === 'department' ? (
          <Field label="Department" error={e.departmentId?.message}>
            {(id, inv) => (
              <Select id={id} invalid={inv} {...f.register('departmentId')}>
                <option value="">Choose…</option>
                {depts.items.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : (
          <Field label="Employee" error={e.employeeId?.message}>
            {(id, inv) => (
              <Select id={id} invalid={inv} {...f.register('employeeId')}>
                <option value="">Choose…</option>
                {people.data?.data.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.firstName} {p.lastName} ({p.employeeCode})
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" error={e.effectiveFrom?.message}>
            {(id, inv) => (
              <Input id={id} type="date" invalid={inv} {...f.register('effectiveFrom')} />
            )}
          </Field>
          <Field label="To (optional)" error={e.effectiveTo?.message}>
            {(id, inv) => (
              <Input id={id} type="date" invalid={inv} {...f.register('effectiveTo')} />
            )}
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Assign
          </Button>
        </div>
      </form>
    </Modal>
  );
}
