import { DateTime } from 'luxon';
import { AppError } from '../../utils/errors';

export const PLACEHOLDERS = [
  'employee.name',
  'employee.firstName',
  'employee.code',
  'employee.designation',
  'employee.department',
  'employee.email',
  'employee.joiningDate',
  'employee.lastWorkingDate',
  'company.name',
  'date.today',
  'salary.monthlyGross',
  'salary.annualGross',
] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];
const RE = /\{\{\s*([A-Za-z.]+)\s*\}\}/g;

export const placeholdersIn = (body: string): string[] => [
  ...new Set([...body.matchAll(RE)].map((m) => m[1]!)),
];

/** Throws 422 naming any placeholder that is not on the allowed list. */
export function assertKnownPlaceholders(body: string): void {
  const unknown = placeholdersIn(body).filter(
    (p) => !(PLACEHOLDERS as readonly string[]).includes(p),
  );
  if (unknown.length)
    throw AppError.unprocessable(
      `Unknown placeholder${unknown.length > 1 ? 's' : ''}: ${unknown.map((u) => `{{${u}}}`).join(', ')}`,
      'UNKNOWN_PLACEHOLDER',
    );
}

export const formatLongDate = (d: Date | string, tz = 'UTC'): string =>
  (typeof d === 'string'
    ? DateTime.fromISO(d, { zone: 'UTC' })
    : DateTime.fromJSDate(d, { zone: tz })
  ).toFormat('d LLLL yyyy');

export const formatMoney = (minor: number, currency: string): string =>
  `${currency} ${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Fills placeholders. A placeholder with no value (e.g. the employee has no designation) fails loudly instead of
 * printing a blank into an official letter. The result is plain text: clients must never render it as HTML.
 */
export function renderLetter(
  body: string,
  values: Partial<Record<Placeholder, string | undefined>>,
): string {
  assertKnownPlaceholders(body);
  const missing: string[] = [];
  const out = body.replace(RE, (_m, key: Placeholder) => {
    const v = values[key];
    if (v === undefined || v === '') {
      missing.push(key);
      return '';
    }
    return v;
  });
  if (missing.length)
    throw AppError.unprocessable(
      `Missing value for ${[...new Set(missing)].map((m) => `{{${m}}}`).join(', ')}. Update the employee record or edit the letter.`,
      'MISSING_PLACEHOLDER_VALUE',
    );
  return out;
}
