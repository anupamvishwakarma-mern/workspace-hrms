/** Roles that may see the Team tab. The server enforces the real scope; this only decides what to show. */
export const TEAM_ROLES = ['MANAGER', 'HR_ADMIN', 'COMPANY_OWNER'] as const;
export const canSeeTeam = (roles: readonly string[] | undefined) =>
  !!roles?.some((r) => (TEAM_ROLES as readonly string[]).includes(r));
export const seesEveryone = (roles: readonly string[] | undefined) =>
  !!roles?.some((r) => r === 'HR_ADMIN' || r === 'COMPANY_OWNER');
