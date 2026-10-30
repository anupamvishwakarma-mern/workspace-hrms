import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  GRANTABLE_PERMISSIONS,
  LOCKED_PERMISSIONS,
  isGrantable,
  resolveExtraPermissions,
} from '../src/modules/auth/customRoles';
import { hasPermission } from '../src/modules/auth/permissions';

describe('custom role permission rules', () => {
  it('never lets locked permissions be granted', () => {
    for (const p of LOCKED_PERMISSIONS) {
      expect(ALL_PERMISSIONS.has(p), p).toBe(true);
      expect(isGrantable(p), p).toBe(false);
      expect(GRANTABLE_PERMISSIONS.includes(p)).toBe(false);
    }
    expect(isGrantable('payroll:manage')).toBe(true);
    expect(isGrantable('made:up')).toBe(false);
  });

  it('adds permissions from every role, drops locked and unknown ones', () => {
    const got = resolveExtraPermissions(
      [
        { permissions: ['recruitment:manage', 'payroll:publish'] },
        { permissions: ['audit:read', 'nonsense', 'tenant:update'] },
      ],
      undefined,
    );
    expect([...got].sort()).toEqual(['audit:read', 'recruitment:manage']);
  });

  it('drops permissions of modules the company does not have', () => {
    const got = resolveExtraPermissions(
      [{ permissions: ['recruitment:manage', 'audit:read'] }],
      ['ATTENDANCE', 'LEAVE'],
    );
    expect([...got]).toEqual(['audit:read']);
  });

  it('hasPermission combines built-in roles with extra permissions, and still accepts a bare roles array', () => {
    const extra = new Set(['audit:read' as const]);
    expect(hasPermission({ roles: ['EMPLOYEE'], extraPermissions: extra }, 'audit:read')).toBe(true);
    expect(hasPermission({ roles: ['EMPLOYEE'] }, 'audit:read')).toBe(false);
    expect(hasPermission(['HR_ADMIN'], 'audit:read')).toBe(true);
    expect(hasPermission({ roles: ['EMPLOYEE'], extraPermissions: extra }, 'payroll:publish')).toBe(false);
  });
});
