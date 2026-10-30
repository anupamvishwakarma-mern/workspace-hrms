'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { PageTop } from '@/components/page-top';
import { DonutChart, Panel } from '../dashboard/charts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Pager } from '@/components/pager';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Alert, Badge, Empty, Skeleton, Table, Td, Th } from '@/components/ui/display';
import { Field, Input, Select } from '@/components/ui/form';
import { useList, useSave } from '@/hooks/api';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import type { Holiday, WorkLocation } from '@/lib/types';
import { compact, formatDate, label } from '@/lib/utils';

const schema = z.object({
  name: z.string().trim().min(1, 'Required').max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
  holidayType: z.enum(['PUBLIC', 'COMPANY', 'OPTIONAL']),
  workLocationId: z.string(),
});
type Form = z.infer<typeof schema>;
const LIMIT = 25;

export default function HolidaysPage() {
  const [editing, setEditing] = useState<Holiday | 'new'>();
  const [page, setPage] = useState(1);
  const q = useList<Holiday>('holidays', '/holidays', { page, limit: LIMIT });
  const locs = useList<WorkLocation>('locations', '/work-locations', { limit: 100 });
  return (
    <>
      <PageTop
        scope="holiday calendar"
        stats={[
          { label: 'Holidays listed', value: q.data?.meta?.total ?? '…' },
          {
            label: 'Location-specific',
            value: q.data ? q.data.data.filter((h) => h.workLocationId).length : '…',
            sub: 'On this page',
          },
          {
            label: 'Company-wide',
            value: q.data ? q.data.data.filter((h) => !h.workLocationId).length : '…',
            sub: 'On this page',
          },
        ]}
        guide={[
          'A holiday is not charged as leave and does not count as absent.',
          'Leave a location empty for a company-wide holiday, or pick a location so it only applies to people assigned there.',
          'Employees see upcoming holidays on their dashboard and leave page.',
        ]}
        title="Holidays"
        description="Active holidays. A holiday limited to a location applies only to employees assigned there."
        actions={<Button onClick={() => setEditing('new')}>Add holiday</Button>}
      />
      {q.data && q.data.data.length > 0 ? (
        <Panel title="Holidays by type" className="mb-5">
          <DonutChart
            pie
            data={Object.entries(
              q.data.data.reduce<Record<string, number>>(
                (m, h) => ({ ...m, [h.holidayType]: (m[h.holidayType] ?? 0) + 1 }),
                {},
              ),
            ).map(([name, value]) => ({ name: label(name), value }))}
          />
        </Panel>
      ) : null}
      {q.isError ? <Alert tone="danger">{userMessage(q.error)}</Alert> : null}
      {!q.data ? (
        q.isError ? null : (
          <Skeleton className="h-40" />
        )
      ) : (
        <>
          <Table aria-label="Holidays">
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>Applies to</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {q.data.data.map((h) => (
                <tr key={h.id}>
                  <Td>{formatDate(h.date)}</Td>
                  <Td className="font-medium">{h.name}</Td>
                  <Td>
                    <Badge>{label(h.holidayType)}</Badge>
                  </Td>
                  <Td>
                    {h.workLocationId
                      ? (locs.data?.data.find((l) => l.id === h.workLocationId)?.name ??
                        'One location')
                      : 'All locations'}
                  </Td>
                  <Td>
                    <Button size="sm" variant="secondary" onClick={() => setEditing(h)}>
                      Edit
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {q.data.data.length === 0 ? <Empty>No holidays yet.</Empty> : null}
          <Pager page={page} limit={LIMIT} total={q.data.meta?.total ?? 0} onPage={setPage} />
        </>
      )}
      {editing ? (
        <HolidayForm
          holiday={editing === 'new' ? undefined : editing}
          locations={locs.data?.data ?? []}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </>
  );
}

function HolidayForm({
  holiday,
  locations,
  onClose,
}: {
  holiday?: Holiday;
  locations: WorkLocation[];
  onClose: () => void;
}) {
  const f = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: holiday?.name ?? '',
      date: holiday?.date?.slice(0, 10) ?? '',
      holidayType: (holiday?.holidayType as Form['holidayType']) ?? 'PUBLIC',
      workLocationId: holiday?.workLocationId ?? '',
    },
  });
  const save = useSave(
    (v: Form) =>
      holiday
        ? api.patch(`/holidays/${holiday.id}`, {
            ...compact({ name: v.name, date: v.date, holidayType: v.holidayType }),
            ...(v.workLocationId ? { workLocationId: v.workLocationId } : {}),
          })
        : api.post('/holidays', compact(v)),
    ['holidays', 'dashboard', 'days'],
    onClose,
  );
  const deactivate = useSave(
    () => api.patch(`/holidays/${holiday!.id}`, { status: 'INACTIVE' }),
    ['holidays', 'dashboard', 'days'],
    onClose,
  );
  const e = f.formState.errors;
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={holiday ? 'Edit holiday' : 'Add holiday'}
    >
      <form onSubmit={f.handleSubmit((v) => save.mutate(v))} className="space-y-3" noValidate>
        {save.error || deactivate.error ? (
          <Alert tone="danger">{save.error ?? deactivate.error}</Alert>
        ) : null}
        <Field label="Name" error={e.name?.message}>
          {(id, inv) => <Input id={id} invalid={inv} {...f.register('name')} />}
        </Field>
        <Field label="Date" error={e.date?.message}>
          {(id, inv) => <Input id={id} type="date" invalid={inv} {...f.register('date')} />}
        </Field>
        <Field label="Type">
          {(id) => (
            <Select id={id} {...f.register('holidayType')}>
              <option value="PUBLIC">Public</option>
              <option value="COMPANY">Company</option>
              <option value="OPTIONAL">Optional</option>
            </Select>
          )}
        </Field>
        <Field label="Location" hint="Leave on “All locations” for a company-wide holiday.">
          {(id) => (
            <Select id={id} {...f.register('workLocationId')}>
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex justify-between gap-2">
          {holiday ? (
            <Button
              type="button"
              variant="secondary"
              loading={deactivate.isPending}
              onClick={() => deactivate.mutate(undefined)}
            >
              Remove
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              Save
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
