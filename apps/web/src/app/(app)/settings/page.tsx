'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { PageTop } from '@/components/page-top';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { DatabaseSettings } from '@/components/database-settings';
import { Button } from '@/components/ui/button';
import { Alert, Card, Skeleton } from '@/components/ui/display';
import { Field, Input } from '@/components/ui/form';
import { useSave } from '@/hooks/api';
import { useTenant } from '@/hooks/lookups';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import { WEEKDAYS } from '@/lib/utils';

const schema = z.object({
  name: z.string().trim().min(2, 'Enter at least 2 characters').max(120),
  timezone: z.string().trim().min(1, 'Required'),
  workweek: z.array(z.number()).min(1, 'Pick at least one working day'),
  requireGeofence: z.boolean(),
  allowSelfApproval: z.boolean(),
  requireSeparatePublisher: z.boolean(),
  autoLeave: z.boolean(),
  empPrefix: z.string().trim().regex(/^[A-Za-z0-9\-_/]{0,10}$/, 'Up to 10 letters, digits, - _ or /'),
  empPadding: z.coerce.number().int().min(1, 'Min 1').max(8, 'Max 8'),
  ltrPrefix: z.string().trim().regex(/^[A-Za-z0-9\-_/]{0,10}$/, 'Up to 10 letters, digits, - _ or /'),
  ltrPadding: z.coerce.number().int().min(1, 'Min 1').max(8, 'Max 8'),
  docPrefix: z.string().trim().regex(/^[A-Za-z0-9\-_/]{0,10}$/, 'Up to 10 letters, digits, - _ or /'),
  docPadding: z.coerce.number().int().min(1, 'Min 1').max(8, 'Max 8'),
  allowGpsExceptions: z.boolean(),
  requirePhoto: z.boolean(),
  maxAccuracyMeters: z.coerce.number().int().min(5, 'Min 5').max(500, 'Max 500'),
  maxOpenSessionHours: z.coerce.number().int().min(4, 'Min 4').max(24, 'Max 24'),
});
type Form = z.input<typeof schema>;
type Out = z.output<typeof schema>;

