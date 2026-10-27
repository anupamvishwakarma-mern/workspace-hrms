import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../src/utils/csv';

describe('csv', () => {
  it('neutralises spreadsheet formulas in text but leaves real numbers alone', () => {
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(csvCell('+1+1')).toBe("'+1+1");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tcmd')).toBe("'\tcmd");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(0)).toBe('0');
  });
  it('quotes commas, quotes and newlines; empty for null/undefined/NaN', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('l1\nl2')).toBe('"l1\nl2"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(Number.NaN)).toBe('');
    expect(csvCell('plain')).toBe('plain');
  });
  it('writes a BOM, CRLF line endings and a header', () => {
    expect(toCsv(['a', 'b'], [[1, 'x']])).toBe('﻿a,b\r\n1,x\r\n');
  });
});
