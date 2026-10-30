import { describe, expect, it } from 'vitest';
import { isoDate, managerCycles, parseBalanceRow, parseEmployeeRow } from '../src/modules/imports/rows';

describe('parseEmployeeRow', () => {
  const base = { firstName: ' Asha ', lastName: 'Nair', workEmail: 'ASHA@Example.com' };
  it('accepts a minimal row and cleans it', () => {
    const r = parseEmployeeRow(base);
    expect(r.ok && r.value).toMatchObject({ firstName: 'Asha', workEmail: 'asha@example.com', role: 'EMPLOYEE' });
  });
  it('reads friendly values for type, gender and mode', () => {
    const r = parseEmployeeRow({ ...base, employmentType: 'full time', gender: 'f', attendanceMode: 'remote', role: 'manager', joiningDate: '2025-03-01' });
    expect(r.ok && r.value).toMatchObject({ employmentType: 'FULL_TIME', gender: 'FEMALE', attendanceMode: 'REMOTE', role: 'MANAGER', joiningDate: '2025-03-01' });
  });
  it('lists every problem in plain language', () => {
    const r = parseEmployeeRow({ firstName: '', workEmail: 'nope', joiningDate: '01/03/2025', employmentType: 'boss', role: 'COMPANY_OWNER', phone: 'abc' });
    expect(r.ok).toBe(false);
    const e = !r.ok ? r.errors.join('|') : '';
    for (const part of ['First name is required', 'Last name is required', 'not a valid email', 'YYYY-MM-DD', 'Employment type', 'Role must be', 'Phone'])
      expect(e).toContain(part);
  });
  it('rejects impossible and future dates', () => {
    expect(isoDate('2025-02-30')).toBeUndefined();
    expect(isoDate('2025-02-28')).toBe('2025-02-28');
    const r = parseEmployeeRow({ ...base, dateOfBirth: '2999-01-01' });
    expect(!r.ok && r.errors.join()).toContain('future');
  });
  it('treats numbers and blanks from a spreadsheet as text', () => {
    const r = parseEmployeeRow({ ...base, employeeCode: 1001, phone: null });
    expect(r.ok && r.value.employeeCode).toBe('1001');
  });
});

describe('managerCycles', () => {
  it('finds loops and ignores chains', () => {
    expect([...managerCycles([{ id: 'a', manager: 'b' }, { id: 'b', manager: 'a' }, { id: 'c', manager: 'a' }])].sort()).toEqual(['a', 'b']);
    expect(managerCycles([{ id: 'a', manager: 'b' }, { id: 'b' }]).size).toBe(0);
  });
});

describe('parseBalanceRow', () => {
  it('accepts half days and defaults the year', () => {
    const r = parseBalanceRow({ employee: 'EMP-0004', leaveType: 'CL', days: '7.5' }, 2026);
    expect(r.ok && r.value).toMatchObject({ days: 7.5, year: undefined });
  });
  it('rejects zero, negative, odd fractions and far-off years', () => {
    for (const days of ['0', '-1', '2.3', 'x', ''])
      expect(parseBalanceRow({ employee: 'e', leaveType: 'CL', days }, 2026).ok, days).toBe(false);
    expect(parseBalanceRow({ employee: 'e', leaveType: 'CL', days: 2, year: 2030 }, 2026).ok).toBe(false);
    expect(parseBalanceRow({ employee: 'e', leaveType: 'CL', days: 2, year: 2025 }, 2026).ok).toBe(true);
  });
});
