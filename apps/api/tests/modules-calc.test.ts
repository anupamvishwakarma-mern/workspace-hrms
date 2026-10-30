import { describe, expect, it } from 'vitest';
import { checkModuleSet, enabledModules, moduleForPath, moduleForPermission } from '../src/modules/tenants/modules';

describe('module helpers', () => {
  it('treat a company with no stored list as having everything', () => {
    expect(enabledModules(undefined)).toContain('PAYROLL');
    expect(enabledModules(['LEAVE'])).toEqual(['LEAVE']);
    expect(enabledModules([])).toEqual([]);
  });
  it('map paths and permissions to modules, leaving core areas alone', () => {
    expect(moduleForPath(['payroll', 'runs'])).toBe('PAYROLL');
    expect(moduleForPath(['wfh', 'requests'])).toBe('ATTENDANCE');
    expect(moduleForPath(['leave-types'])).toBe('LEAVE');
    expect(moduleForPath(['employees', 'abc', 'documents'])).toBe('DOCUMENTS');
    expect(moduleForPath(['employees', 'abc', 'sensitive'])).toBeUndefined();
    expect(moduleForPath(['employees'])).toBeUndefined();
    expect(moduleForPath(['approvals'])).toBeUndefined();
    expect(moduleForPermission('payroll:manage')).toBe('PAYROLL');
    expect(moduleForPermission('shift:read')).toBe('ATTENDANCE');
    expect(moduleForPermission('holiday:read')).toBeUndefined();
    expect(moduleForPermission('approval:use')).toBeUndefined();
  });
  it('payroll needs attendance', () => {
    expect(checkModuleSet(['PAYROLL'])).toMatch(/Attendance/);
    expect(checkModuleSet(['PAYROLL', 'ATTENDANCE'])).toBeUndefined();
    expect(checkModuleSet(['LEAVE'])).toBeUndefined();
  });
});
