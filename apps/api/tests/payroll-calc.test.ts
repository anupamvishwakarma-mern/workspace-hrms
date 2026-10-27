import { describe, expect, it } from 'vitest';
import {
  calculatePayslip,
  validateStructure,
  type PayComponent,
} from '../src/modules/payroll/calc';

const C = (over: Partial<PayComponent> & Pick<PayComponent, 'code'>): PayComponent => ({
  name: over.code,
  kind: 'EARNING',
  calc: 'FIXED',
  value: 0,
  prorate: true,
  ...over,
});
const base = [
  C({ code: 'BASIC', value: 3_000_000 }), // 30,000.00
  C({ code: 'HRA', calc: 'PERCENT_OF_BASIC', value: 4000 }), // 40% of basic
  C({ code: 'TRAVEL', value: 200_000, prorate: false }),
  C({ code: 'PF', kind: 'DEDUCTION', calc: 'PERCENT_OF_BASIC', value: 1200, prorate: false }),
  C({ code: 'TAXADV', kind: 'DEDUCTION', value: 100_000, prorate: false }),
];

describe('calculatePayslip', () => {
  it('pays everything in a full month', () => {
    const r = calculatePayslip({
      components: base,
      daysInMonth: 30,
      lopDays: 0,
      notEmployedDays: 0,
    });
    expect(r.payableDays).toBe(30);
    expect(r.grossMinor).toBe(3_000_000 + 1_200_000 + 200_000);
    expect(r.deductionsMinor).toBe(360_000 + 100_000);
    expect(r.netMinor).toBe(r.grossMinor - r.deductionsMinor);
    expect(r.warnings).toEqual([]);
  });

  it('prorates prorated earnings by payable days and leaves the rest alone', () => {
    const r = calculatePayslip({
      components: base,
      daysInMonth: 30,
      lopDays: 3,
      notEmployedDays: 0,
    });
    const line = (c: string) => r.lines.find((l) => l.code === c)!;
    expect(r.payableDays).toBe(27);
    expect(line('BASIC').amountMinor).toBe(2_700_000); // 30,000 x 27/30
    expect(line('HRA').amountMinor).toBe(1_080_000); // 40% of FULL basic, then prorated
    expect(line('TRAVEL').amountMinor).toBe(200_000); // not prorated
    expect(line('PF').amountMinor).toBe(360_000); // deductions never prorated
    expect(line('PF').fullMinor).toBe(360_000);
  });

  it('handles half days exactly and rounds half up', () => {
    const r = calculatePayslip({
      components: [C({ code: 'BASIC', value: 10_000 })],
      daysInMonth: 31,
      lopDays: 0.5,
      notEmployedDays: 0,
    });
    expect(r.payableDays).toBe(30.5);
    expect(r.grossMinor).toBe(Math.floor((2 * 10_000 * 61 + 62) / 124)); // 9838.7 -> 9839
    expect(r.grossMinor).toBe(9839);
  });

  it('counts days outside employment as not payable', () => {
    const r = calculatePayslip({
      components: base,
      daysInMonth: 30,
      lopDays: 0,
      notEmployedDays: 10,
    });
    expect(r.payableDays).toBe(20);
    expect(r.lines.find((l) => l.code === 'BASIC')!.amountMinor).toBe(2_000_000);
  });

  it('never lets lop exceed the month and warns about zero pay or negative net', () => {
    const r = calculatePayslip({
      components: base,
      daysInMonth: 30,
      lopDays: 99,
      notEmployedDays: 0,
    });
    expect(r.payableDays).toBe(0);
    expect(r.warnings).toContain('NO_PAYABLE_DAYS');
    expect(r.warnings).toContain('NEGATIVE_NET'); // 2,000 travel < 4,600 deductions
    expect(r.netMinor).toBe(200_000 - 460_000);
  });
});

describe('validateStructure', () => {
  it('requires one fixed BASIC earning and sane values', () => {
    expect(validateStructure(base)).toBeUndefined();
    expect(validateStructure([C({ code: 'HRA', value: 1 })])).toMatch(/BASIC/);
    expect(validateStructure([C({ code: 'BASIC', calc: 'PERCENT_OF_BASIC', value: 100 })])).toMatch(
      /BASIC/,
    );
    expect(validateStructure([C({ code: 'BASIC', value: 0 })])).toMatch(/greater than zero/);
    expect(validateStructure([...base, C({ code: 'HRA', value: 1 })])).toMatch(/Duplicate/);
    expect(
      validateStructure([...base, C({ code: 'X', calc: 'PERCENT_OF_BASIC', value: 10001 })]),
    ).toMatch(/percent/);
    expect(validateStructure([...base, C({ code: 'Y', value: 1.5 })])).toMatch(/invalid/);
  });
});
