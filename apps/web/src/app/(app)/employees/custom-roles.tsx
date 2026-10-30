'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/display';
import { useList, useOne, useSave } from '@/hooks/api';
import { api } from '@/lib/api';
import type { CustomRole } from '@/lib/types';

/** Company-defined roles for one person. The server decides who may assign which role. */
export function CustomRoles({ employeeId }: { employeeId: string }) {
  const roles = useList<CustomRole>('roles', '/roles');
  const mine = useOne<{ roleIds: string[]; hasAccount: boolean }>(
    'employee-custom-roles',
    `/employees/${employeeId}/custom-roles`,
  );
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => {
    if (mine.data) setPicked(mine.data.data.roleIds);
  }, [mine.data]);
  const save = useSave(
    () => api.put(`/employees/${employeeId}/custom-roles`, { roleIds: picked }),
    ['employee-custom-roles', 'roles'],
  );
  const items = roles.data?.data ?? [];
  const max = (roles.data as { meta?: { maxPerPerson?: number } } | undefined)?.meta?.maxPerPerson ?? 3;
  if (!roles.data || !mine.data || items.length === 0) return null;
  if (!mine.data.data.hasAccount) return null;
  const toggle = (id: string) =>
    setPicked((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  return (
    <fieldset className="space-y-2 border-t border-border pt-3">
      <legend className="text-sm font-medium">Company roles</legend>
      <p className="text-xs text-muted">
        Extra permissions on top of the roles above (up to {max}). You can only give a role made of
        permissions you hold yourself, and not to yourself.
      </p>
      {save.error ? <Alert tone="danger">{save.error}</Alert> : null}
      {save.isSuccess ? <Alert tone="success">Company roles updated.</Alert> : null}
      <div className="flex flex-wrap gap-3">
        {items.map((r) => (
          <label key={r.id} className="flex items-center gap-1.5 text-sm" title={r.description ?? undefined}>
            <input type="checkbox" checked={picked.includes(r.id)} onChange={() => toggle(r.id)} />
            {r.name}
          </label>
        ))}
      </div>
      <div className="flex justify-end">
        <Button
          variant="secondary"
          loading={save.isPending}
          disabled={picked.length > max}
          onClick={() => save.mutate(undefined)}
        >
          Save company roles
        </Button>
      </div>
    </fieldset>
  );
}
