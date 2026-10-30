import type { Cell } from './export';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 1000;

export interface ColumnDef {
  /** The field name the server expects. */
  key: string;
  /** The heading shown in the template. */
  header: string;
  /** Other headings people commonly use (matched ignoring case, spaces and punctuation). */
  aliases?: string[];
  required?: boolean;
  /** Dates are accepted as YYYY-MM-DD or day-first DD/MM/YYYY and sent to the server as YYYY-MM-DD. */
  date?: boolean;
  help: string;
  samples: [string, string];
}

export const EMPLOYEE_COLUMNS: ColumnDef[] = [
  { key: 'employeeCode', header: 'Employee code', aliases: ['emp code', 'employee id', 'emp id', 'code'], help: 'Leave blank to number automatically (EMP-0001...). Must be unique.', samples: ['', ''] },
  { key: 'firstName', header: 'First name', aliases: ['given name', 'firstname'], required: true, help: 'Required.', samples: ['Asha', 'Ravi'] },
  { key: 'lastName', header: 'Last name', aliases: ['surname', 'family name', 'lastname'], required: true, help: 'Required.', samples: ['Nair', 'Menon'] },
  { key: 'workEmail', header: 'Work email', aliases: ['email', 'official email', 'company email', 'email address'], required: true, help: 'Required and unique. This becomes their login.', samples: ['asha.nair@yourcompany.com', 'ravi.menon@yourcompany.com'] },
  { key: 'phone', header: 'Phone', aliases: ['mobile', 'phone number', 'contact number'], help: 'Digits, + ( ) - and spaces.', samples: ['+91 98765 43210', ''] },
  { key: 'personalEmail', header: 'Personal email', aliases: ['private email', 'home email'], help: 'Optional.', samples: ['', ''] },
  { key: 'department', header: 'Department', aliases: ['dept', 'team'], help: 'Must exist, or tick "Create missing departments and designations".', samples: ['Engineering', 'Sales'] },
  { key: 'designation', header: 'Designation', aliases: ['job title', 'title', 'position', 'role title'], help: 'Must exist, or tick "Create missing departments and designations".', samples: ['Software Engineer', 'Sales Executive'] },
  { key: 'manager', header: 'Manager', aliases: ['reports to', 'manager email', 'manager code', 'reporting manager', 'manager (code or email)'], help: "The manager's employee code or work email. They can be earlier or later in this same file.", samples: ['', 'asha.nair@yourcompany.com'] },
  { key: 'workLocation', header: 'Work location', aliases: ['location', 'office', 'branch'], help: 'Must match a location already added under Locations.', samples: ['', ''] },
  { key: 'joiningDate', header: 'Joining date', aliases: ['date of joining', 'doj', 'joined on', 'start date'], date: true, help: 'YYYY-MM-DD or DD/MM/YYYY.', samples: ['2024-04-01', '2025-01-15'] },
  { key: 'dateOfBirth', header: 'Date of birth', aliases: ['dob', 'birth date', 'birthday'], date: true, help: 'YYYY-MM-DD or DD/MM/YYYY.', samples: ['', ''] },
  { key: 'employmentType', header: 'Employment type', aliases: ['type', 'employee type'], help: 'FULL_TIME, PART_TIME, CONTRACT or INTERN. Blank = full time.', samples: ['FULL_TIME', 'CONTRACT'] },
  { key: 'attendanceMode', header: 'Attendance mode', aliases: ['attendance type'], help: 'OFFICE, FIELD or REMOTE. Blank = office.', samples: ['OFFICE', 'REMOTE'] },
  { key: 'gender', header: 'Gender', aliases: ['sex'], help: 'MALE, FEMALE, OTHER or UNDISCLOSED.', samples: ['', ''] },
  { key: 'role', header: 'Role', aliases: ['access role', 'login role'], help: 'EMPLOYEE or MANAGER (used only when sending invitations). Blank = employee.', samples: ['EMPLOYEE', 'EMPLOYEE'] },
];

