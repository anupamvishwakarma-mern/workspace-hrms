/**
 * CSV serialisation with spreadsheet formula-injection defence.
 * A text cell that starts with = + - @ (or a tab/CR) is executed as a formula by Excel/Sheets, so names or
 * reasons typed by users could run attacker-chosen formulas on whoever opens the export. Such text is prefixed
 * with a single quote. Real numbers are written as-is (a negative number is not text).
 */
export type CsvCell = string | number | boolean | null | undefined;

const DANGEROUS_START = /^[=+\-@\t\r]/;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  let s = String(value);
  if (DANGEROUS_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(cells: CsvCell[]): string {
  return cells.map(csvCell).join(',');
}

/** UTF-8 BOM so Excel detects the encoding; CRLF line endings per RFC 4180. */
export function toCsv(header: string[], rows: CsvCell[][]): string {
  return '﻿' + [csvRow(header), ...rows.map(csvRow)].join('\r\n') + '\r\n';
}
