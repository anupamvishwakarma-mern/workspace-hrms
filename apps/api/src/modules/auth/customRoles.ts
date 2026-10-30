import type { Types } from 'mongoose';
import { CustomRole } from '../../database/models/customRole.model';
import { runInTenantDb } from '../../database/tenantContext';
import { enabledModules, moduleForPermission } from '../tenants/modules';
import { ROLE_PERMISSIONS, type Permission } from './permissions';

/** Every permission that exists, derived from the built-in roles so the two lists cannot drift. */
export const ALL_PERMISSIONS: ReadonlySet<Permission> = new Set(Object.values(ROLE_PERMISSIONS).flat());

/**
 * Permissions that only built-in roles may hold. Company-defined roles can never contain them, even if a record
 * were edited directly in the database: they are filtered out again when permissions are resolved.
 */
export const LOCKED_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  'tenant:update',
  'role:manage',
  'employee:roles',
  'employee:sensitive:update',
  'payroll:publish',
]);

export const GRANTABLE_PERMISSIONS: readonly Permission[] = [...ALL_PERMISSIONS]
  .filter((p) => !LOCKED_PERMISSIONS.has(p))
  .sort();

export const isGrantable = (p: string): p is Permission =>
  (GRANTABLE_PERMISSIONS as readonly string[]).includes(p);

/** Pure: the permissions a person gets from their custom roles, after the lock list and module entitlements. */
export function resolveExtraPermissions(
  roles: readonly { permissions: readonly string[] }[],
  modules: readonly string[] | null | undefined,
): Set<Permission> {
  const on = enabledModules((modules ?? undefined) as string[] | undefined);
  const out = new Set<Permission>();
  for (const r of roles)
    for (const p of r.permissions) {
      if (!isGrantable(p)) continue;
      const mod = moduleForPermission(p);
      if (mod && !on.includes(mod)) continue;
      out.add(p);
    }
  return out;
}

/** Loads the person's custom roles from the company database. Cheap no-op for people who have none. */
export async function loadExtraPermissions(
  dbName: string | undefined,
  tenantId: Types.ObjectId,
  customRoleIds: readonly Types.ObjectId[] | undefined,
  modules: readonly string[] | null | undefined,
): Promise<Set<Permission>> {
  if (!customRoleIds || customRoleIds.length === 0) return new Set();
  const roles = await runInTenantDb(dbName, () =>
    CustomRole.find({ tenantId, _id: { $in: customRoleIds } })
      .select('permissions')
      .lean(),
  );
  return resolveExtraPermissions(roles as { permissions: string[] }[], modules);
}
