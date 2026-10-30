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
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import type { WorkLocation } from '@/lib/types';
import { compact, label } from '@/lib/utils';

const schema = z.object({
  name: z.string().trim().min(1, 'Required').max(120),
  address: z.string().max(300),
  latitude: z.coerce
    .number({ message: 'Enter a number' })
    .min(-90, 'Between -90 and 90')
    .max(90, 'Between -90 and 90'),
  longitude: z.coerce
    .number({ message: 'Enter a number' })
    .min(-180, 'Between -180 and 180')
    .max(180, 'Between -180 and 180'),
  radiusMeters: z.coerce
    .number({ message: 'Enter a number' })
    .min(10, 'Min 10 m')
    .max(5000, 'Max 5000 m'),
  status: z.enum(['ACTIVE', 'INACTIVE']),
});
type In = z.input<typeof schema>;
type Out = z.output<typeof schema>;

export default function LocationsPage() {
  const [editing, setEditing] = useState<WorkLocation | 'new'>();
  const q = useList<WorkLocation>('locations', '/work-locations', { limit: 100 });
  return (
    <>
      <PageTop
        scope="geofences"
        stats={[
          { label: 'Locations', value: q.data?.data.length ?? '…' },
          {
            label: 'Active',
            value: q.data ? q.data.data.filter((l) => l.status === 'ACTIVE').length : '…',
            tone: 'success',
          },
          {
            label: 'Average radius',
            value:
              q.data && q.data.data.length
                ? `${Math.round(q.data.data.reduce((n, l) => n + l.radiusMeters, 0) / q.data.data.length)} m`
                : '…',
          },
        ]}
        guide={[
          'A location is a map point with a radius. Office punches are checked against it.',
          'Pick a radius that covers the whole building and car park. Too small and valid punches are blocked.',
          'A phone location is a signal, not proof. Blocked punches go to Approvals for a person to decide.',
        ]}
        title="Work locations"
        description="Geofences used to check office punches. A phone’s location is a signal, not proof of presence."
        actions={<Button onClick={() => setEditing('new')}>Add location</Button>}
      />
      {q.isError ? <Alert tone="danger">{userMessage(q.error)}</Alert> : null}
      {!q.data ? (
        q.isError ? null : (
          <Skeleton className="h-40" />
        )
      ) : (
        <>
          <Table aria-label="Work locations">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Address</Th>
                <Th>Radius</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {q.data.data.map((l) => (
                <tr key={l.id}>
                  <Td className="font-medium">{l.name}</Td>
                  <Td>{l.address || '—'}</Td>
                  <Td>{l.radiusMeters} m</Td>
                  <Td>
                    <Badge tone={statusTone(l.status)}>{label(l.status)}</Badge>
                  </Td>
                  <Td>
                    <Button size="sm" variant="secondary" onClick={() => setEditing(l)}>
                      Edit
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {q.data.data.length === 0 ? (
            <Empty>No locations yet. Office employees cannot punch until one is assigned.</Empty>
          ) : null}
        </>
      )}
      {editing ? (
        <LocationForm
          loc={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </>
  );
}

function LocationForm({ loc, onClose }: { loc?: WorkLocation; onClose: () => void }) {
  const f = useForm<In, unknown, Out>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: loc?.name ?? '',
      address: loc?.address ?? '',
      latitude: loc?.latitude as number,
      longitude: loc?.longitude as number,
      radiusMeters: loc?.radiusMeters ?? 100,
      status: (loc?.status as Out['status']) ?? 'ACTIVE',
    },
  });
  const save = useSave(
    (v: Out) => {
      const body = compact({
        name: v.name,
        address: v.address,
        latitude: v.latitude,
        longitude: v.longitude,
        radiusMeters: v.radiusMeters,
      });
      return loc
        ? api.patch(`/work-locations/${loc.id}`, { ...body, status: v.status })
        : api.post('/work-locations', body);
    },
    ['locations'],
    onClose,
  );
  const test = useSave(
    (p: { latitude: number; longitude: number }) =>
      api.post<{ inside: boolean; distanceMeters: number }>(`/work-locations/${loc!.id}/test`, {
        ...p,
        accuracyMeters: 10,
      }),
    [],
  );
  const e = f.formState.errors;
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={loc ? 'Edit location' : 'Add location'}
    >
      <form onSubmit={f.handleSubmit((v) => save.mutate(v))} className="space-y-3" noValidate>
        {save.error ? <Alert tone="danger">{save.error}</Alert> : null}
        <Field label="Name" error={e.name?.message}>
          {(id, inv) => <Input id={id} invalid={inv} {...f.register('name')} />}
        </Field>
        <Field label="Address" error={e.address?.message}>
          {(id, inv) => <Input id={id} invalid={inv} {...f.register('address')} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Latitude" error={e.latitude?.message}>
            {(id, inv) => (
              <Input id={id} inputMode="decimal" invalid={inv} {...f.register('latitude')} />
            )}
          </Field>
          <Field label="Longitude" error={e.longitude?.message}>
            {(id, inv) => (
              <Input id={id} inputMode="decimal" invalid={inv} {...f.register('longitude')} />
            )}
          </Field>
        </div>
        <Field
          label="Radius (metres)"
          hint="10–5000. Keep it larger than typical GPS error indoors."
          error={e.radiusMeters?.message}
        >
          {(id, inv) => (
            <Input id={id} inputMode="numeric" invalid={inv} {...f.register('radiusMeters')} />
          )}
        </Field>
        {loc ? (
          <Field label="Status">
            {(id) => (
              <Select id={id} {...f.register('status')}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </Select>
            )}
          </Field>
        ) : null}
        {loc ? (
          <div className="rounded-lg border border-border p-3 text-sm">
            <p className="mb-2 font-medium">Test a point</p>
            <p className="mb-2 text-xs text-muted">
              Uses the latitude/longitude above to check whether it falls inside this saved
              geofence.
            </p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              loading={test.isPending}
              onClick={() => {
                const v = f.getValues();
                test.mutate({ latitude: Number(v.latitude), longitude: Number(v.longitude) });
              }}
            >
              Run test
            </Button>
            {test.error ? (
              <p role="alert" className="mt-2 text-xs text-danger">
                {test.error}
              </p>
            ) : null}
            {test.data ? (
              <p className="mt-2" role="status">
                {(test.data as { data: { inside: boolean; distanceMeters: number } }).data.inside
                  ? 'Inside'
                  : 'Outside'}{' '}
                —{' '}
                {Math.round(
                  (test.data as { data: { distanceMeters: number } }).data.distanceMeters,
                )}{' '}
                m from centre
              </p>
            ) : null}
          </div>
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