export default function SettingsPage() {
  const q = useTenant();
  const t = q.data?.data;
  const f = useForm<Form, unknown, Out>({
    resolver: zodResolver(schema),
    defaultValues: { workweek: [1, 2, 3, 4, 5] },
  });
  useEffect(() => {
    if (!t) return;
    const a = t.settings?.attendance ?? {};
    f.reset({
      name: t.name,
      timezone: t.timezone,
      workweek: t.workweek,
      requireGeofence: a.requireGeofence ?? true,
      allowSelfApproval: a.allowSelfApproval ?? false,
      requireSeparatePublisher: t.settings?.payroll?.requireSeparatePublisher ?? false,
      autoLeave: t.settings?.leave?.autoAccrual ?? false,
      empPrefix: t.numbering?.employee.prefix ?? 'EMP-',
      empPadding: t.numbering?.employee.padding ?? 4,
      ltrPrefix: t.numbering?.letter.prefix ?? 'LTR-',
      ltrPadding: t.numbering?.letter.padding ?? 4,
      docPrefix: t.numbering?.document?.prefix ?? 'DOC-',
      docPadding: t.numbering?.document?.padding ?? 4,
      allowGpsExceptions: a.allowGpsExceptions ?? true,
      requirePhoto: a.requirePhoto ?? false,
      maxAccuracyMeters: a.maxAccuracyMeters ?? 100,
      maxOpenSessionHours: a.maxOpenSessionHours ?? 16,
    });
  }, [t, f]);
  const payrollOn = t?.modules?.includes('PAYROLL') ?? true;
  const leaveOn = t?.modules?.includes('LEAVE') ?? true;
  const save = useSave(
    (v: Out) =>
      api.patch('/tenants/current', {
        name: v.name,
        timezone: v.timezone,
        workweek: [...v.workweek].sort(),
        settings: {
          attendance: {
            requireGeofence: v.requireGeofence,
            allowSelfApproval: v.allowSelfApproval,
            allowGpsExceptions: v.allowGpsExceptions,
            requirePhoto: v.requirePhoto,
            maxAccuracyMeters: v.maxAccuracyMeters,
            maxOpenSessionHours: v.maxOpenSessionHours,
          },
          ...(leaveOn ? { leave: { autoAccrual: v.autoLeave } } : {}),
          ...(payrollOn ? { payroll: { requireSeparatePublisher: v.requireSeparatePublisher } } : {}),
          numbering: {
            employee: { prefix: v.empPrefix, padding: v.empPadding },
            letter: { prefix: v.ltrPrefix, padding: v.ltrPadding },
            document: { prefix: v.docPrefix, padding: v.docPadding },
          },
        },
      }),
    ['tenant', 'dashboard', 'days', 'summary'],
  );
  const week = f.watch('workweek') ?? [];
  const e = f.formState.errors;
  if (q.isPending) return <Skeleton className="h-64" />;
  if (q.isError) return <Alert tone="danger">{userMessage(q.error)}</Alert>;

  return (
    <>
      <PageTop
        scope="company policy"
        stats={[
          { label: 'Time zone', value: q.data?.data.timezone ?? '…' },
          {
            label: 'Working days',
            value: q.data ? q.data.data.workweek.map((d) => WEEKDAYS[d]).join(', ') : '…',
          },
          {
            label: 'Geofence',
            value: q.data
              ? q.data.data.settings?.attendance?.requireGeofence
                ? 'Required'
                : 'Not required'
              : '…',
          },
        ]}
        guide={[
          'Company profile and attendance policy for everyone in the company.',
          'Working days decide weekly offs, and which days leave is charged.',
          'Changes apply to new punches and new reports. Past days are not recalculated.',
        ]}
        title="Settings"
        description="Company profile and attendance policy. Changes apply to new punches and new reports."
      />
      <form
        onSubmit={f.handleSubmit((v) => save.mutate(v))}
        className="max-w-2xl space-y-4"
        noValidate
      >
        {save.error ? <Alert tone="danger">{save.error}</Alert> : null}
        {save.isSuccess && !f.formState.isDirty ? (
          <Alert tone="success">Settings saved.</Alert>
        ) : null}
        <Card className="space-y-3">
          <Field label="Company name" error={e.name?.message}>
            {(id, inv) => <Input id={id} invalid={inv} {...f.register('name')} />}
          </Field>
          <Field
            label="Time zone (IANA)"
            hint="e.g. Asia/Kolkata. Day boundaries and reports use this zone."
            error={e.timezone?.message}
          >
            {(id, inv) => <Input id={id} invalid={inv} {...f.register('timezone')} />}
          </Field>
          <fieldset>
            <legend className="text-sm font-medium">Working days</legend>
            <div className="mt-1 flex flex-wrap gap-3">
              {WEEKDAYS.map((d, i) => (
                <label key={d} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={week.includes(i)}
                    onChange={(ev) =>
                      f.setValue(
                        'workweek',
                        ev.target.checked ? [...week, i] : week.filter((x) => x !== i),
                        { shouldDirty: true },
                      )
                    }
                  />
                  {d}
                </label>
              ))}
            </div>
            {e.workweek ? (
              <p role="alert" className="text-xs text-danger">
                {e.workweek.message}
              </p>
            ) : null}
          </fieldset>
        </Card>
        <Card className="space-y-3">
          <h2 className="font-semibold">Attendance policy</h2>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" {...f.register('requireGeofence')} />
            <span>
              <b>Require location for punches.</b> Office employees must punch inside an assigned
              work location. A phone location is a signal, not proof of presence.
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" {...f.register('allowGpsExceptions')} />
            <span>
              <b>Allow location exceptions.</b> Failed-location punches go to a reviewer instead of
              being rejected.
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" {...f.register('requirePhoto')} />
            <span>
              <b>Require a photo for check in and check out.</b> Employees take a selfie or a back
              camera photo in the mobile app. Needs object storage; photos are visible to HR and the
              employee&apos;s manager and are deleted after the retention period.
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" {...f.register('allowSelfApproval')} />
            <span>
              <b>Allow reviewers to approve their own requests.</b> Leave off for separation of
              duties.
            </span>
          </label>
          {leaveOn ? (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" {...f.register('autoLeave')} />
              <span>
                <b>Credit leave automatically.</b> Monthly-accrual leave types are credited each
                month, and unused days are carried forward in January (up to each type&apos;s limit).
                Starts from the month you switch it on and never back-fills earlier months. Credits
                can also still be run by hand.
              </span>
            </label>
          ) : null}
          {payrollOn ? (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" {...f.register('requireSeparatePublisher')} />
              <span>
                <b>Payroll must be published by a different person.</b> Whoever generated a payroll
                run cannot publish it.
              </span>
            </label>
          ) : null}
          <fieldset className="space-y-3 rounded-xl border border-border p-3">
            <legend className="px-1 text-sm font-semibold">Numbering</legend>
            <p className="text-xs text-muted">
              Applies to new records only; existing codes never change. Numbers keep counting up
              when you change the prefix.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Employee code prefix" error={e.empPrefix?.message}>
                {(id, inv) => <Input id={id} invalid={inv} maxLength={10} {...f.register('empPrefix')} />}
              </Field>
              <Field label="Employee code digits" error={e.empPadding?.message}>
                {(id, inv) => <Input id={id} type="number" invalid={inv} {...f.register('empPadding')} />}
              </Field>
              <Field label="Letter reference prefix" error={e.ltrPrefix?.message}>
                {(id, inv) => <Input id={id} invalid={inv} maxLength={10} {...f.register('ltrPrefix')} />}
              </Field>
              <Field label="Letter reference digits" error={e.ltrPadding?.message}>
                {(id, inv) => <Input id={id} type="number" invalid={inv} {...f.register('ltrPadding')} />}
              </Field>
              <Field label="Document reference prefix" error={e.docPrefix?.message}>
                {(id, inv) => <Input id={id} invalid={inv} maxLength={10} {...f.register('docPrefix')} />}
              </Field>
              <Field label="Document reference digits" error={e.docPadding?.message}>
                {(id, inv) => <Input id={id} type="number" invalid={inv} {...f.register('docPadding')} />}
              </Field>
            </div>
            <p className="text-xs text-muted">
              Next employee code looks like{' '}
              <b>{`${(f.watch('empPrefix') ?? '').toUpperCase()}${'1'.padStart(Math.min(Math.max(Number(f.watch('empPadding')) || 4, 1), 8), '0')}`}</b>
              ; document references like{' '}
              <b>{`${(f.watch('docPrefix') ?? '').toUpperCase()}${new Date().getFullYear()}-${'1'.padStart(Math.min(Math.max(Number(f.watch('docPadding')) || 4, 1), 8), '0')}`}</b>
              ; letter references like{' '}
              <b>{`${(f.watch('ltrPrefix') ?? '').toUpperCase()}${new Date().getFullYear()}-${'1'.padStart(Math.min(Math.max(Number(f.watch('ltrPadding')) || 4, 1), 8), '0')}`}</b>.
            </p>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Max GPS accuracy (m)" error={e.maxAccuracyMeters?.message}>
              {(id, inv) => (
                <Input id={id} type="number" invalid={inv} {...f.register('maxAccuracyMeters')} />
              )}
            </Field>
            <Field
              label="Max open session (hours)"
              hint="Longer sessions are flagged incomplete."
              error={e.maxOpenSessionHours?.message}
            >
              {(id, inv) => (
                <Input id={id} type="number" invalid={inv} {...f.register('maxOpenSessionHours')} />
              )}
            </Field>
          </div>
        </Card>
        <Button type="submit" loading={save.isPending}>
          Save settings
        </Button>
      </form>
      <div className="mt-6 max-w-2xl">
        <DatabaseSettings />
      </div>
    </>
  );
}
