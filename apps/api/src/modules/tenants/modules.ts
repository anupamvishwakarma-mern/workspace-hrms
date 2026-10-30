/**
 * Optional product areas a platform admin can switch on or off for each company (limited-access plans).
 * Everything not listed here (sign-in, employees, departments, designations, locations, holidays, approvals,
 * reports, notifications, audit, company settings) is always available.
 * A company with no stored list has every module, so existing companies keep working.
 */
export const MODULES = {
  ATTENDANCE: {
    label: 'Attendance',
    description: 'Punching, shifts, corrections, work from home and the team view.',
    paths: ['attendance', 'shifts', 'shift-assignments', 'wfh', 'team'],
    permissionPrefixes: ['attendance:', 'shift:', 'wfh:'],
  },
  LEAVE: {
    label: 'Leave',
    description: 'Leave types, requests, balances, accrual and carry-forward.',
    paths: ['leave', 'leave-types'],
    permissionPrefixes: ['leave:'],
  },
  PAYROLL: {
    label: 'Payroll',
    description: 'Salary structures, statutory rules, adjustments, payroll runs and payslips. Needs Attendance.',
    paths: ['payroll'],
    permissionPrefixes: ['payroll:'],
  },
  LETTERS: {
    label: 'Letters',
    description: 'Letter templates and issued letters.',
    paths: ['letters', 'letter-templates'],
    permissionPrefixes: ['letter:'],
  },
  HANDBOOK: {
    label: 'Handbook',
    description: 'Company handbook and policies.',
    paths: ['handbook'],
    permissionPrefixes: ['handbook:'],
  },
  DOCUMENTS: {
    label: 'Documents',
    description: 'Employee document storage.',
    paths: [], // reached through /employees/:id/documents (see moduleForPath)
    permissionPrefixes: ['document:'],
  },
  RECRUITMENT: {
    label: 'Recruitment',
    description: 'Job openings, candidates, interviews, offers and hiring.',
    paths: ['recruitment'],
    permissionPrefixes: ['recruitment:'],
  },
} as const;

export type ModuleKey = keyof typeof MODULES;
export const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[];
/** A module that cannot work without another one. */
export const MODULE_DEPENDENCIES: Partial<Record<ModuleKey, ModuleKey[]>> = { PAYROLL: ['ATTENDANCE'] };

/** The modules a company has: its stored list, or all of them when none was ever set. */
export function enabledModules(stored?: readonly string[] | null): ModuleKey[] {
  if (!stored) return [...MODULE_KEYS];
  return MODULE_KEYS.filter((k) => stored.includes(k));
}

/** `segments` is the request path after /api/v1, split on "/" (e.g. ["payroll", "runs"]). */
export function moduleForPath(segments: readonly string[]): ModuleKey | undefined {
  const [first, , third] = segments;
  if (!first) return undefined;
  if (first === 'employees' && third === 'documents') return 'DOCUMENTS';
  return MODULE_KEYS.find((k) => (MODULES[k].paths as readonly string[]).includes(first));
}

export function moduleForPermission(permission: string): ModuleKey | undefined {
  return MODULE_KEYS.find((k) => MODULES[k].permissionPrefixes.some((p) => permission.startsWith(p)));
}

/** Returns an error message when the chosen set breaks a dependency. */
export function checkModuleSet(keys: readonly string[]): string | undefined {
  for (const k of keys) {
    for (const dep of MODULE_DEPENDENCIES[k as ModuleKey] ?? [])
      if (!keys.includes(dep))
        return `${MODULES[k as ModuleKey].label} needs ${MODULES[dep].label} to be enabled too`;
  }
  return undefined;
}
