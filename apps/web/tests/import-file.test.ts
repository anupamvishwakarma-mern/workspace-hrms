import { describe, expect, it } from 'vitest';
import { csvCell, toCsvText } from '../src/lib/export';
import { BALANCE_COLUMNS, EMPLOYEE_COLUMNS, cellText, mapRows, normalizeDate, parseCsv, templateRows } from '../src/lib/import-file';

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, commas, newlines in cells, BOM and CRLF', () => {
    const t = parseCsv('﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n"l1\nl2",,3\r\n');
    expect(t).toEqual([['a', 'b', 'c'], ['1', 'x, y', 'say "hi"'], ['l1\nl2', '', '3']]);
  });
  it('detects semicolons and tabs (common in regional Excel exports)', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('cellText', () => {
  it('reads Excel cell shapes', () => {
    expect(cellText(new Date('2025-03-01T00:00:00Z'))).toBe('2025-03-01');
    expect(cellText({ result: 7 })).toBe('7');
    expect(cellText({ richText: [{ text: 'a' }, { text: 'b' }] })).toBe('ab');
    expect(cellText({ text: 'x@y.com', hyperlink: 'mailto:x@y.com' })).toBe('x@y.com');
    expect(cellText({ error: '#N/A' })).toBe('');
    expect(cellText(1001)).toBe('1001');
    expect(cellText(null)).toBe('');
  });
});

describe('normalizeDate', () => {
  it('turns day-first dates into ISO and leaves the rest for the server', () => {
    expect(normalizeDate('05/03/2025')).toBe('2025-03-05');
    expect(normalizeDate('5-3-2025')).toBe('2025-03-05');
    expect(normalizeDate('2025-03-05')).toBe('2025-03-05');
    expect(normalizeDate('soon')).toBe('soon');
  });
});

describe('mapRows', () => {
  it('matches headings loosely, converts dates, skips blank lines, numbers rows like the sheet', () => {
    const m = mapRows(
      [
        ['First Name', 'LAST_NAME', 'Email', 'DOJ', 'Extra'],
        ['Asha', 'Nair', 'a@x.com', '01/04/2024', 'zzz'],
        ['', '', '', '', ''],
        ['Ravi', 'Menon', 'r@x.com', '2025-01-15', ''],
      ],
      EMPLOYEE_COLUMNS,
    );
    expect(m.missing).toEqual([]);
    expect(m.ignored).toEqual(['Extra']);
    expect(m.rows).toEqual([
      { row: 2, data: { firstName: 'Asha', lastName: 'Nair', workEmail: 'a@x.com', joiningDate: '2024-04-01' } },
      { row: 4, data: { firstName: 'Ravi', lastName: 'Menon', workEmail: 'r@x.com', joiningDate: '2025-01-15' } },
    ]);
  });
  it('names required columns that are missing', () => {
    expect(mapRows([['First name', 'Email']], EMPLOYEE_COLUMNS).missing).toEqual(['Last name']);
    expect(mapRows([['Employee', 'Days']], BALANCE_COLUMNS).missing).toEqual(['Leave type']);
  });
  it('the template reads back through the same mapping', () => {
    const m = mapRows(templateRows(EMPLOYEE_COLUMNS) as string[][], EMPLOYEE_COLUMNS);
    expect(m.missing).toEqual([]);
    expect(m.ignored).toEqual([]);
    expect(m.rows).toHaveLength(2);
    expect(m.rows[0]!.data.firstName).toBe('Asha');
  });
});

describe('export csv', () => {
  it('neutralises formulas and writes BOM + CRLF', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell(-5)).toBe('-5');
    expect(toCsvText([['a', 'b'], [1, 'x,y']])).toBe('﻿a,b\r\n1,"x,y"\r\n');
  });
});

describe('Excel round trip', () => {
  it('writes an .xlsx that the importer reads back, with dates and numbers intact', async () => {
    const { makeXlsx } = await import('../src/lib/export');
    const { readSpreadsheet } = await import('../src/lib/import-file');
    const blob = await makeXlsx(
      [['First name', 'Last name', 'Work email', 'Joining date'], ['Asha', 'Nair', 'a@x.com', '2024-04-01'], ['=1+1', 'Roy', 'r@x.com', '']],
      'Employees',
      [{ name: 'Instructions', rows: [['x']] }],
    );
    const table = await readSpreadsheet(new File([blob], 'people.xlsx'));
    expect(table[0]).toEqual(['First name', 'Last name', 'Work email', 'Joining date']);
    expect(table[1]).toEqual(['Asha', 'Nair', 'a@x.com', '2024-04-01']);
    expect(table[2]![0]).toBe('=1+1'); // stored as text, not evaluated
    const m = mapRows(table, EMPLOYEE_COLUMNS);
    expect(m.rows).toHaveLength(2);
  });
  it('refuses legacy .xls and unknown types with a helpful message', async () => {
    const { readSpreadsheet } = await import('../src/lib/import-file');
    await expect(readSpreadsheet(new File(['x'], 'old.xls'))).rejects.toThrow(/Save As \.xlsx/);
  });
});