export const BALANCE_COLUMNS: ColumnDef[] = [
  { key: 'employee', header: 'Employee', aliases: ['employee code', 'employee email', 'emp code', 'work email', 'email', 'code'], required: true, help: "Employee code or work email. They must already be a current employee.", samples: ['EMP-0004', 'ravi.menon@yourcompany.com'] },
  { key: 'leaveType', header: 'Leave type', aliases: ['type', 'leave', 'leave code', 'leave name'], required: true, help: 'Leave type code (CL) or name (Casual Leave).', samples: ['CL', 'Earned Leave'] },
  { key: 'days', header: 'Days', aliases: ['balance', 'opening balance', 'days available'], required: true, help: 'More than 0, in half-day steps (for example 7.5).', samples: ['6', '4.5'] },
  { key: 'year', header: 'Year', aliases: ['leave year'], help: 'Blank = this leave year.', samples: ['', ''] },
  { key: 'reason', header: 'Reason', aliases: ['note', 'remarks', 'comment'], help: 'Optional note kept with the entry.', samples: ['Carried from the old system', ''] },
];

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Comma, semicolon or tab separated text, with quotes, doubled quotes and a leading byte-order mark. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const first = src.split(/\r?\n/, 1)[0] ?? '';
  const delim = [',', ';', '\t'].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"' && cur === '') quoted = true;
    else if (c === delim) {
      row.push(cur);
      cur = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else cur += c;
  }
  if (cur !== '' || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

/** Text of one Excel cell: dates become YYYY-MM-DD, formulas their result, rich text its plain text. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: unknown; error?: unknown };
    if (o.error) return '';
    if (o.richText) return o.richText.map((t) => t.text).join('');
    if (o.result !== undefined) return cellText(o.result);
    if (o.text !== undefined) return cellText(o.text);
    return '';
  }
  return String(v).trim();
}

export async function readSpreadsheet(file: File): Promise<string[][]> {
  if (file.size > MAX_FILE_BYTES) throw new Error('This file is larger than 5 MB. Split it and import in parts.');
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('The workbook has no sheets.');
    const out: string[][] = [];
    const width = ws.columnCount;
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= width; c++) cells.push(cellText(row.getCell(c).value));
      out.push(cells);
    });
    return out;
  }
  if (name.endsWith('.csv') || name.endsWith('.txt') || file.type === 'text/csv') return parseCsv(await file.text());
  throw new Error('Use an .xlsx (Excel) or .csv file. Older .xls files: open them in Excel and Save As .xlsx.');
}

/** DD/MM/YYYY or DD-MM-YYYY (day first) becomes YYYY-MM-DD; anything else is returned unchanged for the server to judge. */
export function normalizeDate(s: string): string {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : s.trim();
}

export interface Mapped {
  rows: { row: number; data: Record<string, string> }[];
  /** Columns in the file that were not recognised (they are ignored). */
  ignored: string[];
  /** Required columns that the file does not have. */
  missing: string[];
  /** Number of recognised columns. */
  matched: number;
}

/** Match the file's headings to the expected columns and build the rows the server takes. Blank lines are skipped. */
export function mapRows(table: string[][], cols: ColumnDef[]): Mapped {
  const head = table[0] ?? [];
  const index = new Map<string, ColumnDef>();
  for (const c of cols) for (const n of [c.header, c.key, ...(c.aliases ?? [])]) index.set(norm(n), c);
  const at: (ColumnDef | undefined)[] = head.map((h) => index.get(norm(h)));
  const ignored = head.filter((h, i) => h.trim() && !at[i]);
  const found = new Set(at.filter(Boolean).map((c) => c!.key));
  const missing = cols.filter((c) => c.required && !found.has(c.key)).map((c) => c.header);
  const rows: Mapped['rows'] = [];
  table.slice(1).forEach((cells, i) => {
    if (cells.every((c) => !c.trim())) return;
    const data: Record<string, string> = {};
    at.forEach((c, k) => {
      if (!c) return;
      const v = (cells[k] ?? '').trim();
      data[c.key] = c.date && v ? normalizeDate(v) : v;
    });
    rows.push({ row: i + 2, data });
  });
  return { rows, ignored, missing, matched: found.size };
}

/** Header row plus two sample rows: what the downloadable template contains. */
export const templateRows = (cols: ColumnDef[]): Cell[][] => [
  cols.map((c) => c.header),
  cols.map((c) => c.samples[0]),
  cols.map((c) => c.samples[1]),
];
export const instructionRows = (cols: ColumnDef[]): Cell[][] => [
  ['Column', 'Required', 'What to enter'],
  ...cols.map((c) => [c.header, c.required ? 'Yes' : 'No', c.help]),
  [],
  ['Delete the two sample rows before importing. Keep the heading row. Up to 1000 rows per file.'],
];
