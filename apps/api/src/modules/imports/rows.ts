import { DateTime } from 'luxon';
import { EMPLOYMENT_TYPES } from '../../database/models/employee.model';

/** What a spreadsheet row looks like on arrival: every cell is text (or empty). */
export type RawRow = Record<string, unknown>;
export const MAX_IMPORT_ROWS = 1000;

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const key = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');

/** Strict ISO date (YYYY-MM-DD) that is a real calendar day. */
export function isoDate(v: unknown): string | undefined {
  const s = text(v);
  if (!s) return undefined;
  const d = DateTime.fromISO(s, { zone: 'utc' });
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && d.isValid ? s : undefined;
}

function pick<T extends string>(v: unknown, allowed: readonly T[], extra: Record<string, T> = {}): T | undefined | null {
  const s = text(v);
  if (!s) return undefined;
  const k = key(s);
  return allowed.find((a) => key(a) === k) ?? extra[k] ?? null; // null = a value was given but is not valid
}

export const IMPORT_ROLES = ['EMPLOYEE', 'MANAGER'] as const;
const GENDERS = ['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED'] as const;
const MODES = ['OFFICE', 'FIELD', 'REMOTE'] as const;

export interface EmployeeRowValue {
  employeeCode?: string;
  firstName: string;
  lastName: string;
  workEmail: string;
  phone?: string;
  personalEmail?: string;
  department?: string;
  designation?: string;
  manager?: string; // employee code or work email
  workLocation?: string;
  joiningDate?: string;
  dateOfBirth?: string;
  employmentType?: (typeof EMPLOYMENT_TYPES)[number];
  attendanceMode?: (typeof MODES)[number];
  gender?: (typeof GENDERS)[number];
  role: (typeof IMPORT_ROLES)[number];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9+()\-\s]{5,30}$/;

/** Pure: turn one spreadsheet row into a clean employee, or a list of plain-language problems. */
export function parseEmployeeRow(raw: RawRow): { ok: true; value: EmployeeRowValue } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const need = (field: string, label: string, max: number) => {
    const s = text(raw[field]);
    if (!s) errors.push(`${label} is required`);
    else if (s.length > max) errors.push(`${label} is too long (most ${max} characters)`);
    return s;
  };
  const firstName = need('firstName', 'First name', 100);
  const lastName = need('lastName', 'Last name', 100);
  const workEmail = text(raw.workEmail).toLowerCase();
  if (!workEmail) errors.push('Work email is required');
  else if (!EMAIL.test(workEmail) || workEmail.length > 254) errors.push('Work email is not a valid email address');
  const optionalText = (field: string, label: string, max: number) => {
    const s = text(raw[field]);
    if (s.length > max) errors.push(`${label} is too long (most ${max} characters)`);
    return s || undefined;
  };
  const employeeCode = optionalText('employeeCode', 'Employee code', 40);
  const department = optionalText('department', 'Department', 120);
  const designation = optionalText('designation', 'Designation', 120);
  const manager = optionalText('manager', 'Manager', 254);
  const workLocation = optionalText('workLocation', 'Work location', 120);
  const phone = optionalText('phone', 'Phone', 30);
  if (phone && !PHONE.test(phone)) errors.push('Phone may contain only digits, + ( ) - and spaces');
  const personalEmail = text(raw.personalEmail).toLowerCase() || undefined;
  if (personalEmail && !EMAIL.test(personalEmail)) errors.push('Personal email is not a valid email address');
  const date = (field: string, label: string) => {
    const s = text(raw[field]);
    if (!s) return undefined;
    const d = isoDate(s);
    if (!d) errors.push(`${label} must be a real date written YYYY-MM-DD`);
    return d;
  };
  const joiningDate = date('joiningDate', 'Joining date');
  const dateOfBirth = date('dateOfBirth', 'Date of birth');
  if (dateOfBirth && dateOfBirth > DateTime.utc().toISODate()!) errors.push('Date of birth is in the future');
  const employmentType = pick(raw.employmentType, EMPLOYMENT_TYPES, { fulltime: 'FULL_TIME', parttime: 'PART_TIME', permanent: 'FULL_TIME' });
  if (employmentType === null) errors.push(`Employment type must be one of ${EMPLOYMENT_TYPES.join(', ')}`);
  const attendanceMode = pick(raw.attendanceMode, MODES);
  if (attendanceMode === null) errors.push(`Attendance mode must be one of ${MODES.join(', ')}`);
  const gender = pick(raw.gender, GENDERS, { m: 'MALE', f: 'FEMALE', male: 'MALE', female: 'FEMALE' });
  if (gender === null) errors.push(`Gender must be one of ${GENDERS.join(', ')}`);
  const role = pick(raw.role, IMPORT_ROLES);
  if (role === null) errors.push(`Role must be one of ${IMPORT_ROLES.join(', ')} (other roles are given in Employees > Access)`);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      employeeCode, firstName, lastName, workEmail, phone, personalEmail, department, designation, manager, workLocation,
      joiningDate, dateOfBirth, employmentType: employmentType ?? undefined, attendanceMode: attendanceMode ?? undefined,
      gender: gender ?? undefined, role: role ?? 'EMPLOYEE',
    },
  };
}

/** Pure: employees in the file whose manager chain loops back on itself (A reports to B, B to A). */
export function managerCycles(reports: { id: string; manager?: string }[]): Set<string> {
  const next = new Map(reports.map((r) => [r.id, r.manager]));
  const bad = new Set<string>();
  for (const r of reports) {
    // Walk up from this person; they are in a loop only if the walk comes back to them.
    let cur = next.get(r.id);
    for (let steps = 0; cur && steps <= reports.length; steps++) {
      if (cur === r.id) {
        bad.add(r.id);
        break;
      }
      cur = next.get(cur);
    }
  }
  return bad;
}

export interface BalanceRowValue {
  employee: string; // employee code or work email
  leaveType: string; // leave type code or name
  days: number;
  year?: number;
  reason?: string;
}

/** Pure: one opening-leave-balance row. Days move in half-day steps. */
export function parseBalanceRow(raw: RawRow, currentYear: number): { ok: true; value: BalanceRowValue } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const employee = text(raw.employee);
  if (!employee) errors.push('Employee (code or work email) is required');
  const leaveType = text(raw.leaveType);
  if (!leaveType) errors.push('Leave type (code or name) is required');
  const dRaw = text(raw.days);
  const days = Number(dRaw);
  if (!dRaw || !Number.isFinite(days)) errors.push('Days must be a number');
  else if (days <= 0 || days > 366) errors.push('Days must be more than 0 and at most 366');
  else if (Math.abs(days * 2 - Math.round(days * 2)) > 1e-9) errors.push('Days must be in half-day steps (for example 7 or 7.5)');
  let year: number | undefined;
  if (text(raw.year)) {
    year = Number(text(raw.year));
    if (!Number.isInteger(year) || year < currentYear - 1 || year > currentYear + 1) errors.push(`Year must be ${currentYear - 1}, ${currentYear} or ${currentYear + 1}`);
  }
  const reason = text(raw.reason).slice(0, 500) || undefined;
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { employee, leaveType, days, year, reason } };
}
