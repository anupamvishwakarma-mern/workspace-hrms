import { downloadBlob } from './lib';

/** One cell of CSV text; a leading = + - @ is neutralised so spreadsheets never run it as a formula. */
export const csvCell = (v: string | number | null | undefined) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const downloadCsv = (name: string, rows: (string | number | null | undefined)[][]) =>
  downloadBlob(
    new Blob([rows.map((r) => r.map(csvCell).join(',')).join('\n')], {
      type: 'text/csv;charset=utf-8',
    }),
    name,
  );
