'use client';
import { useMemo, useState } from 'react';
import { PageTop } from '@/components/page-top';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Alert, Badge, Empty, Skeleton, Table, Td, Th } from '@/components/ui/display';
import { Field, Input, Textarea } from '@/components/ui/form';
import { useList, useSave } from '@/hooks/api';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import type { CustomRole, GrantablePermission } from '@/lib/types';
import { label } from '@/lib/utils';

/** Company-defined roles. Only the owner reaches this page; the server enforces it as well. */
export default function RolesPage() {
  const [editing, setEditing] = useState<CustomRole | 'new'>();
  const roles = useList<CustomRole>('roles', '/roles');
  const items = roles.data?.data ?? [];
  const meta = (roles.data as { meta?: { max?: number; maxPerPerson?: number } } | undefined)?.meta;
  const remove = useSave((r: CustomRole) => api.del(`/roles/${r.id}`), ['roles']);

  return (
    <>
      <PageTop
        scope="company access"
        title="Roles"
        stats={[{ label: 'Custom roles', value: roles.data ? items.length : '…' }]}
        guide={[
          'The built-in roles (Owner, HR admin, Manager, Employee, Payroll admin) stay as they are.',
          'A custom role only adds permissions on top of those, for example a "Recruiter" who is otherwise a plain employee.',
          `Give a person up to ${meta?.maxPerPerson ?? 3} custom roles from their Access tab. Changes apply on their next request.`,
          'Some permissions cannot be put in a custom role: managing roles, company settings, publishing payroll and editing bank or ID details.',
        ]}
        actions={<Button onClick={() => setEditing('new')}>Add role</Button>}
      />
      {roles.isError ? <Alert tone="danger">{userMessage(roles.error)}</Alert> : null}
      {remove.error ? <Alert tone="danger">{remove.error}</Alert> : null}
      {!roles.data ? (
        roles.isError ? null : <Skeleton className="h-40" />
      ) : items.length === 0 ? (
        <Empty>No custom roles yet.</Empty>
      ) : (
        <Table aria-label="Custom roles">
          <thead>
            <tr>
              <Th>Role</Th>
              <Th>Permissions</Th>
              <Th>People</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <Td>
                  <span className="font-medium">{r.name}</span>
                  {r.description ? <span className="block text-xs text-muted">{r.description}</span> : null}
                </Td>
                <Td>
                  <Badge tone="neutral">{r.permissions.length}</Badge>
                </Td>
                <Td>{r.assignedCount ?? 0}</Td>
                <Td>
                  <span className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={(r.assignedCount ?? 0) > 0}
                      title={(r.assignedCount ?? 0) > 0 ? 'Remove it from everyone first' : undefined}
                      onClick={() => window.confirm(`Delete the role "${r.name}"?`) && remove.mutate(r)}
                    >
                      Delete
                    </Button>
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing ? (
        <RoleForm role={editing === 'new' ? undefined : editing} onClose={() => setEditing(undefined)} />
      ) : null}
    </>
  );
}

function RoleForm({ role, onClose }: { role?: CustomRole; onClose: () => void }) {
  const catalogue = useList<GrantablePermission>('roles-permissions', '/roles/permissions');
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [picked, setPicked] = useState<string[]>(role?.permissions ?? []);
  const [localError, setLocalError] = useState<string>();
  const save = useSave(
    () => {
      const body = { name: name.trim(), description: description.trim(), permissions: picked };
      return role ? api.patch(`/roles/${role.id}`, body) : api.post('/roles', body);
    },
    ['roles'],
    onClose,
  );
  const groups = useMemo(() => {
    const m = new Map<string, GrantablePermission[]>();
    for (const p of catalogue.data?.data ?? []) m.set(p.area, [...(m.get(p.area) ?? []), p]);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [catalogue.data]);
  const toggle = (p: string) =>
    setPicked((c) => (c.includes(p) ? c.filter((x) => x !== p) : [...c, p]));

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={role ? `Edit ${role.name}` : 'Add role'}>
      <div className="space-y-3">
        {localError || save.error ? <Alert tone="danger">{localError ?? save.error}</Alert> : null}
        {role && (role.assignedCount ?? 0) > 0 ? (
          <Alert tone="warn">
            {role.assignedCount} {role.assignedCount === 1 ? 'person holds' : 'people hold'} this role.
            Changing its permissions changes theirs on their next request.
          </Alert>
        ) : null}
        <Field label="Name">
          {(id) => <Input id={id} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="Description (optional)">
          {(id) => (
            <Textarea id={id} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
          )}
        </Field>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Permissions ({picked.length} selected)</legend>
          {catalogue.isError ? <Alert tone="danger">{userMessage(catalogue.error)}</Alert> : null}
          {!catalogue.data ? <Skeleton className="h-32" /> : null}
          <div className="max-h-72 space-y-3 overflow-y-auto rounded-xl border border-border p-3">
            {groups.map(([area, perms]) => (
              <div key={area}>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label(area)}</p>
                <div className="mt-1 grid gap-1 sm:grid-cols-2">
                  {perms.map((p) => (
                    <label key={p.permission} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={picked.includes(p.permission)}
                        onChange={() => toggle(p.permission)}
                      />
                      <span className="font-mono text-xs">{p.permission}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted">
            Permissions of a module your company does not have enabled are stored but have no effect.
          </p>
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              setLocalError(undefined);
              if (name.trim().length < 2) return setLocalError('Enter a name of at least 2 characters.');
              save.mutate(undefined);
            }}
          >
            Save role
          </Button>
        </div>
      </div>
    </Modal>
  );
}
