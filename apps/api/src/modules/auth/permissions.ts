import type { TenantRole } from '../../database/models/membership.model';

export type Permission =
  | 'tenant:read'
  | 'tenant:update'
  | 'role:manage' // create, edit and delete company-defined roles (owner only)
  | 'employee:read:all'
  | 'employee:read:team'
  | 'employee:read:basic' // minimal projection (payroll)
  | 'employee:read:self'
  | 'employee:create'
  | 'employee:update'
  | 'employee:update:self'
  | 'employee:invite'
  | 'employee:deactivate'
  | 'employee:roles'
  | 'department:read'
  | 'department:manage'
  | 'designation:read'
  | 'designation:manage'
  | 'approval:use' // raise requests, act on requests assigned to you
  | 'approval:manage' // define workflows, see all requests
  | 'attendance:punch'
  | 'attendance:read:self'
  | 'attendance:read:all' // daily summaries (no GPS/event detail)
  | 'attendance:read:team'
  | 'attendance:events:read' // punch-level detail incl. GPS verification
  | 'attendance:review:all'
  | 'attendance:manual' // record attendance for someone else directly, with a reason
  | 'wfh:request' // ask to work from home on given days
  | 'exit:request' // resign (raise your own resignation)
  | 'exit:manage' // see every resignation
  | 'attendance:review:team'
  | 'shift:read'
  | 'shift:manage'
  | 'location:read'
  | 'location:manage'
  | 'holiday:read'
  | 'holiday:manage'
  | 'employee:reactivate'
  | 'employee:sensitive:read' // masked bank/statutory data of others; full values are audited
  | 'employee:sensitive:update'
  | 'employee:confirm' // confirm an employee after probation
  | 'employee:change' // record promotions, transfers and salary revisions
  | 'audit:read'
  | 'leave:apply' // own requests and balances
  | 'leave:read:all'
  | 'leave:read:team'
  | 'leave:review:all'
  | 'leave:review:team'
  | 'leave:manage' // leave types and balance grants
  | 'document:read:self'
  | 'document:manage' // upload/read/delete any employee's documents
  | 'payroll:read:self' // own salary structure and published payslips
  | 'payroll:manage' // salary structures, payroll runs, any payslip
  | 'payroll:publish' // publish a generated run (can be required to be a different person)
  | 'letter:read:self' // letters issued to me
  | 'letter:manage' // templates and issuing letters
  | 'handbook:read' // published handbook sections
  | 'handbook:manage' // write the handbook
  | 'recruitment:manage' // jobs, candidates, offers, hiring
  | 'recruitment:feedback'; // see own interviews and submit feedback

const COMMON: Permission[] = [
  'attendance:punch',
  'attendance:read:self',
  'shift:read',
  'location:read',
  'holiday:read',
  'leave:apply',
  'document:read:self',
  'payroll:read:self',
  'letter:read:self',
  'handbook:read',
  'approval:use',
  'wfh:request',
  'exit:request',
];

const HR_PERMS: Permission[] = [
  'tenant:read',
  'employee:read:all',
  'employee:read:self',
  'employee:create',
  'employee:update',
  'employee:update:self',
  'employee:invite',
  'employee:deactivate',
  'employee:roles',
  'department:read',
  'department:manage',
  'designation:read',
  'designation:manage',
  ...COMMON,
  'attendance:read:all',
  'attendance:events:read',
  'attendance:review:all',
  'attendance:manual',
  'shift:manage',
  'location:manage',
  'holiday:manage',
  'employee:reactivate',
  'employee:confirm',
  'employee:change',
  'employee:sensitive:read',
  'employee:sensitive:update',
  'audit:read',
  'leave:read:all',
  'leave:review:all',
  'leave:manage',
  'document:manage',
  'payroll:manage',
  'payroll:publish',
  'letter:manage',
  'handbook:manage',
  'approval:manage',
  'recruitment:manage',
  'recruitment:feedback',
  'exit:manage',
];

export const ROLE_PERMISSIONS: Record<TenantRole, Permission[]> = {
  COMPANY_OWNER: [
    ...HR_PERMS,
    'tenant:update',
    'role:manage',
    'employee:read:team',
    'employee:read:basic',
  ],
  HR_ADMIN: HR_PERMS,
  MANAGER: [
    'tenant:read',
    'employee:read:team',
    'employee:read:self',
    'employee:update:self',
    'department:read',
    'designation:read',
    ...COMMON,
    'attendance:read:team',
    'attendance:events:read',
    'attendance:review:team',
    'leave:read:team',
    'leave:review:team',
    'recruitment:feedback',
  ],
  EMPLOYEE: [
    'tenant:read',
    'employee:read:self',
    'employee:update:self',
    'department:read',
    'designation:read',
    ...COMMON,
  ],
  PAYROLL_ADMIN: [
    'tenant:read',
    'employee:read:basic',
    'employee:read:self',
    'employee:update:self',
    'department:read',
    'designation:read',
    ...COMMON,
    'payroll:manage',
    'payroll:publish',
    'attendance:read:all', // summaries only: no punch-level GPS detail
    'leave:read:all', // dates and type only; reasons are hidden from this role
  ],
};

export function permissionsFor(roles: readonly TenantRole[]): Set<Permission> {
  return new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? []));
}

/** Who is asking: their built-in roles plus any permissions added by company-defined roles. */
export interface PermissionSubject {
  roles: readonly TenantRole[];
  extraPermissions?: ReadonlySet<Permission>;
}

/** Accepts a tenant context (preferred) or a bare roles array. */
export const hasPermission = (
  subject: readonly TenantRole[] | PermissionSubject,
  p: Permission,
): boolean => {
  const s: PermissionSubject = Array.isArray(subject)
    ? { roles: subject as readonly TenantRole[] }
    : (subject as PermissionSubject);
  return permissionsFor(s.roles).has(p) || (s.extraPermissions?.has(p) ?? false);
};

/** Roles a given actor may assign to others. Prevents privilege escalation via invite/role changes. */
export function assignableRoles(actorRoles: readonly TenantRole[]): Set<TenantRole> {
  if (actorRoles.includes('COMPANY_OWNER')) {
    return new Set<TenantRole>([
      'COMPANY_OWNER',
      'HR_ADMIN',
      'MANAGER',
      'EMPLOYEE',
      'PAYROLL_ADMIN',
    ]);
  }
  if (actorRoles.includes('HR_ADMIN')) return new Set<TenantRole>(['MANAGER', 'EMPLOYEE']);
  return new Set();
}
