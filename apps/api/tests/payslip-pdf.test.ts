import { describe, expect, it } from 'vitest';
import { formatMinor, latin, renderPayslipPdf } from '../src/modules/payroll/payslipPdf';

describe('payslip PDF', () => {
  it('formats minor units without floating-point drift', () => {
    expect(formatMinor(123456789, 'INR')).toBe('INR 1,234,567.89');
    expect(formatMinor(5, 'INR')).toBe('INR 0.05');
    expect(formatMinor(-250000, 'INR')).toBe('INR -2,500.00');
  });
  it('replaces characters the built-in fonts cannot print', () => {
    expect(latin('Asha आशा')).toBe('Asha ???');
    expect(latin(null)).toBe('');
  });
  it('renders a valid PDF', async () => {
    const buf = await renderPayslipPdf({
      companyName: 'Example Co',
      month: '2026-03',
      currency: 'INR',
      employee: { code: 'E1', name: 'Test Person', designation: 'Analyst', department: 'Ops' },
      attendance: { daysInMonth: 31, payableDays: 31, lopDays: 0 },
      lines: [
        { code: 'BASIC', name: 'Basic', kind: 'EARNING', amountMinor: 2000000 },
        { code: 'TDS', name: 'Tax', kind: 'DEDUCTION', amountMinor: 50000 },
      ],
      grossMinor: 2000000,
      deductionsMinor: 50000,
      netMinor: 1950000,
      employerLines: [{ name: 'Employer example', amountMinor: 160000 }],
      draft: false,
    });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(800);
  });
});
