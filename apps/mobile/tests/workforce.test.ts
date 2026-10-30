import { describe, expect, it } from 'vitest';
import { roleViewOf } from '../src/lib/roles';
import type { StaffRow } from '../src/lib/schemas';
import {
  attrition12,
  countBy,
  headcountAt,
  headcountTrend,
  joinedIn,
  leftIn,
} from '../src/lib/workforce';

const p = (id: string, joiningDate?: string, lastWorkingDate?: string, dept = 'd1'): StaffRow => ({
  id,
  employeeCode: id,
  firstName: id,
  lastName: 'X',
  departmentId: dept,
  employmentStatus: lastWorkingDate ? 'TERMINATED' : 'ACTIVE',
  joiningDate,
  lastWorkingDate,
});

describe('workforce maths', () => {
  const staff = [
    p('a', '2020-01-01'),
    p('b', '2026-09-10'),
    p('c', '2025-01-01', '2026-10-15'),
    p('d', '2026-10-05'),
  ];
  it('counts people employed at the end of a month', () => {
    expect(headcountAt(staff, '2026-08')).toBe(2); // a, c
    expect(headcountAt(staff, '2026-09')).toBe(3); // a, b, c
    expect(headcountAt(staff, '2026-10')).toBe(3); // a, b, d (c left on the 15th)
  });
  it('lists the last six months, oldest first', () => {
    const t = headcountTrend(staff, '2026-10');
    expect(t).toHaveLength(6);
    expect(t[0]?.month).toBe('2026-05');
    expect(t[5]?.value).toBe(3);
  });
  it('finds joiners and leavers in a month', () => {
    expect(joinedIn(staff, '2026-10').map((e) => e.id)).toEqual(['d']);
    expect(leftIn(staff, '2026-10').map((e) => e.id)).toEqual(['c']);
  });
  it('works out attrition as leavers over average headcount', () => {
    const a = attrition12(staff, '2026-10');
    expect(a.leavers).toBe(1);
    expect(a.pct).toBeGreaterThan(0);
  });
  it('counts by key, biggest first', () => {
    expect(countBy(staff, (e) => e.departmentId ?? '')).toEqual([{ name: 'd1', value: 4 }]);
  });
});

describe('role view', () => {
  it('picks the highest role', () => {
    expect(roleViewOf(['EMPLOYEE', 'MANAGER'])).toBe('manager');
    expect(roleViewOf(['HR_ADMIN', 'EMPLOYEE'])).toBe('hr');
    expect(roleViewOf(['COMPANY_OWNER'])).toBe('owner');
    expect(roleViewOf(['EMPLOYEE'])).toBe('employee');
    expect(roleViewOf(undefined)).toBe('employee');
  });
});
