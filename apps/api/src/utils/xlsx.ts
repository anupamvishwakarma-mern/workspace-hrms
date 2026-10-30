import ExcelJS from 'exceljs';
import type { CsvCell } from './csv';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Excel sheet names: at most 31 characters and none of  [ ] : * ? / \ */
export const sheetName = (s: string) => s.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet1';

/**
 * One-sheet .xlsx. Text is stored as text (never as a formula), numbers stay numbers, so a name such as "=1+1" shows
 * as plain text. The header row is bold and frozen.
 */
export async function toXlsx(header: string[], rows: CsvCell[][], name = 'Export'): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Workforce HRMS';
  const ws = wb.addWorksheet(sheetName(name), { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addRow(header).font = { bold: true };
  for (const r of rows) ws.addRow(r.map((c) => (c === undefined ? null : c)));
  header.forEach((h, i) => {
    const widest = Math.max(h.length, ...rows.slice(0, 200).map((r) => String(r[i] ?? '').length));
    ws.getColumn(i + 1).width = Math.min(60, Math.max(10, widest + 2));
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
