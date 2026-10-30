export type ExportFormat = 'csv' | 'xlsx';
export type Cell = string | number | boolean | null | undefined;
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** One CSV cell. Text starting with = + - @ is prefixed so a spreadsheet never runs it as a formula. */
export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

/** UTF-8 byte-order mark so Excel reads accents correctly; CRLF line endings. */
export const toCsvText = (rows: Cell[][]) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

/** Excel sheet names: at most 31 characters and none of  [ ] : * ? / \ */
export const sheetName = (s: string) => s.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet1';

export interface ExtraSheet {
  name: string;
  rows: Cell[][];
}

/** The first row is the header. Extra sheets (for example "Instructions") only go into the Excel file. */
export async function makeXlsx(rows: Cell[][], name = 'Data', extra: ExtraSheet[] = []): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const add = (n: string, data: Cell[][], freeze: boolean) => {
    const ws = wb.addWorksheet(sheetName(n), freeze ? { views: [{ state: 'frozen', ySplit: 1 }] } : undefined);
    data.forEach((r, i) => {
      const row = ws.addRow(r.map((c) => (c === undefined ? null : c)));
      if (i === 0 && freeze) row.font = { bold: true };
    });
    const cols = Math.max(0, ...data.map((r) => r.length));
    for (let c = 0; c < cols; c++) {
      const widest = Math.max(8, ...data.slice(0, 200).map((r) => String(r[c] ?? '').length));
      ws.getColumn(c + 1).width = Math.min(60, widest + 2);
    }
  };
  add(name, rows, true);
  for (const e of extra) add(e.name, e.rows, false);
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf as ArrayBuffer], { type: XLSX_MIME });
}

/** Download a table as CSV or Excel. `name` has no extension. */
export async function downloadTable(
  name: string,
  rows: Cell[][],
  format: ExportFormat,
  opts: { sheet?: string; extraSheets?: ExtraSheet[] } = {},
) {
  if (format === 'xlsx') return downloadBlob(await makeXlsx(rows, opts.sheet ?? name, opts.extraSheets), `${name}.xlsx`);
  downloadBlob(new Blob([toCsvText(rows)], { type: 'text/csv;charset=utf-8' }), `${name}.csv`);
}
